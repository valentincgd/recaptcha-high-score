'use strict';
/**
 * deob_strings.js — passe 1 de déobfuscation : décode les 2138 getters de strings `NAME = g[2](sel,off,len,key)`
 * en exécutant le VRAI décodeur, puis remplace les call-sites `NAME()` par le littéral décodé.
 *
 * Étapes :
 *   1) parse (babel), collecte les getters {name, args} + repère le bloc où g[2] est en scope
 *   2) injecte une boucle de décodage juste après le dernier getter → exécute → récolte {name: string}
 *   3) remplace `NAME()` (et refs `NAME`) par le littéral, supprime les déclarations de getters
 *
 * Usage : node tools/deob_strings.js [--collect] [--apply]
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');

const SRC = path.join(__dirname, '..', 'scripts', 'recaptcha_pretty.js');
const STRINGS_JSON = path.join(__dirname, '..', 'scripts', 'rc_strings.json');
const OUT = path.join(__dirname, '..', 'scripts', 'recaptcha_readable.js');

// Un getter de string = `NAME = g[2](n1, n2, n3, n4)` avec 4 littéraux numériques (n1 = sélecteur).
function isStringGetterInit(node) {
  if (!t.isCallExpression(node)) return false;
  const c = node.callee;
  if (!t.isMemberExpression(c) || !t.isIdentifier(c.object, { name: 'g' })) return false;
  if (!t.isNumericLiteral(c.property, { value: 2 })) return false;
  if (node.arguments.length !== 4) return false;
  return node.arguments.every(a => t.isNumericLiteral(a) || (t.isUnaryExpression(a) && a.operator === '-' && t.isNumericLiteral(a.argument)));
}
const numVal = (a) => t.isUnaryExpression(a) ? -a.argument.value : a.value;

function collectGetters(ast) {
  const getters = []; // {name, args:[4], declaratorPath}
  traverse(ast, {
    VariableDeclarator(p) {
      if (t.isIdentifier(p.node.id) && p.node.init && isStringGetterInit(p.node.init)) {
        getters.push({ name: p.node.id.name, args: p.node.init.arguments.map(numVal) });
      }
    },
  });
  return getters;
}

// Construit une source instrumentée : la boucle de décodage est insérée JUSTE APRÈS le bloc des getters
// (dernier statement contenant un getter g[2]) → elle s'exécute avant tout throw ultérieur de l'IIFE.
function instrument(src, getters) {
  const list = JSON.stringify(getters.map(g => [g.name, ...g.args]));
  const dump = `try{var __L=${list},__m=(typeof window!=='undefined'?window:globalThis).__RCSTR||{};` +
    `for(var __i=0;__i<__L.length;__i++){try{var __e=__L[__i];var __f=g[2](__e[1],__e[2],__e[3],__e[4]);__m[__e[0]]=(typeof __f==='function'?__f():__f);}catch(_){}}` +
    `(typeof window!=='undefined'?window:globalThis).__RCSTR=__m;}catch(_){}`;
  const ast = parser.parse(src, { sourceType: 'script', errorRecovery: true });
  let lastStmt = null, lastEnd = -1;
  traverse(ast, {
    VariableDeclarator(p) {
      if (t.isIdentifier(p.node.id) && p.node.init && isStringGetterInit(p.node.init)) {
        const stmt = p.getStatementParent();
        if (stmt && stmt.node.end > lastEnd) { lastEnd = stmt.node.end; lastStmt = stmt; }
      }
    },
  });
  if (!lastStmt) throw new Error('aucun getter trouvé pour injection');
  const dumpAst = parser.parse(dump, { sourceType: 'script' }).program.body;
  lastStmt.insertAfter(dumpAst);
  return generate(ast, { compact: true }).code;
}

// Essai rapide : vm plain avec global très permissif (au cas où le setup est pur).
function runVm(instrumented) {
  let proxyStub;
  proxyStub = new Proxy(function () { return proxyStub; }, {
    get(_, p) { if (p === Symbol.toPrimitive) return () => 0; if (p === 'then') return undefined; if (p === Symbol.iterator) return undefined; return proxyStub; },
    apply() { return proxyStub; }, construct() { return proxyStub; }, set() { return true; }, has() { return true; },
  });
  const sandbox = new Proxy({ __RCSTR: null }, {
    get(t2, prop) { if (prop in t2) return t2[prop]; if (typeof prop === 'symbol') return undefined; return proxyStub; },
    set(t2, prop, v) { t2[prop] = v; return true; }, has() { return true; },
  });
  const ctx = vm.createContext(sandbox);
  let err = null;
  try { vm.runInContext(instrumented, ctx, { timeout: 30000 }); } catch (e) { err = e && (e.message !== undefined ? e.message : e); }
  return { got: sandbox.__RCSTR, err };
}

// Fallback fiable : jsdom + installShims (env navigateur prouvé du harness).
async function runJsdom(instrumented) {
  const { JSDOM, VirtualConsole } = require('jsdom');
  const { installShims } = require('./shims');
  const vc = new VirtualConsole(); // silencieux
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'https://www.google.com/recaptcha/api2/anchor',
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
  });
  const window = dom.window;
  try { installShims(window, { origin: 'https://www.google.com', logger: () => {} }); } catch (_) {}
  const s = window.document.createElement('script');
  s.textContent = instrumented;
  window.document.head.appendChild(s);
  await new Promise(r => setTimeout(r, 1500));
  const got = window.__RCSTR ? Object.assign({}, window.__RCSTR) : null;
  try { window.close(); } catch (_) {}
  return { got };
}

// Passe d'application : remplace chaque `NAME()` (référence de scope du getter, 0 arg) par le littéral
// décodé, puis supprime la déclaration du getter. Utilise les bindings babel → sûr vis-à-vis des
// propriétés homonymes (`.iH`) et des occurrences dans le blob encodé.
function applyStrings(src, strMap) {
  const ast = parser.parse(src, { sourceType: 'script', errorRecovery: true });
  const stats = { calls: 0, bareRefs: 0, declsRemoved: 0, declsKept: 0, getters: 0 };
  const targets = []; // {name, declPath, value}
  traverse(ast, {
    VariableDeclarator(p) {
      const id = p.node.id;
      if (t.isIdentifier(id) && Object.prototype.hasOwnProperty.call(strMap, id.name) && p.node.init && isStringGetterInit(p.node.init)) {
        targets.push({ name: id.name, declPath: p, value: strMap[id.name] });
      }
    },
  });
  for (const { name, declPath, value } of targets) {
    stats.getters++;
    const binding = declPath.scope.getBinding(name);
    if (!binding) { stats.declsKept++; continue; }
    let bare = 0;
    for (const ref of binding.referencePaths) {
      const parent = ref.parentPath;
      if (parent && parent.isCallExpression() && parent.node.callee === ref.node && parent.node.arguments.length === 0) {
        parent.replaceWith(t.stringLiteral(value));
        stats.calls++;
      } else {
        bare++;
      }
    }
    if (bare === 0) { declPath.remove(); stats.declsRemoved++; }
    else { declPath.node.init = t.functionExpression(null, [], t.blockStatement([t.returnStatement(t.stringLiteral(value))])); stats.declsKept++; stats.bareRefs += bare; }
  }
  const code = generate(ast, { compact: false, retainLines: false, comments: true }).code;
  return { code, stats };
}

async function main() {
  const src = fs.readFileSync(SRC, 'utf8');
  const ast = parser.parse(src, { sourceType: 'script', errorRecovery: true });
  const getters = collectGetters(ast);
  console.log(`getters collectés: ${getters.length}`);
  console.log('exemples:', getters.slice(0, 3).map(g => `${g.name}=g[2](${g.args})`).join('  '));

  const instrumented = instrument(src, getters);

  console.log('\n[1] vm plain (setup pur ?)…');
  let { got, err } = runVm(instrumented);
  let n = got ? Object.keys(got).length : 0;
  console.log(`  décodées: ${n}/${getters.length}${err !== null && err !== undefined ? '  (throw: ' + String(err).slice(0, 60) + ')' : ''}`);

  if (n < getters.length * 0.5) {
    console.log('\n[2] fallback jsdom + installShims…');
    try { ({ got } = await runJsdom(instrumented)); n = got ? Object.keys(got).length : 0; }
    catch (e) { console.log('  jsdom err:', e.message); }
    console.log(`  décodées: ${n}/${getters.length}`);
  }

  if (!n) { console.log('\n(0 décodé — ni vm ni jsdom)'); return; }
  for (const [k, v] of Object.entries(got).slice(0, 14)) console.log(`    ${k} = ${JSON.stringify(String(v)).slice(0, 70)}`);
  fs.writeFileSync(STRINGS_JSON, JSON.stringify(got, null, 0));
  console.log(`\n→ ${n} strings sauvées dans ${path.relative(process.cwd(), STRINGS_JSON)}`);

  console.log('\n[3] application (remplacement des call-sites + parse de contrôle)…');
  const { code, stats } = applyStrings(src, got);
  console.log(`  getters:${stats.getters} call-sites remplacés:${stats.calls} decls supprimées:${stats.declsRemoved} decls gardées(refs bare):${stats.declsKept} refs bare:${stats.bareRefs}`);
  try { parser.parse(code, { sourceType: 'script', errorRecovery: false }); console.log('  parse de contrôle: OK (JS valide)'); }
  catch (e) { console.log('  parse de contrôle: ÉCHEC →', e.message.slice(0, 80)); }
  fs.writeFileSync(OUT, code);
  console.log(`  → écrit ${path.relative(process.cwd(), OUT)} (${(code.length / 1e6).toFixed(2)} MB)`);
}

main();
