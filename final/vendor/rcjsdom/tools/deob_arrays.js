'use strict';
/**
 * deob_arrays.js — passe 2 : inline les constantes empaquetées `X = [litéraux]; … X[i] …`.
 * Sûr (bindings babel) : X a UNE seule définition-valeur (décl const `var X=[…]` OU param/var réassigné
 * exactement une fois `X=[…]`), tous les éléments sont des littéraux purs, et chaque ref inlinée est un
 * `X[entier]` EN LECTURE situé APRÈS l'affectation (node.start). Itère jusqu'au point-fixe (les index
 * peuvent être eux-mêmes empaquetés : `d[U[0]]` → après inline de U → `d[0]`).
 *
 * Usage : node tools/deob_arrays.js [in=scripts/recaptcha_readable.js] [out=<in>]
 */
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');

const IN = process.argv[2] || path.join(__dirname, '..', 'scripts', 'recaptcha_readable.js');
const OUT = process.argv[3] || IN;

// Élément inlinable : littéral pur, sans effet de bord.
function isConstElem(n) {
  if (t.isStringLiteral(n) || t.isNumericLiteral(n) || t.isBooleanLiteral(n) || t.isNullLiteral(n)) return true;
  if (t.isUnaryExpression(n) && ['!', '-', '+', 'void'].includes(n.operator)) return isConstElem(n.argument) || t.isNumericLiteral(n.argument);
  if (t.isIdentifier(n, { name: 'undefined' })) return true;
  return false;
}
function isArrayOfLiterals(n) {
  return t.isArrayExpression(n) && n.elements.length > 0 && n.elements.every(e => e && isConstElem(e));
}

// Récupère la valeur-tableau d'un binding s'il correspond au motif sûr (cas A décl-const, cas B réassign-unique).
function getArrayValue(binding) {
  const name = binding.identifier.name;
  // Cas A : `var X = [litéraux]` jamais réassigné.
  if (binding.path.isVariableDeclarator() && binding.path.node.init && isArrayOfLiterals(binding.path.node.init) && binding.constant) {
    return { array: binding.path.node.init, assignPath: binding.path, start: binding.path.node.init.start };
  }
  // Cas B : param OU `var X;` (sans init) réassigné EXACTEMENT une fois à un tableau de littéraux.
  if (binding.constantViolations.length === 1) {
    const cv = binding.constantViolations[0];
    if (cv.isAssignmentExpression({ operator: '=' }) && t.isIdentifier(cv.node.left, { name }) && isArrayOfLiterals(cv.node.right)) {
      const bareVar = binding.path.isVariableDeclarator() && !binding.path.node.init;
      if (binding.kind === 'param' || bareVar) {
        return { array: cv.node.right, assignPath: cv, start: cv.node.right.start };
      }
    }
  }
  return null;
}

function isWriteTarget(memberPath) {
  const pp = memberPath.parentPath;
  if (!pp) return false;
  if (pp.isAssignmentExpression() && pp.node.left === memberPath.node) return true;
  if (pp.isUpdateExpression()) return true;
  if (pp.isUnaryExpression({ operator: 'delete' })) return true;
  if ((pp.isForInStatement() || pp.isForOfStatement()) && pp.node.left === memberPath.node) return true;
  return false;
}

function onePass(ast) {
  let inlined = 0, defsRemoved = 0;
  const processScope = (scopePath) => {
    const bindings = scopePath.scope.bindings;
    for (const name of Object.keys(bindings)) {
      const binding = bindings[name];
      const val = getArrayValue(binding);
      if (!val) continue;
      const { array, assignPath, start } = val;
      const len = array.elements.length;
      let localInlined = 0, otherRefs = 0;
      for (const ref of binding.referencePaths) {
        try {
          const mp = ref.parentPath;
          const okMember = mp && mp.node && ref.node && mp.isMemberExpression() && mp.node.object === ref.node && mp.node.computed &&
            t.isNumericLiteral(mp.node.property) && Number.isInteger(mp.node.property.value) &&
            mp.node.property.value >= 0 && mp.node.property.value < len;
          if (okMember && !isWriteTarget(mp) && ref.node.start > start) {
            mp.replaceWith(t.cloneNode(array.elements[mp.node.property.value], true));
            localInlined++;
          } else {
            otherRefs++;
          }
        } catch (_) { otherRefs++; }
      }
      inlined += localInlined;
      // Suppression de la définition seulement si plus aucune autre ref ET contexte de retrait sûr.
      if (localInlined > 0 && otherRefs === 0) {
        try {
          if (assignPath.isVariableDeclarator()) {
            assignPath.remove(); defsRemoved++;
          } else if (assignPath.isAssignmentExpression()) {
            const pp = assignPath.parentPath;
            if (pp.isExpressionStatement()) { pp.remove(); defsRemoved++; }
            else if (pp.isSequenceExpression() && pp.node.expressions[pp.node.expressions.length - 1] !== assignPath.node) {
              assignPath.remove(); defsRemoved++;
            }
            // sinon : on laisse l'affectation (valeur peut-être utilisée) — refs déjà inlinées, inoffensif
          }
        } catch (_) {}
      }
    }
  };
  traverse(ast, {
    Program(p) { processScope(p); },
    Function(p) { processScope(p); },
  });
  return { inlined, defsRemoved };
}

function main() {
  let code = fs.readFileSync(IN, 'utf8');
  let totalInlined = 0, totalRemoved = 0, iter = 0;
  for (; iter < 8; iter++) {
    const ast = parser.parse(code, { sourceType: 'script', errorRecovery: true }); // re-parse → bindings frais
    const { inlined, defsRemoved } = onePass(ast);
    if (inlined === 0 && defsRemoved === 0) break;
    totalInlined += inlined; totalRemoved += defsRemoved;
    code = generate(ast, { compact: false, comments: true }).code;
    console.log(`  itér ${iter + 1}: inline ${inlined}, defs supprimées ${defsRemoved}`);
  }
  console.log(`total: ${totalInlined} accès inlinés, ${totalRemoved} définitions supprimées (en ${iter} itérations)`);
  try { parser.parse(code, { sourceType: 'script', errorRecovery: false }); console.log('parse de contrôle: OK'); }
  catch (e) { console.log('parse de contrôle: ÉCHEC →', e.message.slice(0, 80)); return; }
  fs.writeFileSync(OUT, code);
  console.log(`→ écrit ${path.relative(process.cwd(), OUT)} (${(code.length / 1e6).toFixed(2)} MB)`);
}

main();
