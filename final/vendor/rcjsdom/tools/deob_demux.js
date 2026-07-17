'use strict';
/**
 * deob_demux.js — passe 5 : dé-multiplexage par spécialisation de sélecteur.
 *
 * Chaque `fn_X_i(q, …)` est multiplexée : un seul corps qui fait N choses selon le 1er arg `q` (le sélecteur),
 * via des prédicats binaires `(q & 107) == …`. À chaque site d'appel `fn_X_i(10, …)`, q=10 est constant.
 * On clone le corps, on substitue q→10, on évalue partiellement (fold des sous-expressions purement
 * constantes via path.evaluate ; court-circuit `false&&x`→false, `true&&x`→x, `c?a:b`, `if(const)` ;
 * nettoyage des séquences), et on crée `fn_X_i__s10(reste…)` = la logique RÉELLE de ce sélecteur.
 *
 * Sûr par construction : substitution scope-aware (binding du param), fold = vraie sémantique JS (babel
 * evaluate), court-circuits prouvés. Général `fn_X_i` gardé si usage non-spécialisable (apply/valeur/dyn).
 * Vérifier end-to-end après (HTTP 200).
 *
 * Usage : node tools/deob_demux.js [in=scripts/recaptcha_readable.js] [out=<in>]
 */
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');

const IN = process.argv[2] || path.join(__dirname, '..', 'scripts', 'recaptcha_readable.js');
const OUT = process.argv[3] || path.join(__dirname, '..', 'scripts', 'recaptcha_demux.js');
const FN_RE = /^fn_[A-Za-z]+_\d+$/;

const isPrim = (v) => v === null || v === undefined || ['number', 'string', 'boolean'].includes(typeof v);
const selTag = (s) => (s < 0 ? 'n' + (-s) : '' + s);
// Littéral VRAIMENT sans effet de bord (⚠ t.isLiteral inclut TemplateLiteral qui peut avoir `${call()}`).
const isPureLit = (e) => t.isStringLiteral(e) || t.isNumericLiteral(e) || t.isBooleanLiteral(e) || t.isNullLiteral(e) || t.isRegExpLiteral(e);

