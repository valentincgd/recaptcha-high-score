'use strict';
/**
 * deob_tables.js — passe 4 : dé-indirection des tables de fonctions.
 * Les tables `X = (function(){ return [f0..fN]; })()` sont des tableaux statiques de fonctions ; `X[i]`
 * indexe la i-ème. On extrait chaque fonction en déclaration nommée hoistée `function fn_X_i(){…}`, on
 * reconstruit le tableau `X = [fn_X_0, fn_X_1, …]` (pour les ~370 accès DYNAMIQUES `X[expr]`), et on
 * remplace tous les `X[littéral]` par `fn_X_i`.
 *
 * ⚠️ Sémantique de `this` : `X[i](args)` appelle avec this=X (le tableau) ; `fn_X_i(args)` → this=undefined.
 * Hypothèse (à vérifier end-to-end) : le VM n'utilise this=tableau pour les appels directs (il passe par
 * `.call(this,…)` explicite quand il a besoin de this). Si la vérif échoue → repli sur `fn_X_i.call(X,…)`.
 *
 * Usage : node tools/deob_tables.js [in=scripts/recaptcha_readable.js] [out=<in>] [--callform]
 *   --callform : appels directs → fn_X_i.call(X, …) (préserve this=tableau, plus verbeux mais 100% sûr)
 */
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');

const IN = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(__dirname, '..', 'scripts', 'recaptcha_readable.js');
const OUT = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : IN;
const CALLFORM = process.argv.includes('--callform');

function findTables(ast) {
  const tables = {}; // name -> { declPath, elements:[FunctionExpression|null] }
  traverse(ast, {
    VariableDeclarator(p) {
      const n = p.node;
      if (!t.isIdentifier(n.id) || !n.init) return;
      const init = n.init;
      if (t.isCallExpression(init) && init.arguments.length === 0 && t.isFunctionExpression(init.callee)) {
        const ret = init.callee.body.body.find(s => t.isReturnStatement(s));
        if (ret && t.isArrayExpression(ret.argument) && ret.argument.elements.length > 3 &&
          ret.argument.elements.every(e => t.isFunctionExpression(e) || t.isArrowFunctionExpression(e))) {
          tables[n.id.name] = { declPath: p, arrayExpr: ret.argument };
        }
      }
    },
  });
  return tables;
}

function main() {
  const src = fs.readFileSync(IN, 'utf8');
  const ast = parser.parse(src, { sourceType: 'script', errorRecovery: true });
  const tables = findTables(ast);
  const names = Object.keys(tables);
  console.log(`tables: ${names.map(n => n + '(' + tables[n].arrayExpr.elements.length + ')').join(' ')}`);

  // 0) Snapshot des VRAIES références de chaque table (scope-aware → exclut les locaux `e`, `a`, `m`… qui shadowent).
  const refsByTable = {};
  for (const name of names) {
    const binding = tables[name].declPath.scope.getBinding(name);
    refsByTable[name] = binding ? binding.referencePaths.slice() : [];
  }

  // 1) Construire les déclarations nommées + reconstruire chaque tableau avec des identifiants.
  const declsByParent = new Map(); // Node(body array) -> [FunctionDeclaration]
  const extractable = {}; // name -> Set(index) extraits (FunctionExpression only)
  let arrows = 0, totalDecls = 0;
  for (const name of names) {
    const els = tables[name].arrayExpr.elements;
    const parentBody = tables[name].declPath.getFunctionParent().node.body.body;
    if (!declsByParent.has(parentBody)) declsByParent.set(parentBody, []);
    const bucket = declsByParent.get(parentBody);
    extractable[name] = new Set();
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (t.isArrowFunctionExpression(el)) { arrows++; continue; } // this lexical → ne pas extraire
      const fname = `fn_${name}_${i}`;
      bucket.push(t.functionDeclaration(t.identifier(fname), el.params.map(pp => t.cloneNode(pp, true)),
        t.cloneNode(el.body, true), el.generator, el.async));
      els[i] = t.identifier(fname); // le tableau pointe vers la fonction nommée (accès dynamique OK)
      extractable[name].add(i);
      totalDecls++;
    }
  }
  console.log(`fonctions extraites: ${totalDecls}${arrows ? '  (arrows laissées: ' + arrows + ')' : ''}`);

  // 2) Remplacer les X[littéral] par fn_X_i, UNIQUEMENT sur les vraies références de la table (bindings).
  let repl = 0, direct = 0;
  for (const name of names) {
    for (const ref of refsByTable[name]) {
      try {
        const mp = ref.parentPath;
        if (!(mp && mp.isMemberExpression() && mp.node.object === ref.node && mp.node.computed && t.isNumericLiteral(mp.node.property))) continue;
        const i = mp.node.property.value;
        if (!extractable[name].has(i)) continue; // arrow / hors périmètre → laisser X[i]
        const id = t.identifier(`fn_${name}_${i}`);
        const gp = mp.parentPath;
        if (CALLFORM && gp.isCallExpression() && gp.node.callee === mp.node) {
          gp.node.callee = t.memberExpression(id, t.identifier('call'));
          gp.node.arguments.unshift(t.identifier(name));
          direct++;
        } else {
          mp.replaceWith(id);
        }
        repl++;
      } catch (_) {}
    }
  }
  console.log(`accès remplacés: ${repl}${CALLFORM ? '  (dont appels directs en .call: ' + direct + ')' : ''}`);

  // 3) Insérer les déclarations nommées en tête du corps de leur IIFE (hoisting → refs mutuelles OK).
  for (const [body, bucket] of declsByParent) body.unshift(...bucket);

  const code = generate(ast, { compact: false, comments: true }).code;
  try { parser.parse(code, { sourceType: 'script', errorRecovery: false }); console.log('parse de contrôle: OK'); }
  catch (e) { console.log('parse de contrôle: ÉCHEC →', e.message.slice(0, 90)); return; }
  fs.writeFileSync(OUT, code);
  console.log(`→ écrit ${path.relative(process.cwd(), OUT)} (${(code.length / 1e6).toFixed(2)} MB)`);
}

main();
