'use strict';
/**
 * vm_host.js — PROOF OF CONCEPT : exécuter le VRAI recaptcha script dans un node:vm LÉGER
 * (sans jsdom), avec shims minimaux + auto-stub, pour voir si la collecte field16 peut tourner
 * en "full JS" plus léger que jsdom. Logue ce qui manque.
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const scriptSrc = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'recaptcha__fr.js'), 'utf8');

const missing = new Set();
function autoStub(name) {
  return new Proxy(function () {}, {
    get(t, p) {
      if (p === Symbol.toPrimitive || p === 'toString' || p === 'valueOf') return () => '';
      if (p === Symbol.iterator) return undefined;
      if (typeof p === 'string' && !(p in t)) { missing.add(name + '.' + p); }
      return autoStub(name + '.' + String(p));
    },
    apply() { return autoStub(name + '()'); },
    construct() { return autoStub('new ' + name); },
    has() { return true; },
    set() { return true; },
  });
}

// shims minimaux
const documentShim = {
  createElement: (t) => ({ getContext: () => null, setAttribute() {}, appendChild() {}, style: {}, tagName: String(t).toUpperCase() }),
  createElementNS: () => ({ }),
  getElementsByTagName: () => [],
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
  cookie: '', title: 'recaptcha demo', referrer: '', readyState: 'complete',
  documentElement: { style: {} }, head: { appendChild() {} }, body: { appendChild() {} },
  location: { href: 'https://recaptcha-demo.appspot.com/', protocol: 'https:', host: 'recaptcha-demo.appspot.com', origin: 'https://recaptcha-demo.appspot.com' },
};
const navigatorShim = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
  platform: 'Win32', language: 'en-US', languages: ['en-US', 'en'], hardwareConcurrency: 8,
  deviceMemory: 8, webdriver: false, plugins: { length: 0 }, mimeTypes: { length: 0 },
  sendBeacon: () => true, cookieEnabled: true, doNotTrack: null, maxTouchPoints: 0,
};

const sandbox = {
  // vrais objets pour que les assignations du script collent (recaptcha.anchor.Main = ...)
  recaptcha: { anchor: {}, frame: { embeddable: {}, mobile: {} } },
  ___grecaptcha_cfg: { fns: [], gor: {}, es: {}, enterprise: {} },
  __recaptcha_api: 'https://www.google.com/recaptcha/enterprise/',
  __google_recaptcha_client: true,
  trustedTypes: { createPolicy: (n, r) => r },
};
const ctx = vm.createContext(new Proxy(sandbox, {
  get(t, p) {
    if (p in t) return t[p];
    if (p === 'globalThis' || p === 'self' || p === 'window' || p === 'top' || p === 'parent') return ctx;
    if (p === 'document') return documentShim;
    if (p === 'navigator') return navigatorShim;
    if (p === 'location') return documentShim.location;
    if (p === 'performance') return { now: () => Date.now() % 100000, timeOrigin: Date.now(), getEntriesByType: () => [], mark() {}, measure() {} };
    if (p === 'console') return console;
    if (p === 'Math' || p === 'JSON' || p === 'Object' || p === 'Array' || p === 'String' || p === 'Number' ||
        p === 'Boolean' || p === 'Date' || p === 'RegExp' || p === 'Error' || p === 'TypeError' || p === 'Function' ||
        p === 'Promise' || p === 'Symbol' || p === 'Map' || p === 'Set' || p === 'WeakMap' || p === 'WeakSet' ||
        p === 'Uint8Array' || p === 'Int8Array' || p === 'Uint16Array' || p === 'Uint32Array' || p === 'Float64Array' ||
        p === 'ArrayBuffer' || p === 'DataView' || p === 'parseInt' || p === 'parseFloat' || p === 'isNaN' ||
        p === 'encodeURIComponent' || p === 'decodeURIComponent' || p === 'btoa' || p === 'atob' || p === 'TextEncoder' || p === 'TextDecoder')
      return globalThis[p];
    if (p === 'setTimeout') return (f) => { try { typeof f === 'function' && f(); } catch (_) {} return 0; };
    if (p === 'clearTimeout' || p === 'clearInterval') return () => {};
    if (p === 'setInterval') return () => 0;
    if (p === 'addEventListener' || p === 'removeEventListener' || p === 'dispatchEvent') return () => {};
    // tous les built-ins standard restants
    if (typeof p === 'string' && typeof globalThis[p] !== 'undefined' &&
        /^[A-Z]/.test(p) && (typeof globalThis[p] === 'function' || typeof globalThis[p] === 'object')) return globalThis[p];
    if (p === 'global') return ctx;
    if (typeof p === 'string') missing.add(p);
    return autoStub(String(p));
  },
  has() { return true; }, // fait croire que tout existe (évite ReferenceError)
  set(t, p, v) { t[p] = v; return true; },
}));

console.error('--- exécution du script dans node:vm léger ---');
let err = null;
try {
  vm.runInContext(scriptSrc, ctx, { filename: 'recaptcha__fr.js', timeout: 15000 });
  console.error('script exécuté sans throw fatal.');
} catch (e) { err = e; console.error('THROW:', e.message.slice(0, 200)); }

console.error('\n--- état reCAPTCHA après chargement ---');
function probe(name, obj) {
  try { console.error('  ' + name + ' = ' + (typeof obj === 'function' ? 'FUNCTION' : (obj && typeof obj === 'object' ? 'obj{' + Object.keys(obj).slice(0, 10).join(',') + '}' : typeof obj))); } catch (_) {}
}
probe('recaptcha', sandbox.recaptcha);
probe('recaptcha.anchor', sandbox.recaptcha && sandbox.recaptcha.anchor);
probe('recaptcha.anchor.Main', sandbox.recaptcha && sandbox.recaptcha.anchor && sandbox.recaptcha.anchor.Main);
probe('recaptcha.anchor.ErrorMain', sandbox.recaptcha && sandbox.recaptcha.anchor && sandbox.recaptcha.anchor.ErrorMain);
probe('___grecaptcha_cfg', sandbox.___grecaptcha_cfg);
probe('___grecaptcha_cfg.fns', sandbox.___grecaptcha_cfg && sandbox.___grecaptcha_cfg.fns);
console.error('\n--- globals manquants (non built-in) top 30 ---');
console.error([...missing].filter((m) => !m.startsWith('CLOSURE_FLAGS') && !/Array|Reflect|BigInt/.test(m)).slice(0, 30).join('\n'));
console.error('total manquants:', missing.size);

// probe final : Main.init est-il une fonction ?
try {
  const mi = sandbox.recaptcha && sandbox.recaptcha.anchor && sandbox.recaptcha.anchor.Main && sandbox.recaptcha.anchor.Main.init;
  console.error('\nMain.init type:', typeof mi, '| arity:', typeof mi==='function'?mi.length:'-');
  const fns = sandbox.___grecaptcha_cfg && sandbox.___grecaptcha_cfg.fns;
  console.error('___grecaptcha_cfg.fns:', Array.isArray(fns)?('array['+fns.length+']'):typeof fns);
} catch(e){ console.error('probe err', e.message); }