// Évaluation partielle d'un AST (fichier temporaire), à point-fixe. Visiteurs TYPÉS (pas de `exit` générique
// qui débordait la pile). Chaque handler est isolé en try/catch et pose le drapeau `changed` (closure).
const LEVEL = Number(process.env.RC_DEMUX_LEVEL || 4); // 1=foldConst seul, 2=+if/ternaire, 3=+court-circuit, 4=+séquences
const SIDE_FX = new Set(['AssignmentExpression', 'UpdateExpression', 'CallExpression', 'NewExpression', 'OptionalCallExpression', 'AwaitExpression', 'YieldExpression', 'TaggedTemplateExpression']);
// ⚠ CRUCIAL : path.evaluate() de babel est "confident" même sur `(E=[…], 2)` en IGNORANT l'effet de bord
// (affectation). On ne doit JAMAIS supprimer une branche/opérande contenant un effet de bord (sinon un
// `E=[…]` gated disparaît et E est lue non-assignée). Ce détecteur garde toutes les éliminations.
function hasSideEffect(node) {
  let found = false;
  (function walk(n) {
    if (found || !n || typeof n.type !== 'string') return;
    if (SIDE_FX.has(n.type) || (n.type === 'UnaryExpression' && n.operator === 'delete')) { found = true; return; }
    for (const k of (t.VISITOR_KEYS[n.type] || [])) {
      const v = n[k];
      if (Array.isArray(v)) { for (const c of v) { walk(c); if (found) return; } }
      else if (v && typeof v.type === 'string') walk(v);
    }
  })(node);
  return found;
}
function partialEval(file) {
  let changed = false;
  const foldConst = (p) => {
    if (hasSideEffect(p.node)) return false; // ne pas replier/jeter un sous-arbre à effet de bord
    const ev = p.evaluate();
    if (ev.confident && isPrim(ev.value) && !(typeof ev.value === 'string' && ev.value.length > 400)) {
      p.replaceWith(t.valueToNode(ev.value)); changed = true; return true;
    }
    return false;
  };
  const V = {
    BinaryExpression: { exit(p) { try { foldConst(p); } catch (_) {} } },
    UnaryExpression: { exit(p) { try { if (p.node.operator !== 'delete') foldConst(p); } catch (_) {} } },
    LogicalExpression: {
      exit(p) {
        try {
          if (foldConst(p)) return;
          if (LEVEL < 3) return;
          if (hasSideEffect(p.node.left)) return; // la gauche doit s'exécuter → ne pas court-circuiter
          const le = p.get('left').evaluate();
          if (!le.confident) return;
          const n = p.node;
          const R = () => t.cloneNode(n.right, true); // cloner le nœud retenu (éviter replaceWith d'un descendant)
          if (n.operator === '&&') p.replaceWith(le.value ? R() : t.valueToNode(le.value));
          else if (n.operator === '||') p.replaceWith(le.value ? t.valueToNode(le.value) : R());
          else if (n.operator === '??') p.replaceWith(le.value === null || le.value === undefined ? R() : t.valueToNode(le.value));
          else return;
          changed = true;
        } catch (_) {}
      },
    },
    ConditionalExpression: {
      exit(p) {
        try {
          if (foldConst(p)) return;
          if (LEVEL < 2) return;
          if (hasSideEffect(p.node.test)) return; // le test doit s'exécuter → ne pas le jeter
          const c = p.get('test').evaluate();
          if (c.confident) { p.replaceWith(t.cloneNode(c.value ? p.node.consequent : p.node.alternate, true)); changed = true; }
        } catch (_) {}
      },
    },
    IfStatement: {
      exit(p) {
        try {
          if (LEVEL < 2) return;
          if (hasSideEffect(p.node.test)) return; // le test doit s'exécuter → ne pas le jeter
          const c = p.get('test').evaluate();
          if (!c.confident) return;
          const n = p.node;
          if (c.value) p.replaceWith(t.cloneNode(n.consequent, true));
          else if (n.alternate) p.replaceWith(t.cloneNode(n.alternate, true));
          else p.remove();
          changed = true;
        } catch (_) {}
      },
    },
    SequenceExpression: {
      exit(p) {
        try {
          if (LEVEL < 4) return;
          const ex = p.node.expressions;
          const kept = ex.filter((e, i) => i === ex.length - 1 || !isPureLit(e));
          if (kept.length === ex.length) return;
          if (kept.length === 1) p.replaceWith(t.cloneNode(kept[0], true)); else p.node.expressions = kept;
          changed = true;
        } catch (_) {}
      },
    },
  };
  let guard = 0;
  do { changed = false; try { traverse(file, V); } catch (_) { break; } } while (changed && guard++ < 12);
}

// Construit une fonction spécialisée pour (fnDecl, selector). Retourne le noeud FunctionDeclaration ou null.
function specialize(fnNode, selector, newName) {
  if (!fnNode.params.length || !t.isIdentifier(fnNode.params[0])) return null;
  const clone = t.cloneNode(fnNode, true);
  clone.id = t.identifier(newName);
  const paramName = clone.params[0].name;
  const file = t.file(t.program([clone]));
  // substitution scope-aware du param sélecteur → littéral
  traverse(file, {
    FunctionDeclaration(fp) {
      if (fp.node !== clone) return;
      const b = fp.scope.getBinding(paramName);
      if (b) for (const ref of b.referencePaths) { try { if (ref.isIdentifier()) ref.replaceWith(t.valueToNode(selector)); } catch (_) {} }
      fp.stop();
    },
  });
  // NB : on GARDE le param sélecteur et l'arg au site d'appel — certaines fn lisent `arguments`
  // positionnellement (slice.call(arguments,…)), un décalage d'arité les casserait. Le corps est
  // quand même dé-multiplexé (q substitué au littéral), seul le param devient inutilisé.
  partialEval(file);
  return file.program.body[0];
}

