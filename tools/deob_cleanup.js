'use strict';
/**
 * deob_cleanup.js — passe 3 : nettoyages cosmétiques purs (aucun changement de sémantique).
 *   - `obj["ident"]`      → `obj.ident`   (membre calculé à clé littérale = identifiant valide)
 *   - `!0` / `!1`         → `true` / `false`
 *   - `void 0`           → `undefined`
 * Usage : node tools/deob_cleanup.js [in=scripts/recaptcha_readable.js] [out=<in>]
 */
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');

const IN = process.argv[2] || path.join(__dirname, '..', 'scripts', 'recaptcha_readable.js');
const OUT = process.argv[3] || IN;
const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function main() {
  const src = fs.readFileSync(IN, 'utf8');
  const ast = parser.parse(src, { sourceType: 'script', errorRecovery: true });
  const s = { member: 0, bool: 0, undef: 0 };
  traverse(ast, {
    MemberExpression(p) {
      const prop = p.node.property;
      if (p.node.computed && t.isStringLiteral(prop) && IDENT_RE.test(prop.value)) {
        p.node.computed = false;
        p.node.property = t.identifier(prop.value);
        s.member++;
      }
    },
    UnaryExpression(p) {
      const n = p.node;
      if (n.operator === '!' && t.isNumericLiteral(n.argument)) {
        p.replaceWith(t.booleanLiteral(n.argument.value === 0)); s.bool++;
      } else if (n.operator === 'void' && t.isNumericLiteral(n.argument)) {
        p.replaceWith(t.identifier('undefined')); s.undef++;
      }
    },
  });
  console.log(`membres .ident: ${s.member}, booléens !0/!1: ${s.bool}, void 0→undefined: ${s.undef}`);
  const code = generate(ast, { compact: false, comments: true }).code;
  try { parser.parse(code, { sourceType: 'script', errorRecovery: false }); console.log('parse de contrôle: OK'); }
  catch (e) { console.log('parse de contrôle: ÉCHEC →', e.message.slice(0, 80)); return; }
  fs.writeFileSync(OUT, code);
  console.log(`→ écrit ${path.relative(process.cwd(), OUT)} (${(code.length / 1e6).toFixed(2)} MB)`);
}

main();
