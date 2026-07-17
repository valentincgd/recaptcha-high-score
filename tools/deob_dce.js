'use strict';
/**
 * deob_dce.js — passe 6 : élimination de code mort (réduction de taille), sûre vis-à-vis des effets de bord.
 *   - `if (X && false) {corps}`  → `X;`         (test toujours falsy → corps mort jeté, effet de bord de X gardé)
 *   - `if (X || true)  {corps}`  → `X; corps`   (test toujours truthy → branche else jetée)
 *   - `X && false;` (statement)  → `X;`         (valeur morte jetée)
 *   - suppression ITÉRATIVE des fonctions/variables jamais référencées (pure)
 *   - suppression des blocs/instructions vides
 * `truthiness()` ne juge QUE la valeur (pas les effets de bord) ; `stripDead()` conserve les effets de bord.
 *
 * Usage : node tools/deob_dce.js [in=scripts/recaptcha_demux.js] [out=<in>]
 */
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');

const IN = process.argv[2] || path.join(__dirname, '..', 'scripts', 'recaptcha_demux.js');
const OUT = process.argv[3] || IN;

const SIDE_FX = new Set(['AssignmentExpression', 'UpdateExpression', 'CallExpression', 'NewExpression', 'OptionalCallExpression', 'AwaitExpression', 'YieldExpression', 'TaggedTemplateExpression']);
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

// Valeur de vérité STATIQUE (ignore les effets de bord) : true / false / null(inconnu).
function truthiness(n) {
  if (t.isBooleanLiteral(n)) return n.value;
  if (t.isNumericLiteral(n)) return n.value !== 0;
  if (t.isStringLiteral(n)) return n.value.length > 0;
  if (t.isNullLiteral(n)) return false;
  if (t.isIdentifier(n, { name: 'undefined' }) || t.isIdentifier(n, { name: 'NaN' })) return false;
  if (t.isIdentifier(n, { name: 'Infinity' })) return true;
  if (t.isUnaryExpression(n) && n.operator === '!') { const a = truthiness(n.argument); return a === null ? null : !a; }
  if (t.isUnaryExpression(n) && n.operator === 'void') return false;
  if (t.isLogicalExpression(n)) {
    const l = truthiness(n.left), r = truthiness(n.right);
    if (n.operator === '&&') { if (l === false || r === false) return false; if (l === true) return r; return null; }
    if (n.operator === '||') { if (l === true || r === true) return true; if (l === false) return r; return null; }
  }
  return null;
}
// Retire la queue de valeur morte en gardant les effets de bord : `A && false` → A, `A || true` → A.
function stripDead(n) {
  if (t.isLogicalExpression(n, { operator: '&&' }) && truthiness(n.right) === false) return stripDead(n.left);
  if (t.isLogicalExpression(n, { operator: '||' }) && truthiness(n.right) === true) return stripDead(n.left);
  return n;
}
const asStmts = (branch) => !branch ? [] : (t.isBlockStatement(branch) ? branch.body : [branch]);
function sideEffectStmt(test) {
  const se = stripDead(test);
  return hasSideEffect(se) ? [t.expressionStatement(t.cloneNode(se, true))] : [];
}

function branchPass(ast) {
  let ifD = 0, stmtD = 0;
  traverse(ast, {
    IfStatement: {
      exit(p) {
        try {
          const tv = truthiness(p.node.test);
          if (tv === false) { p.replaceWithMultiple([...sideEffectStmt(p.node.test), ...asStmts(p.node.alternate)]); ifD++; }
          else if (tv === true) { p.replaceWithMultiple([...sideEffectStmt(p.node.test), ...asStmts(p.node.consequent)]); ifD++; }
        } catch (_) {}
      },
    },
    ExpressionStatement: {
      exit(p) {
        try {
          const e = p.node.expression;
          if (t.isLogicalExpression(e)) {
            const se = stripDead(e);
            if (se !== e) { if (hasSideEffect(se)) p.node.expression = t.cloneNode(se, true); else p.remove(); stmtD++; }
          }
        } catch (_) {}
      },
    },
    EmptyStatement: { exit(p) { try { p.remove(); } catch (_) {} } },
  });
  return { ifD, stmtD };
}
function dcePass(ast) {
  let fnD = 0, varD = 0;
  traverse(ast, {
    Scopable(p) {
      for (const name of Object.keys(p.scope.bindings)) {
        const b = p.scope.bindings[name];
        if (b.references !== 0 || b.referenced) continue; // aucune référence → mort
        try {
          if (b.path.isFunctionDeclaration()) { b.path.remove(); fnD++; }
          else if (b.path.isVariableDeclarator() && (!b.path.node.init || !hasSideEffect(b.path.node.init))) { b.path.remove(); varD++; }
        } catch (_) {}
      }
    },
  });
  return { fnD, varD };
}

function main() {
  let code = fs.readFileSync(IN, 'utf8');
  let totalIf = 0, totalStmt = 0, totalFn = 0, totalVar = 0;
  // Phase A : branches mortes, à point-fixe (re-parse frais à chaque itér)
  for (let i = 0; i < 8; i++) {
    const ast = parser.parse(code, { sourceType: 'script', errorRecovery: true });
    const { ifD, stmtD } = branchPass(ast);
    if (!ifD && !stmtD) break;
    totalIf += ifD; totalStmt += stmtD;
    code = generate(ast, { compact: false, comments: true }).code;
    console.log(`  [branches] itér ${i + 1}: if morts ${ifD}, stmts ${stmtD}`);
  }
  // Phase B : DCE fonctions/variables, à point-fixe (scope frais → cascade)
  for (let i = 0; i < 12; i++) {
    const ast = parser.parse(code, { sourceType: 'script', errorRecovery: true });
    const { fnD, varD } = dcePass(ast);
    if (!fnD && !varD) break;
    totalFn += fnD; totalVar += varD;
    code = generate(ast, { compact: false, comments: true }).code;
    console.log(`  [dce] itér ${i + 1}: fonctions ${fnD}, variables ${varD}`);
  }
  console.log(`total: ${totalIf} if morts, ${totalStmt} stmts, ${totalFn} fonctions, ${totalVar} variables`);
  try { parser.parse(code, { sourceType: 'script', errorRecovery: false }); console.log('parse de contrôle: OK'); }
  catch (e) { console.log('parse de contrôle: ÉCHEC →', e.message.slice(0, 90)); return; }
  fs.writeFileSync(OUT, code);
  const lines = code.split('\n').length;
  console.log(`→ écrit ${path.relative(process.cwd(), OUT)} (${(code.length / 1e6).toFixed(2)} MB, ${lines} lignes)`);
}

main();
