'use strict';
/** Instrumente readable.js : wrappe chaque fn_X_i pour logger la STACK quand elle retourne le token de
 *  repli (chaîne `HF…` longue). Révèle la fonction assembleuse + la chaîne d'appel. */
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');

const IN = path.join(__dirname, '..', 'scripts', 'recaptcha_readable.js');
const OUT = path.join(__dirname, '..', 'scripts', '_readable_trace.js');
const FN_RE = /^fn_[A-Za-z]+_\d+$/;

const ast = parser.parse(fs.readFileSync(IN, 'utf8'), { sourceType: 'script', errorRecovery: true });
const byParent = new Map(); // body array (même scope que la fn) -> [wrapper]
traverse(ast, {
  FunctionDeclaration(p) {
    const id = p.node.id;
    if (!id || !FN_RE.test(id.name)) return;
    const orig = id.name, inner = orig + '__i';
    id.name = inner; // renomme la déf en __i
    const parentBody = p.getFunctionParent() ? p.getFunctionParent().node.body.body : ast.program.body;
    if (!byParent.has(parentBody)) byParent.set(parentBody, []);
    byParent.get(parentBody).push(t.functionDeclaration(t.identifier(orig), [], t.blockStatement([
      t.variableDeclaration('var', [t.variableDeclarator(t.identifier('__r'),
        t.callExpression(t.memberExpression(t.identifier(inner), t.identifier('apply')), [t.thisExpression(), t.identifier('arguments')]))]),
      t.expressionStatement(t.callExpression(t.identifier('__chk'), [t.stringLiteral(orig), t.identifier('__r')])),
      t.returnStatement(t.identifier('__r')),
    ])));
  },
});
// wrappers dans le MÊME scope que les fonctions (l'IIFE)
for (const [body, ws] of byParent) body.unshift(...ws);
// __chk global (program top → visible partout)
const chk = parser.parse(
  "var __chkDone=false;var __chk=function(name,r){try{if(!__chkDone&&typeof r==='string'&&/^HF[A-Za-z0-9_-]{300,}/.test(r)){__chkDone=true;var g=(typeof window!=='undefined'?window:(typeof self!=='undefined'?self:globalThis));g.__TOKGEN={fn:name,stack:new Error().stack};}}catch(_){}};",
  { sourceType: 'script' }).program.body;
ast.program.body.unshift(...chk);
const wrappers = [...byParent.values()].reduce((a, b) => a + b.length, 0);
fs.writeFileSync(OUT, generate(ast, { compact: false }).code);
console.log(`wrappé ${wrappers.length} fonctions → ${path.relative(process.cwd(), OUT)}`);