function main() {
  const src = fs.readFileSync(IN, 'utf8');
  const ast = parser.parse(src, { sourceType: 'script', errorRecovery: true });

  // 1) collecte des déclarations fn_X_i
  const fnDecls = new Map(); // name -> {node, path}
  traverse(ast, {
    FunctionDeclaration(p) {
      if (p.node.id && FN_RE.test(p.node.id.name)) fnDecls.set(p.node.id.name, { node: p.node, path: p });
    },
  });

  // 2) classification des sites d'appel
  const specs = new Map(); // key "name#sel" -> {name, sel, newName, sites:[{callPath, form}]}
  let generalUses = 0;
  for (const [name, { path: declPath }] of fnDecls) {
    const b = declPath.scope.getBinding(name);
    if (!b) continue;
    for (const ref of b.referencePaths) {
      try {
        const pp = ref.parentPath;
        let sel = null, form = null, callPath = null;
        if (pp.isCallExpression() && pp.node.callee === ref.node) {
          const a0 = pp.node.arguments[0];
          if (a0 && t.isNumericLiteral(a0)) { sel = a0.value; form = 'direct'; callPath = pp; }
        } else if (pp.isMemberExpression() && pp.node.object === ref.node && !pp.node.computed && t.isIdentifier(pp.node.property, { name: 'call' })) {
          const gp = pp.parentPath;
          if (gp.isCallExpression() && gp.node.callee === pp.node) {
            const a1 = gp.node.arguments[1];
            if (a1 && t.isNumericLiteral(a1)) { sel = a1.value; form = 'call'; callPath = gp; }
          }
        }
        if (sel === null) { generalUses++; continue; }
        const key = name + '#' + sel;
        if (!specs.has(key)) specs.set(key, { name, sel, newName: `${name}__s${selTag(sel)}`, sites: [] });
        specs.get(key).sites.push({ callPath, form });
      } catch (_) { generalUses++; }
    }
  }
  console.log(`fn_X_i: ${fnDecls.size}, paires (fn,sélecteur) spécialisables: ${specs.size}, usages généraux: ${generalUses}`);

  // 3) génère les spécialisations + réécrit les sites
  const declsByParent = new Map();
  let built = 0, rewritten = 0, skipped = 0;
  for (const { name, sel, newName, sites } of specs.values()) {
    const fn = fnDecls.get(name);
    let specNode = null;
    try { specNode = specialize(fn.node, sel, newName); } catch (_) { specNode = null; } // RangeError/overflow → skip
    if (!specNode) { skipped += sites.length; continue; }
    const parentBody = fn.path.getFunctionParent() ? fn.path.getFunctionParent().node.body.body : fn.path.parentPath.parentPath.node.body;
    if (!declsByParent.has(parentBody)) declsByParent.set(parentBody, []);
    declsByParent.get(parentBody).push(specNode);
    built++;
    for (const { callPath, form } of sites) {
      try {
        if (form === 'direct') { callPath.node.callee = t.identifier(newName); }
        else { callPath.node.callee.object = t.identifier(newName); }
        rewritten++;
      } catch (_) {}
    }
  }
  for (const [body, bucket] of declsByParent) body.unshift(...bucket);
  console.log(`spécialisations créées: ${built}, sites réécrits: ${rewritten}${skipped ? ', sites non spécialisables: ' + skipped : ''}`);

  // 4) DCE : supprime les fn_X_i (généraux) désormais sans référence
  let dce = 0;
  const ast2 = parser.parse(generate(ast, { compact: false }).code, { sourceType: 'script', errorRecovery: true });
  traverse(ast2, {
    FunctionDeclaration(p) {
      const id = p.node.id;
      if (id && FN_RE.test(id.name)) {
        const b = p.scope.getBinding(id.name);
        if (b && b.references === 0) { p.remove(); dce++; }
      }
    },
  });
  console.log(`fn_X_i généraux supprimés (DCE, plus référencés): ${dce}`);

  const code = generate(ast2, { compact: false, comments: true }).code;
  try { parser.parse(code, { sourceType: 'script', errorRecovery: false }); console.log('parse de contrôle: OK'); }
  catch (e) { console.log('parse de contrôle: ÉCHEC →', e.message.slice(0, 90)); return; }
  fs.writeFileSync(OUT, code);
  console.log(`→ écrit ${path.relative(process.cwd(), OUT)} (${(code.length / 1e6).toFixed(2)} MB)`);
}

module.exports = { specialize, partialEval, hasSideEffect };
if (require.main === module) main();
