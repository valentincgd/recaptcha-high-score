'use strict';
/**
 * deob_coverage.js — instrumente readable.js pour tracer quelles fonctions sont RÉELLEMENT appelées
 * pendant une génération de token v3. Sert à mesurer/réaliser la réduction "v3-only" (retirer le code
 * de challenge v2/audio/image jamais atteint par le flux v3).
 *
 *   node tools/deob_coverage.js instrument [in] [out]   → écrit un script instrumenté (__cov à chaque entrée)
 *   node tools/deob_coverage.js reduce <cov.json> [in] [out]  → garde seulement les fn couvertes (+closure)
 */
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');

const SCR = (f) => path.join(__dirname, '..', 'scripts', f);
const FN_RE = /^fn_[A-Za-z]+_\d+$/;

function instrument(inFile, outFile) {
  const ast = parser.parse(fs.readFileSync(inFile, 'utf8'), { sourceType: 'script', errorRecovery: true });
  let n = 0;
  traverse(ast, {
    FunctionDeclaration(p) {
      const id = p.node.id;
      if (id && FN_RE.test(id.name) && t.isBlockStatement(p.node.body)) {
        p.node.body.body.unshift(t.expressionStatement(
          t.callExpression(t.identifier('__cov'), [t.stringLiteral(id.name)])));
        n++;
      }
    },
  });
  // définition globale de __cov, tolérante main/worker (window/self/globalThis)
  const def = parser.parse(
    "var __cov=function(x){try{var g=(typeof window!=='undefined'?window:(typeof self!=='undefined'?self:globalThis));(g.__COVSET||(g.__COVSET=[])).push(x);}catch(_){}};",
    { sourceType: 'script' }).program.body;
  ast.program.body.unshift(...def);
  fs.writeFileSync(outFile, generate(ast, { compact: false }).code);
  console.log(`instrumenté ${n} fonctions → ${path.relative(process.cwd(), outFile)}`);
}

// Retire les fonctions fn_ JAMAIS appelées durant le flux v3 (couverture). Remplace leurs références
// (slots de tableaux, sites d'appel sur chemins morts) par un noop `__dead` pour ne pas casser le load.
// Filet de sécurité : la vérif end-to-end (token accepté) confirme qu'aucune fn retirée n'était nécessaire.
function reduce(covFile, inFile, outFile) {
  const covered = new Set(JSON.parse(fs.readFileSync(covFile, 'utf8')));
  const ast = parser.parse(fs.readFileSync(inFile, 'utf8'), { sourceType: 'script', errorRecovery: true });
  const toRemove = [];
  traverse(ast, {
    FunctionDeclaration(p) {
      const id = p.node.id;
      if (id && FN_RE.test(id.name) && !covered.has(id.name)) toRemove.push(p);
    },
  });
  let refs = 0;
  for (const p of toRemove) {
    const name = p.node.id.name;
    const b = p.scope.getBinding(name);
    if (b) for (const r of b.referencePaths) { try { r.replaceWith(t.identifier('__dead')); refs++; } catch (_) {} }
    try { p.remove(); } catch (_) {}
  }
  ast.program.body.unshift(...parser.parse('var __dead=function(){};', { sourceType: 'script' }).program.body);
  const code = generate(ast, { compact: false, comments: true }).code;
  try { parser.parse(code, { sourceType: 'script', errorRecovery: false }); }
  catch (e) { console.log('parse ÉCHEC →', e.message.slice(0, 90)); return; }
  fs.writeFileSync(outFile, code);
  console.log(`retiré ${toRemove.length} fonctions non couvertes (${refs} refs → __dead) → ${path.relative(process.cwd(), outFile)} (${code.split('\n').length} lignes)`);
}

function main() {
  const [cmd] = process.argv.slice(2);
  if (cmd === 'instrument') {
    instrument(process.argv[3] || SCR('recaptcha_readable.js'), process.argv[4] || SCR('_readable_cov.js'));
  } else if (cmd === 'reduce') {
    reduce(process.argv[3], process.argv[4] || SCR('recaptcha_readable.js'), process.argv[5] || SCR('_readable_v3.js'));
  } else {
    console.log('usage: instrument [in] [out]  |  reduce <cov.json> [in] [out]');
  }
}
main();
