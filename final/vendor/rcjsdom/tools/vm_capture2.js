'use strict';
/**
 * vm_capture2.js — exécuter le VRAI recaptcha__fr.js dans node:vm avec shims robustes,
 * pour faire tourner Main.init et capturer le vrai token 05AL (bg / champ 7).
 * autoStub est array-like (map/forEach/length/iterator) pour survivre aux (x||[]).map.
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');
process.on('unhandledRejection', (e) => console.error('REJECT:', String((e && e.message) || e).slice(0, 160)));
process.on('uncaughtException', (e) => console.error('UNCAUGHT:', String((e && e.message) || e).slice(0, 160)));

const SCRIPT = path.join(__dirname, '..', 'scripts', 'recaptcha__fr.js');
let scriptSrc = fs.readFileSync(SCRIPT, 'utf8');
// INJECTION diagnostic : logger au point d'envoi de la requête C/z (build du message bg)
scriptSrc = scriptSrc.replace('A.v(P[34](v[2],2,b,B,C,z),2)', '(typeof __inspect==="function"&&__inspect(A,P,b,B,C,z),A.v((typeof __bgReqMsg==="function"?__bgReqMsg(C,B,z,P[34](v[2],2,b,B,C,z)):P[34](v[2],2,b,B,C,z)),2))');
// capturer chaque Deferred C/z à sa création (map id→deferred) pour le résoudre avec la vraie réponse worker
scriptSrc = scriptSrc.replace('b[v[1]].set(C,J)', '(typeof __bgDef==="function"&&__bgDef(C,J,z,B),b[v[1]].set(C,J))');
const missing = new Set();

const ARRAY_METHODS = new Set(['map','forEach','filter','reduce','reduceRight','slice','concat','indexOf','lastIndexOf','join','push','pop','shift','unshift','splice','find','findIndex','some','every','includes','fill','flat','flatMap','sort','reverse','keys','values','entries']);

function autoStub(name) {
  const fn = function () {};
  return new Proxy(fn, {
    get(t, p) {
      if (p === Symbol.toPrimitive) return () => 0;
      if (p === 'toString' || p === 'valueOf') return () => '';
      if (p === Symbol.iterator) return function* () {};
      if (p === 'length') return 0;
      if (typeof p === 'string' && ARRAY_METHODS.has(p)) return () => autoStub(name + '.' + p + '()');
      if (typeof p === 'string' && !(p in t)) missing.add(name + '.' + p);
      return autoStub(name + '.' + String(p));
    },
    apply() { return autoStub(name + '()'); },
    construct() { return autoStub('new ' + name); },
    has() { return true; },
    set() { return true; },
  });
}

// shims via Proxy : props connues réelles, inconnues → autoStub (donc array-like)
function shimProxy(realObj, label) {
  return new Proxy(realObj, {
    get(t, p) {
      if (p in t) return t[p];
      if (typeof p === 'string') missing.add(label + '.' + p);
      return autoStub(label + '.' + String(p));
    },
    has() { return true; },
    set(t, p, v) { if (p === 'src' && typeof v === 'string' && v.length > 8) console.error('EL.src = ' + v.slice(0, 140)); t[p] = v; return true; },
  });
}

function mkEl() {
  return shimProxy({
    value: '', textContent: '', innerHTML: '', innerText: '', id: '', className: '', tagName: 'DIV', nodeType: 1, nodeName: 'DIV',
    style: {}, dataset: {}, attributes: [], childNodes: [], children: [],
    getContext: () => null, setAttribute() {}, getAttribute: () => null, removeAttribute() {}, hasAttribute: () => false,
    appendChild(x) { return x; }, insertBefore(x) { return x; }, removeChild(x) { return x; }, replaceChild(x) { return x; },
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true, contains: () => false,
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }),
    querySelector: () => null, querySelectorAll: () => [], focus() {}, blur() {}, click() {}, remove() {},
    parentNode: null, parentElement: null, ownerDocument: null, offsetParent: null, offsetWidth: 0, offsetHeight: 0,
    get contentWindow() { return frameWindow; }, get contentDocument() { return frameWindow && frameWindow.document; },
  }, 'el');
}
let frameWindow = null;
const documentReal = {
  createElement: (tag) => shimProxy({ getContext: () => null, setAttribute() {}, appendChild() {}, style: {}, tagName: String(tag).toUpperCase(), getBoundingClientRect: () => ({ x:0,y:0,width:0,height:0,top:0,left:0,right:0,bottom:0 }) }, 'el'),
  createElementNS: () => shimProxy({}, 'elNS'),
  getElementsByTagName: () => [], getElementsByClassName: () => [],
  getElementById: () => mkEl(), getElementsByName: () => [mkEl()],
  querySelector: () => mkEl(), querySelectorAll: () => [],
  createTextNode: (s) => shimProxy({ nodeValue: String(s), textContent: String(s) }, 'textNode'),
  hasStorageAccess: () => Promise.resolve(false), requestStorageAccess: () => Promise.resolve(),
  currentScript: null, scripts: [], forms: [], images: [], links: [],
  addEventListener() {}, removeEventListener() {}, createEvent: () => ({ initEvent() {} }),
  cookie: '', title: 'recaptcha', referrer: 'https://auth.ticketmaster.com/', readyState: 'complete', hidden: false, visibilityState: 'visible', contentType: 'text/html', characterSet: 'UTF-8', charset: 'UTF-8', compatMode: 'CSS1Compat',
  documentElement: { style: {}, clientWidth: 1280, clientHeight: 720, lang: 'fr', appendChild(){}, insertBefore(){}, removeChild(){}, contains: () => false, setAttribute(){}, getAttribute: () => null },
  head: { appendChild(x){return x;}, insertBefore(x){return x;}, removeChild(x){return x;}, contains: () => false, querySelector: () => null, querySelectorAll: () => [] },
  body: { appendChild(x){return x;}, insertBefore(x){return x;}, removeChild(x){return x;}, contains: () => false, style:{}, setAttribute(){}, getAttribute: () => null, querySelector: () => null, querySelectorAll: () => [] },
  location: { href: 'https://auth.ticketmaster.com/', protocol: 'https:', host: 'auth.ticketmaster.com', hostname: 'auth.ticketmaster.com', origin: 'https://auth.ticketmaster.com', pathname: '/', search: '', hash: '' },
};
const navigatorReal = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
  appVersion: '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
  platform: 'Win32', language: 'fr-FR', languages: ['fr-FR', 'fr', 'en-US', 'en'], hardwareConcurrency: 8,
  deviceMemory: 8, webdriver: false, vendor: 'Google Inc.', product: 'Gecko', productSub: '20030107', appName: 'Netscape', appCodeName: 'Mozilla',
  plugins: [], mimeTypes: [], sendBeacon: () => true, cookieEnabled: true, doNotTrack: null, maxTouchPoints: 0, onLine: true,
  userAgentData: {
    brands: [{ brand: 'Not;A=Brand', version: '8' }, { brand: 'Chromium', version: '150' }, { brand: 'Google Chrome', version: '150' }],
    fullVersionList: [{ brand: 'Not;A=Brand', version: '8.0.0.0' }, { brand: 'Chromium', version: '150.0.7871.129' }, { brand: 'Google Chrome', version: '150.0.7871.129' }],
    mobile: false, platform: 'Windows',
    getHighEntropyValues: () => Promise.resolve({ platform: 'Windows', platformVersion: '15.0.0', architecture: 'x86', bitness: '64', model: '', uaFullVersion: '150.0.7871.129', fullVersionList: [] }),
    toJSON: () => ({ brands: [], mobile: false, platform: 'Windows' }),
  },
  getBattery: () => Promise.resolve({ charging: true, level: 1, chargingTime: 0, dischargingTime: Infinity, addEventListener() {} }),
  permissions: { query: () => Promise.resolve({ state: 'granted', addEventListener() {} }) },
  connection: { effectiveType: '4g', rtt: 50, downlink: 10, saveData: false, addEventListener() {} },
  cookieDeprecationLabel: { getValue: () => Promise.resolve('') },
};
function storageShim() { const m = new Map(); return { getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null), setItem: (k, v) => m.set(String(k), String(v)), removeItem: (k) => m.delete(String(k)), clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } }; }
const localStorageReal = storageShim();
const sessionStorageReal = storageShim();
const perfReal = { now: () => Date.now() % 100000, timeOrigin: Date.now() - 100000, getEntries: () => [], getEntriesByType: () => [], getEntriesByName: () => [], mark() {}, measure() {}, clearMarks() {}, clearMeasures() {}, timing: {}, navigation: {} };

const sandbox = {
  recaptcha: { anchor: {}, frame: { embeddable: {}, mobile: {} } },
  ___grecaptcha_cfg: { fns: [], gor: [], es: [], enterprise: [] },
  __recaptcha_api: 'https://www.google.com/recaptcha/enterprise/',
  __google_recaptcha_client: true,
  trustedTypes: { createPolicy: (n, r) => r, emptyHTML: '', emptyScript: '' },
  __captured05AL: [],
  __blobs: [],
  __bgCalls: [],
  __bgInst: null,
  __chans: {},
  __winMsgs: [],
  __anchorReqs: [],
  __setupPort: null,
  __workers: [],
  __inspect: (A, P, b, B, C, z) => {
    if (bgReqs.length > 0) return; // une seule fois
    try {
      console.error('=== INSPECT au point d\'envoi ===');
      console.error('A type=' + typeof A + ' keys=' + (A ? Object.keys(A).slice(0, 20).join(',') : ''));
      console.error('A.v = ' + (A && A.v ? String(A.v).slice(0, 200).replace(/\n/g, ' ') : 'n/a'));
      console.error('P[34] = ' + (P && P[34] ? String(P[34]).slice(0, 300).replace(/\n/g, ' ') : 'n/a'));
      console.error('b type=' + typeof b + ' keys=' + (b ? Object.keys(b).slice(0, 15).join(',') : ''));
      // b.M est la map des deferred ; b a peut-être le canal/port
      try { console.error('b.v (port envoi) __chan=' + (b.v && b.v.__chan) + ' __side=' + (b.v && b.v.__side)); } catch (_) {}
      try { if (b.A) { console.error('b.A.port1 __chan=' + (b.A.port1 && b.A.port1.__chan) + b.A.port1.__side + ' | port2 __chan=' + (b.A.port2 && b.A.port2.__chan) + b.A.port2.__side); } } catch (_) {}
      // sauver une référence globale au port d'envoi pour l'instrumenter
      try { INSPECT_SEND_PORT = b.v; INSPECT_B = b; } catch (_) {}
    } catch (e) { console.error('inspect err:', e.message); }
  },
  __apLog: (n, ap, h3) => { try { console.error('★ HANDLER message reçu : n=' + JSON.stringify(n) + ' ap=' + JSON.stringify(ap) + ' h3=' + JSON.stringify(h3) + ' match=' + (n === ap || n === h3)); } catch (_) {} },
  __bgReqMsg: (C, B, z, msg) => {
    try {
      if (process.env.DBG === '1' && bgReqs.length === 0) { debugger; }
      bgReqs.push({ C, B, z, msg });
      let zdesc = typeof z;
      try { if (z && typeof z === 'object') zdesc = 'obj{' + Object.keys(z).slice(0, 8).join(',') + '} ' + JSON.stringify(z).slice(0, 80); } catch (_) {}
      console.error('★REQ ' + B + ' id=' + C + ' | z=' + zdesc + ' | msg=' + JSON.stringify(msg).slice(0, 40));
      try { console.error('  P[34] result type=' + typeof msg + ' keys=' + (msg && typeof msg === 'object' ? Object.keys(msg).slice(0, 15).join(',') : '') + ' then=' + (msg && typeof msg.then === 'function')); } catch (_) {}
      try { fs.writeFileSync(path.join(__dirname, 'z_' + B + '.json'), JSON.stringify(z, null, 0)); } catch (_) {}
      // FORCE : déclencher l'executor lazy du thenable → le vrai b.v.postMessage(message) devrait firer
      try { if (msg && typeof msg.then === 'function') { msg.then((r) => console.error('  THENABLE ' + B + ' RÉSOLU: ' + (typeof r === 'string' ? r.slice(0, 40) : JSON.stringify(r).slice(0, 50))), (e) => console.error('  THENABLE ' + B + ' REJETÉ: ' + String(e).slice(0, 40))); } } catch (_) {}
      try { const proto = Object.getPrototypeOf(msg); console.error('  thenable proto methods=' + (proto ? Object.getOwnPropertyNames(proto).slice(0, 12).join(',') : '')); } catch (_) {}
    } catch (_) {}
    return msg;
  },
  __bgDef: (C, J, z, B) => { try { bgDefs.push({ C, J, z, B }); bgDefMap[C] = J; } catch (_) {} },
  botguard: { bg: function () {} },
};

const recent = [];
let timerId = 1;
let chanId = 0;
const timerQ = [];
const listeners = {};
const bgDefs = [];
const bgReqs = [];
const bgDefMap = {};
let INSPECT_SEND_PORT = null, INSPECT_B = null;
let RESOLVE_VAL = process.env.RV === 'jarr' ? '[]' : process.env.RV === 'jnull' ? 'null' : process.env.RV === 'jobj' ? '{}' : process.env.RV === 'jconf' ? '["conf",null,null,0]' : '[]';
function makeMessageChannel() {
  const cid = ++chanId;
  const a = { ls: [], onmessage: null }, b = { ls: [], onmessage: null };
  const mk = (mine, other, nm) => ({
    __chan: cid, __side: nm,
    postMessage: (data, transfer) => {
      const tports = Array.isArray(transfer) ? transfer.filter((x) => x && x.postMessage) : [];
      try { console.error('PORT ' + cid + nm + ' → ' + (typeof data === 'string' ? data.slice(0, 55) : JSON.stringify(data).slice(0, 70)) + (tports.length ? ' +transfer[' + tports.map((x) => x.__chan + x.__side).join(',') + ']' : '')); } catch (_) {}
      timerQ.push({ ms: 0, fn: () => { const ev = { data, ports: tports, type: 'message', origin: 'https://www.google.com' }; for (const h of other.ls) { try { h(ev); } catch (_) {} } if (other.onmessage) { try { other.onmessage(ev); } catch (_) {} } } });
      // ★ répondeur universel de handshake : "recaptcha-setup" reçu → réponse mutuelle setup+port
      if (data === 'recaptcha-setup') {
        timerQ.push({ ms: 1, fn: () => { try { const ch = makeMessageChannel(); const rev = { data: 'recaptcha-setup', ports: [ch.port2], type: 'message', origin: 'https://auth.ticketmaster.com', source: {} }; for (const h of mine.ls) { try { h(rev); } catch (_) {} } if (mine.onmessage) { try { mine.onmessage(rev); } catch (_) {} } } catch (_) {} } });
      }
    },
    addEventListener: (t, f) => { if (t === 'message' && typeof f === 'function') { const wf = (ev) => { try { console.error('PORT ' + cid + nm + ' RECV: ' + (typeof ev.data === 'string' ? ev.data.slice(0, 50) : JSON.stringify(ev.data).slice(0, 50)) + (ev.ports && ev.ports.length ? ' +ports' : '')); } catch (_) {} return f(ev); }; mine.ls.push(wf); } },
    removeEventListener: () => {}, start() { console.error('PORT ' + cid + nm + ' start()'); }, close() {},
    set onmessage(f) { mine.onmessage = f; console.error('PORT ' + cid + nm + ' onmessage= set'); }, get onmessage() { return mine.onmessage; },
  });
  const ports = { port1: mk(a, b, 'p1'), port2: mk(b, a, 'p2') };
  return ports;
}
// ── VRAI Worker : exécute recaptcha__fr.js (importScripts) dans un contexte vm séparé, bridgé au main.
//    C'est là que tourne le bg VM (botguard). En mode worker : pas de document/window → le script
//    détecte le mode worker. On instrumente botguard.bg DANS ce contexte.
function makeWorker(scriptSrc, autoStub, timerQ) {
  const mainLs = [], mainOnmsg = { v: null };   // côté main (Worker object)
  const workerLs = [], workerOnmsg = { v: null }; // côté worker (self.onmessage)
  const wsandbox = { __captured05AL: [], __bgCalls: [], __bgInst: null, botguard: { bg: function () {} }, recaptcha: { anchor: {}, frame: { embeddable: {}, mobile: {} } }, ___grecaptcha_cfg: {}, __recaptcha_api: 'https://www.google.com/recaptcha/enterprise/', __google_recaptcha_client: true, trustedTypes: { createPolicy: (n, r) => r } };
  const wref = { v: null };
  let winspected = false;
  const wnav = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36', hardwareConcurrency: 8, deviceMemory: 8, language: 'fr-FR', languages: ['fr-FR', 'fr'], platform: 'Win32', onLine: true, userAgentData: { brands: [{ brand: 'Chromium', version: '150' }], mobile: false, platform: 'Windows', getHighEntropyValues: () => Promise.resolve({ platform: 'Windows' }) } };
  let wctx;
  const wproxy = new Proxy(wsandbox, {
    get(t, p) {
      if (p in t) return t[p];
      // mode WORKER : PAS de document/window/parent/top (le script détecte le mode worker par leur absence)
      if (p === 'document' || p === 'window' || p === 'parent' || p === 'top' || p === 'frames' || p === 'frameElement') return undefined;
      if (p === '__inspect') return (A, P, b, B, C, z) => { if (winspected) return; winspected = true; try { console.error('=== WORKER INSPECT (envoi) ==='); console.error('W b.v __chan=' + (b && b.v && b.v.__chan) + (b && b.v && b.v.__side)); console.error('W P[34]=' + (P && P[34] ? String(P[34]).slice(0, 250).replace(/\n/g, ' ') : 'n/a')); } catch (_) {} };
      if (p === '__bgReqMsg') return (C, B, z, msg) => { try { console.error('WORKER ★REQ ' + B + ' id=' + C + ' z=' + (typeof z === 'object' ? JSON.stringify(z).slice(0, 70) : z)); } catch (_) {} return msg; };
      if (p === '__bgDef') return () => {};
      if (p === 'self' || p === 'globalThis' || p === 'global') return wref.v;
      if (p === 'navigator') return wnav;
      if (p === 'location') return { href: 'https://www.google.com/recaptcha/', origin: 'https://www.google.com', protocol: 'https:', host: 'www.google.com' };
      if (p === 'console') return console;
      if (p === 'postMessage') return (data, transfer) => {
        const ports = Array.isArray(transfer) ? transfer.filter((x) => x && x.postMessage) : [];
        try { console.error('WORKER→anchor: ' + (typeof data === 'string' ? data.slice(0, 55) : JSON.stringify(data).slice(0, 60)) + ' ports=' + ports.length); } catch (_) {}
        // ★ le harness (jouant le parent du worker) grab le port du worker + catche ses réponses
        try {
          if (data === 'recaptcha-setup' && ports[0] && !wsandbox.__wport) {
            wsandbox.__wport = ports[0];
            console.error('★★ harness grab le port du worker → écoute réponses + routera les requêtes');
            ports[0].addEventListener('message', (ev) => {
              try {
                const d = ev.data;
                console.error('WORKER port→ ' + (typeof d === 'string' ? d.slice(0, 50) : JSON.stringify(d).slice(0, 70)));
                if (Array.isArray(d) && d.length >= 3 && bgDefMap[d[2]]) { const J = bgDefMap[d[2]]; delete bgDefMap[d[2]]; console.error('★★★ worker répond (port) → résous ' + d[2]); timerQ.push({ ms: 0, fn: () => { try { J.resolve(d[0]); } catch (_) {} } }); }
              } catch (_) {}
            });
            ports[0].start && ports[0].start();
          }
        } catch (_) {}
        // ★ si le worker répond avec un id de Deferred connu → résous C/z avec la VRAIE réponse bg
        try { if (Array.isArray(data) && data.length >= 3 && bgDefMap[data[2]]) { const J = bgDefMap[data[2]]; delete bgDefMap[data[2]]; console.error('★★★ WORKER répond → résous Deferred ' + data[2]); timerQ.push({ ms: 0, fn: () => { try { J.resolve(data[0]); } catch (_) {} } }); } } catch (_) {}
        timerQ.push({ ms: 0, fn: () => { const ev = { data, type: 'message', origin: 'https://www.google.com', ports }; for (const h of mainLs) { try { h(ev); } catch (_) {} } if (mainOnmsg.v) { try { mainOnmsg.v(ev); } catch (_) {} } } });
      };
      if (p === 'addEventListener') return (ty, f) => { if (ty === 'message' && typeof f === 'function') { workerLs.push(f); console.error('WORKER addEventListener(message)'); } };
      if (p === 'removeEventListener') return () => {};
      if (p === 'onmessage') return workerOnmsg.v;
      if (p === 'importScripts') return (...us) => { for (const u of us) { if (/recaptcha__/.test(String(u))) { try { vm.runInContext(scriptSrc, wctx, { filename: 'worker-recaptcha.js', timeout: 20000 }); } catch (e) { console.error('WORKER script THROW:', String(e.message).slice(0, 120)); } } } };
      if (p === 'setTimeout') return (f, ms) => { if (typeof f === 'function') timerQ.push({ fn: f, ms: Number(ms) || 0 }); return 1; };
      if (p === 'clearTimeout' || p === 'clearInterval') return () => {};
      if (p === 'setInterval') return () => 0;
      if (p === 'crypto') return globalThis.crypto;
      if (p === 'atob') return globalThis.atob; if (p === 'btoa') return globalThis.btoa;
      if (p === 'JSON') return { parse: (s) => { try { if (typeof s === 'string' && s.length > 3 && s.length < 400) console.error('WORKER JSON.parse(' + JSON.stringify(s).slice(0, 120) + ')'); } catch (_) {} return globalThis.JSON.parse(s); }, stringify: globalThis.JSON.stringify };
      if (p === 'MessageChannel') return makeMessageChannel;
      if (p === 'fetch') return () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(''), arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)), json: () => Promise.resolve({}) });
      if (p === 'importScripts') return () => {};
      if (typeof p === 'string' && typeof globalThis[p] !== 'undefined' && (/^[A-Z]/.test(p) || ['parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent'].includes(p))) return globalThis[p];
      if (typeof p === 'symbol') return undefined;
      return autoStub('W.' + String(p));
    },
    has() { return true; },
    set(t, p, v) {
      if (p === 'onmessage') { workerOnmsg.v = v; console.error('WORKER self.onmessage= set'); return true; }
      if (p === 'botguard' && v && (typeof v === 'object' || typeof v === 'function') && !v.__wrapped && typeof v.bg === 'function') {
        const o = v.bg; v.__wrapped = true;
        v.bg = function (z, cb) { try { const zs = typeof z === 'string' ? z : JSON.stringify(z); wsandbox.__bgCalls.push(zs.slice(0, 100)); console.error('★★★ WORKER botguard.bg(z) len=' + zs.length); } catch (_) {} const inst = new o(z, cb); wsandbox.__bgInst = inst; return inst; };
      }
      t[p] = v; return true;
    },
  });
  wctx = vm.createContext(wproxy); wref.v = wctx;
  // le worker démarre en exécutant webworker.js = importScripts(recaptcha__fr.js) → on lance le script
  try { vm.runInContext(scriptSrc, wctx, { filename: 'worker-recaptcha.js', timeout: 20000 }); console.error('  ✓ script worker chargé'); }
  catch (e) { console.error('  WORKER init THROW: ' + String(e.message).slice(0, 120)); }
  const workerObj = {
    __wsandbox: wsandbox,
    postMessage: (data, transfer) => { const ports = Array.isArray(transfer) ? transfer.filter((x) => x && x.postMessage) : []; try { console.error('anchor→WORKER: ' + (typeof data === 'string' ? data.slice(0, 55) : JSON.stringify(data).slice(0, 60)) + ' ports=' + ports.length); } catch (_) {} timerQ.push({ ms: 0, fn: () => { const ev = { data, type: 'message', origin: 'https://auth.ticketmaster.com', ports }; for (const h of workerLs) { try { h(ev); } catch (_) {} } if (workerOnmsg.v) { try { workerOnmsg.v(ev); } catch (_) {} } } }); },
    addEventListener: (ty, f) => { if (ty === 'message' && typeof f === 'function') { mainLs.push(f); console.error('anchor Worker.addEventListener(message)'); } },
    removeEventListener: () => {}, terminate() {},
    set onmessage(f) { mainOnmsg.v = f; }, get onmessage() { return mainOnmsg.v; },
  };
  return workerObj;
}

function XHRStub() {
  this.readyState = 0; this.status = 0; this.response = ''; this.responseText = ''; this.responseType = '';
  this.open = () => { this.readyState = 1; };
  this.setRequestHeader = () => {};
  this.getResponseHeader = () => null; this.getAllResponseHeaders = () => '';
  this.addEventListener = (ev, cb) => { if (ev === 'load' || ev === 'loadend' || ev === 'readystatechange') this['on' + ev] = cb; };
  this.removeEventListener = () => {};
  this.abort = () => {};
  this.send = () => { this.readyState = 4; this.status = 200; this.response = ''; this.responseText = '';
    timerQ.push({ ms: 0, fn: () => { try { this.onreadystatechange && this.onreadystatechange(); } catch (_) {} try { this.onload && this.onload(); } catch (_) {} try { this.onloadend && this.onloadend(); } catch (_) {} } }); };
}
const ctx = vm.createContext(new Proxy(sandbox, {
  get(t, p) {
    if (typeof p === 'string') { recent.push(p); if (recent.length > 16) recent.shift(); }
    if (p in t) return t[p];
    if (p === 'globalThis' || p === 'self' || p === 'window' || p === 'top' || p === 'parent' || p === 'frames') return ctxProxyRef.v;
    if (p === 'document') return docShim;
    if (p === 'navigator') return navShim;
    if (p === 'location') return documentReal.location;
    if (p === 'performance') return perfShim;
    if (p === 'console') return console;
    if (p === 'screen') return { width: 1280, height: 720, availWidth: 1280, availHeight: 680, colorDepth: 24, pixelDepth: 24 };
    if (p === 'localStorage') return localStorageReal;
    if (p === 'sessionStorage') return sessionStorageReal;
    if (p === 'MessageChannel') return makeMessageChannel;
    if (p === 'devicePixelRatio') return 1;
    if (p === 'origin') return 'https://auth.ticketmaster.com';
    if (p === 'crypto') return globalThis.crypto;
    if (p === 'TextEncoder' || p === 'TextDecoder' || p === 'URL' || p === 'URLSearchParams') return globalThis[p];
    if (p === 'setTimeout') return (f, ms) => { if (typeof f === 'function') timerQ.push({ fn: f, ms: Number(ms) || 0 }); return timerId++; }; // file drainable, délai respecté
    if (p === 'clearTimeout' || p === 'clearInterval') return () => {};
    if (p === 'setInterval') return () => 0;
    if (p === 'requestAnimationFrame') return (f) => { if (typeof f === 'function') timerQ.push({ ms: 16, fn: () => f(Date.now() % 1e5) }); return timerId++; };
    if (p === 'requestIdleCallback') return (f) => { if (typeof f === 'function') timerQ.push({ ms: 1, fn: () => f({ timeRemaining: () => 50, didTimeout: false }) }); return timerId++; };
    if (p === 'queueMicrotask') return (f) => { if (typeof f === 'function') Promise.resolve().then(f); };
    if (p === 'fetch') return () => Promise.resolve({ ok: true, status: 200, statusText: 'OK', headers: { get: () => null, has: () => false }, text: () => Promise.resolve(''), json: () => Promise.resolve({}), arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)), blob: () => Promise.resolve({}), clone() { return this; } });
    if (p === 'XMLHttpRequest') return XHRStub;
    if (p === 'cancelAnimationFrame' || p === 'cancelIdleCallback') return () => {};
    if (p === 'addEventListener') return (type, fn) => {
      if (typeof fn === 'function') {
        (listeners[type] = listeners[type] || []).push(fn);
        // dès que l'anchor écoute 'message' : le PARENT TM initie le handshake (comme dans le browser)
        if (type === 'message' && !sandbox.__parentInited) {
          sandbox.__parentInited = true;
          timerQ.push({ ms: 5, fn: () => {
            const ev = { data: 'recaptcha-setup', origin: 'https://auth.ticketmaster.com', source: ctxProxyRef.v, ports: [], type: 'message' };
            console.error('★★ PARENT TM initie le handshake (recaptcha-setup ports=0)');
            for (const l of (listeners.message || [])) { try { l(ev); } catch (_) {} }
            if (sandbox.onmessage) { try { sandbox.onmessage(ev); } catch (_) {} }
          } });
        }
      }
    };
    if (p === 'removeEventListener') return (type, fn) => { if (listeners[type]) listeners[type] = listeners[type].filter((x) => x !== fn); };
    if (p === 'dispatchEvent') return (ev) => { const ls = listeners[ev && ev.type] || []; for (const l of ls) { try { l(ev); } catch (_) {} } return true; };
    if (p === 'postMessage') return (data, origin, ports) => {
      try { console.error('window.postMessage:', (typeof data === 'string' ? data.slice(0, 100) : JSON.stringify(data).slice(0, 140)), '| ports=' + (ports ? ports.length : 0) + (ports && ports[0] ? ' chan' + ports[0].__chan + ports[0].__side : '')); sandbox.__winMsgs.push({ data: typeof data === 'string' ? data : JSON.stringify(data).slice(0, 200), ports: (ports || []).map((x) => x && x.__chan + x.__side) }); } catch (_) {}
      timerQ.push({ ms: 0, fn: () => { const ev = { data, origin: origin === '*' || !origin ? 'https://auth.ticketmaster.com' : origin, source: ctxProxyRef.v, ports: ports || [], type: 'message' }; for (const l of (listeners.message || [])) { try { l(ev); } catch (_) {} } if (sandbox.onmessage) { try { sandbox.onmessage(ev); } catch (_) {} } } });
      // ★ PARENT gère le handshake : l'anchor transfère SON port dans "recaptcha-setup" → on l'utilise
      if (data === 'recaptcha-setup') {
        if (ports && ports[0] && !sandbox.__setupPort) {
          const pport = ports[0];
          sandbox.__setupPort = pport;
          console.error('★★ PARENT récupère le port de l\'anchor (chan' + pport.__chan + ') et écoute');
          pport.addEventListener('message', (ev2) => {
            try {
              const d = ev2.data;
              sandbox.__anchorReqs.push(typeof d === 'string' ? d : JSON.stringify(d).slice(0, 120));
              if (Array.isArray(d) && d.length >= 3) { pport.postMessage([d[0], 'x', d[2]]); } // auto-réponse type "x"
            } catch (_) {}
          });
          pport.start && pport.start();
          // le parent initie sur le port (comme reCAPTCHA parent envoie sa config à l'anchor)
          timerQ.push({ ms: 2, fn: () => { try { console.error('★★ PARENT poste recaptcha-setup sur le port'); pport.postMessage('recaptcha-setup'); } catch (_) {} } });
        }
        if (!sandbox.__setupResponded) {
          sandbox.__setupResponded = true;
          timerQ.push({ ms: 0, fn: () => {
            // le parent de l'anchor = la page TM → origin auth.ticketmaster.com
            const ev = { data: 'recaptcha-setup', origin: 'https://auth.ticketmaster.com', source: ctxProxyRef.v, ports: [], type: 'message' };
            console.error('★★ PARENT signale prêt (origin auth.ticketmaster)');
            for (const l of (listeners.message || [])) { try { l(ev); } catch (_) {} }
            if (sandbox.onmessage) { try { sandbox.onmessage(ev); } catch (_) {} }
          } });
        }
      }
    };
    if (p === 'onmessage') return null;
    if (p === 'atob') return globalThis.atob; if (p === 'btoa') return globalThis.btoa;
    if (p === 'Blob') return function (parts, opts) {
      let s = ''; try { for (const x of (parts || [])) s += (typeof x === 'string' ? x : (x && x.toString ? '' : '')); } catch (_) {}
      const id = sandbox.__blobs.push({ src: s, type: (opts && opts.type) || '' }) - 1;
      return { __blobId: id, size: s.length, type: (opts && opts.type) || '' };
    };
    if (p === 'URL') return new Proxy(globalThis.URL, { get(t, k) { if (k === 'createObjectURL') return (b) => 'blob:vmhost/' + (b && b.__blobId); if (k === 'revokeObjectURL') return () => {}; return t[k]; }, construct(t, a) { return new t(...a); } });
    if (p === 'Worker') return function (url) {
      console.error('★★ new Worker(' + String(url).slice(0, 60) + ') → exécute le script en mode worker');
      const w = makeWorker(scriptSrc, autoStub, timerQ);
      sandbox.__workers.push(w);
      return w;
    };
    // built-ins standard
    if (typeof p === 'string' && typeof globalThis[p] !== 'undefined' &&
        (/^[A-Z]/.test(p) || ['parseInt','parseFloat','isNaN','isFinite','encodeURIComponent','decodeURIComponent','encodeURI','decodeURI'].includes(p)))
      return globalThis[p];
    if (p === 'global') return ctxProxyRef.v;
    if (typeof p === 'symbol') return undefined;
    if (typeof p === 'string') missing.add(p);
    return autoStub(String(p));
  },
  has() { return true; },
  set(t, p, v) {
    if (p === 'onmessage' && typeof v === 'function' && !sandbox.__parentInited) {
      sandbox.__parentInited = true;
      console.error('window.onmessage set → PARENT initie');
      timerQ.push({ ms: 5, fn: () => {
        const ev = { data: 'recaptcha-setup', origin: 'https://auth.ticketmaster.com', source: ctxProxyRef.v, ports: [], type: 'message' };
        console.error('★★ PARENT TM initie (recaptcha-setup ports=0)');
        for (const l of (listeners.message || [])) { try { l(ev); } catch (_) {} }
        try { v(ev); } catch (_) {}
      } });
    }
    if (p === 'botguard' && v && (typeof v === 'object' || typeof v === 'function') && !v.__wrapped) {
      try {
        const origBg = v.bg;
        console.error('★ SET window.botguard : bg type=' + typeof origBg + (typeof origBg === 'function' ? ' (source ' + String(origBg).slice(0, 50).replace(/\n/g, ' ') + '…)' : ''));
        if (typeof origBg === 'function') {
          v.__wrapped = true;
          v.bg = function (z, cb) {
            sandbox.__bgCalls.push({ zType: typeof z, zLen: (z && z.length) || 0, zPrev: typeof z === 'string' ? z.slice(0, 80) : JSON.stringify(z).slice(0, 80) });
            console.error('★ botguard.bg(z) APPELÉ : z type=' + typeof z + ' len=' + ((z && z.length) || 0));
            try { const inst = new origBg(z, cb); sandbox.__bgInst = inst; return inst; } catch (e) { console.error('  origBg THROW:', String(e.message).slice(0, 80)); throw e; }
          };
        }
      } catch (_) {}
    }
    t[p] = v; return true;
  },
}));
const ctxProxyRef = { v: ctx };
const docShim = shimProxy(documentReal, 'document');
const navShim = shimProxy(navigatorReal, 'navigator');
const perfShim = shimProxy(perfReal, 'performance');
// frame-window de l'iframe (là où botguard.bg tourne) : loopback vers le contexte principal
frameWindow = shimProxy({
  document: docShim, JSON: JSON, Math: Math, Object: Object, Array: Array, String: String, Number: Number,
  navigator: navShim, location: documentReal.location, performance: perfShim, name: '',
  postMessage: (data, origin) => { timerQ.push({ ms: 0, fn: () => { const ev = { data, origin: origin || 'https://auth.ticketmaster.com', source: ctxProxyRef.v, type: 'message', ports: [] }; for (const l of (listeners.message || [])) { try { l(ev); } catch (_) {} } } }); },
  addEventListener: (type, fn) => { if (typeof fn === 'function') (listeners[type] = listeners[type] || []).push(fn); },
  removeEventListener: () => {}, atob: globalThis.atob, btoa: globalThis.btoa, setTimeout: () => timerId++, clearTimeout: () => {},
  eval: (s) => { try { return vm.runInContext(String(s), ctx, { timeout: 5000 }); } catch (_) { return undefined; } },
}, 'frameWindow');
try { frameWindow.parent = ctxProxyRef.v; frameWindow.top = ctxProxyRef.v; frameWindow.self = frameWindow; } catch (_) {}
// cfg : méthodes inconnues → autoStub callable (le script appelle des méthodes dynamiques dessus)
sandbox.___grecaptcha_cfg = shimProxy({}, '___grecaptcha_cfg');

console.error('--- run recaptcha__fr.js in node:vm ---');
try { vm.runInContext(scriptSrc, ctx, { filename: 'recaptcha__fr.js', timeout: 20000 }); console.error('loaded OK (no fatal throw)'); }
catch (e) { console.error('THROW:', String(e.message).slice(0, 160)); console.error('recent window[] gets:', recent.join(' ')); }

const Main = sandbox.recaptcha?.anchor?.Main;
console.error('Main.init:', typeof Main?.init, 'arity', typeof Main?.init === 'function' ? Main.init.length : '-');
console.error('missing (top20):', [...missing].filter(m => !/Array|Reflect|BigInt|CLOSURE/.test(m)).slice(0, 20).join(' '));

// ── APPEL Main.init avec l'arg genuine + capture du token 05AL/0aAL produit
function decodeMainArg() {
  let raw = fs.readFileSync('C:\\Users\\Valentin\\AppData\\Local\\Temp\\claude\\C--Users-Valentin-Desktop-recaptcha-high-score\\56d2f254-3735-4ce5-a15e-d9d6e34e728f\\scratchpad\\browser\\mainfull_raw.txt', 'utf8').trim();
  raw = raw.replace(/^recaptcha\.anchor\.Main\.init\(/, '').replace(/^Main\.init\(/, '').replace(/\);?\s*$/, '');
  return (0, eval)(raw); // littéral JS string → la vraie string JSON
}
let mainArg;
try { mainArg = decodeMainArg(); console.error('mainArg len=' + mainArg.length); }
catch (e) { console.error('decodeMainArg KO:', e.message.slice(0, 80)); }

const captured = [];
function scanTokens() {
  const seen = new Set(); const out = [];
  (function scan(o, depth) {
    if (o == null || depth > 7 || seen.has(o)) return;
    const t = typeof o;
    if (t === 'object') { seen.add(o); for (const k in o) { try { scan(o[k], depth + 1); } catch (_) {} } }
    else if (t === 'string' && o.length > 40 && /^0[0-9a-zA-Z]A/.test(o)) out.push(o.slice(0, 50) + '…(' + o.length + ')');
  })(sandbox, 0);
  return out;
}
(async () => {
  if (!(mainArg && typeof Main?.init === 'function')) { console.error('Main.init non appelable'); return; }
  try {
    const ret = Main.init(mainArg);
    console.error('Main.init() returned:', typeof ret, ret && ret.then ? '(promise)' : '');
    if (ret && ret.then) { try { await ret; } catch (_) {} }
  } catch (e) { console.error('Main.init THROW:', String(e.message).slice(0, 140)); }
  // drainer les timers + laisser les microtâches se résoudre, plusieurs tours
  let routed = true; // OBSERVATION : pas de routage manuel, on regarde la topologie naturelle
  for (let round = 0; round < 60; round++) {
    // ROUTE via b.v = le VRAI port d'envoi de l'anchor (chan4 4p1 → worker 4p2) → l'anchor résout tout seul
    if (!routed && bgReqs.length && INSPECT_SEND_PORT) {
      routed = true;
      console.error('★★ ROUTE ' + bgReqs.length + ' requêtes C/z via b.v (le vrai port anchor→worker)…');
      for (const r of bgReqs) { try { const pl = process.env.PLF === 'str' ? JSON.stringify(r.z) : process.env.PLF === 'v' ? (r.z && r.z.v) : r.z; INSPECT_SEND_PORT.postMessage([pl, r.B, r.C]); } catch (e) { console.error('route err:', e.message); } }
    }
    // ne PAS déclencher les watchdogs (ms>30000) ; exécuter le reste par ordre de délai croissant
    const ready = timerQ.filter((t) => (t.ms || 0) <= 30000).sort((a, b) => (a.ms || 0) - (b.ms || 0));
    for (const t of ready) { const i = timerQ.indexOf(t); if (i >= 0) timerQ.splice(i, 1); }
    let n = 0; for (const t of ready) { if (n++ > 5000) break; try { (t.fn || t)(); } catch (_) {} }
    await new Promise((r) => setImmediate(r));
    captured.push(...scanTokens());
    if (captured.length) break;
    if (!ready.length && !timerQ.some((t) => (t.ms || 0) <= 30000)) { await new Promise((r) => setImmediate(r)); }
  }
  const uniq = [...new Set(captured)];
  console.error('timers drainés, tokens 0*A*:', uniq.length ? '\n  ' + uniq.join('\n  ') : 'aucun');
  console.error('cfg keys après run:', Object.keys(sandbox.___grecaptcha_cfg || {}).join(','));
  console.error('listeners enregistrés:', Object.keys(listeners).map((k) => k + '×' + listeners[k].length).join(' '));
  console.error('missing PENDANT run (nouveaux):', [...missing].filter((m) => !/Array|Reflect|BigInt|CLOSURE|AsyncContext|___grecaptcha_cfg\.(gor|es|enterprise|fns)/.test(m)).slice(0, 40).join(' '));
  console.error('botguard.bg appels (main):', sandbox.__bgCalls.length);
  console.error('anchorReqs reçus sur port parent:', sandbox.__anchorReqs.length, JSON.stringify(sandbox.__anchorReqs).slice(0, 180));
  console.error('workers créés:', sandbox.__workers.length);
  for (const w of sandbox.__workers) { try { console.error('  worker bg.bg appels:', (w.__wsandbox.__bgCalls || []).length, JSON.stringify(w.__wsandbox.__bgCalls).slice(0, 200)); } catch (_) {} }
  if (sandbox.__bgInst) { try { console.error('bgInst keys:', Object.keys(sandbox.__bgInst).join(','), '| type:', typeof sandbox.__bgInst); } catch (_) {} }
  console.error('blobs créés:', sandbox.__blobs.length, sandbox.__blobs.map((b) => b.src.length + 'o/' + b.type).join(' '));
  if (sandbox.__workerSrc) {
    console.error('★ WORKER SOURCE capturée: ' + sandbox.__workerSrc.length + ' chars');
    fs.writeFileSync('C:\\Users\\Valentin\\AppData\\Local\\Temp\\claude\\C--Users-Valentin-Desktop-recaptcha-high-score\\56d2f254-3735-4ce5-a15e-d9d6e34e728f\\scratchpad\\browser\\worker_src.js', sandbox.__workerSrc);
    console.error('  head:', JSON.stringify(sandbox.__workerSrc.slice(0, 120)));
  } else console.error('pas de worker source capturée');
})();
