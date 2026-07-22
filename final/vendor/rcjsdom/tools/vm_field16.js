'use strict';
/**
 * vm_field16.js — Harness node:vm (SANS jsdom) qui exécute le VRAI recaptcha__fr.js pour produire
 * un field16 genuine. Fetch anchor HTTP -> Main.init(initString) -> handshake postMessage ->
 * intercepte le POST /reload -> extrait field16.
 *
 * PoC/itératif : on démarre, on logue ce qui bloque, on shime au fur et à mesure.
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const https = require('https');

const SD = path.join(__dirname, '..', 'scripts');
const SITEKEY = process.env.RC_SITEKEY || '6LdKlZEpAAAAAAOQjzC2v_d36tWxCl6dWsozdSy9';
const ORIGIN = process.env.RC_ORIGIN || 'https://recaptcha-demo.appspot.com';
const REFERER = process.env.RC_PAGE_URL || (ORIGIN + '/');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';

function httpGet(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode, body: d })); }).on('error', reject);
  });
}

// ---- shims DOM/BOM minimaux mais fonctionnels ----
function makeEl(tag) {
  const el = { tagName: String(tag).toUpperCase(), style: {}, children: [], attributes: {},
    setAttribute(k, v) { this.attributes[k] = v; }, getAttribute(k) { return this.attributes[k]; },
    appendChild(c) { this.children.push(c); return c; }, removeChild() {}, addEventListener() {}, removeEventListener() {},
    getContext() { return null; }, contentWindow: null, contentDocument: null };
  if (String(tag).toLowerCase() === 'iframe') { el.contentWindow = { postMessage() {} }; }
  return el;
}

async function main() {
  // 1) fetch anchor
  const base = { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' };
  const apiJs = await httpGet(`https://www.google.com/recaptcha/api.js?render=${SITEKEY}`, base);
  const ver = (apiJs.body.match(/releases\/([A-Za-z0-9_-]+)\//) || [])[1];
  const anchorUrl = `https://www.google.com/recaptcha/api2/anchor?ar=1&k=${SITEKEY}&co=${Buffer.from(ORIGIN + ':443').toString('base64').replace(/=+$/, '')}&hl=en&v=${ver}&size=invisible&cb=${Math.random().toString(36).slice(2)}`;
  const anchor = await httpGet(anchorUrl, { ...base, Referer: REFERER });
  const initM = anchor.body.match(/Main\.init\("((?:[^"\\]|\\.)*)"\)/);
  if (!initM) { console.error('Main.init introuvable dans anchor'); process.exit(2); }
  const initStr = initM[1].replace(/\\x([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  console.error('version:', ver, '| initStr len:', initStr.length);

  // 2) contexte vm
  const captures = { reload: null };
  const listeners = {}; // event listeners window
  const missing = new Set();
  const ARR_EMPTY = { map: () => [], forEach: () => {}, filter: () => [], slice: () => [], join: () => '', indexOf: () => -1, push: () => 0, concat: () => [], reduce: (f, i) => i, some: () => false, every: () => true, find: () => undefined, includes: () => false, sort: () => [], reverse: () => [], splice: () => [], shift: () => undefined, pop: () => undefined, keys: () => [][Symbol.iterator](), length: 0 };
  const autoStub = (name) => new Proxy(function () {}, {
    get(t, p) {
      if (p === Symbol.toPrimitive) return () => ''; if (p === Symbol.iterator) return function* () {};
      if (p === 'length') return 0;
      if (typeof p === 'string' && p in ARR_EMPTY) return typeof ARR_EMPTY[p] === 'function' ? ARR_EMPTY[p] : ARR_EMPTY[p];
      if (typeof p === 'string' && !(p in t)) missing.add(name + '.' + p);
      return autoStub(name + '.' + String(p));
    },
    apply() { return autoStub(name + '()'); }, construct() { return autoStub('new ' + name); }, has() { return true; }, set() { return true; },
  });

  class XHRShim {
    constructor() { this.headers = {}; }
    open(m, u) { this.method = m; this.url = u; }
    setRequestHeader(k, v) { this.headers[k] = v; }
    send(body) {
      if (/\/reload\?/.test(this.url)) { captures.reload = Buffer.isBuffer(body) ? body : Buffer.from(body || '', 'binary'); console.error('>> /reload capturé:', captures.reload.length, 'octets'); }
      this.status = 200; this.readyState = 4; this.responseText = ")]}'\n[]";
      if (typeof this.onreadystatechange === 'function') try { this.onreadystatechange(); } catch (_) {}
      if (typeof this.onload === 'function') try { this.onload(); } catch (_) {}
    }
    addEventListener(ev, fn) { this['on' + ev] = fn; }
    getResponseHeader() { return null; }
  }

  class MessageChannelShim { constructor() { const a = new MessagePortShim(); const b = new MessagePortShim(); a._peer = b; b._peer = a; this.port1 = a; this.port2 = b; } }
  class MessagePortShim {
    postMessage(data) { const peer = this._peer; if (peer && typeof peer.onmessage === 'function') setTimeout(() => { try { peer.onmessage({ data, ports: [], source: null }); } catch (_) {} }, 0); }
    start() {} close() {} addEventListener(ev, fn) { if (ev === 'message') this.onmessage = fn; }
  }

  const documentShim = {
    createElement: makeEl, createElementNS: () => makeEl('div'), createTextNode: () => ({}),
    getElementsByTagName: () => [makeEl('div')], getElementById: () => makeEl('div'), querySelector: () => makeEl('div'), querySelectorAll: () => [makeEl('div')],
    addEventListener() {}, removeEventListener() {}, cookie: '', title: 'recaptcha', referrer: REFERER, readyState: 'complete',
    documentElement: makeEl('html'), head: makeEl('head'), body: makeEl('body'), location: null, dispatchEvent() {},
  };
  const locationObj = { href: REFERER, protocol: 'https:', host: new URL(ORIGIN).host, hostname: new URL(ORIGIN).host, origin: ORIGIN, search: '', hash: '', pathname: '/' };
  documentShim.location = locationObj;
  const navigatorShim = { userAgent: UA, platform: 'Win32', language: 'en-US', languages: ['en-US', 'en'], hardwareConcurrency: 8, deviceMemory: 8, webdriver: false, plugins: { length: 0 }, mimeTypes: { length: 0 }, sendBeacon: () => true, cookieEnabled: true, maxTouchPoints: 0, doNotTrack: null };

  const sandbox = {
    recaptcha: { anchor: {}, frame: { embeddable: {}, mobile: {} } },
    ___grecaptcha_cfg: { fns: [], gor: {}, es: {}, enterprise: {} },
    __recaptcha_api: 'https://www.google.com/recaptcha/api2/',
    __google_recaptcha_client: true,
    trustedTypes: { createPolicy: (n, r) => r || {} },
    XMLHttpRequest: XHRShim, MessageChannel: MessageChannelShim, MessagePort: MessagePortShim,
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, Promise,
    console,
  };
  let ctx;
  const parentPosted = [];
  ctx = vm.createContext(new Proxy(sandbox, {
    get(t, p) {
      if (p in t) return t[p];
      if (p === 'globalThis' || p === 'self' || p === 'window') return ctx;
      if (p === 'top' || p === 'parent') return { postMessage: (msg, origin, ports) => { parentPosted.push({ msg, origin, ports }); }, location: locationObj };
      if (p === 'document') return documentShim;
      if (p === 'navigator') return navigatorShim;
      if (p === 'location') return locationObj;
      if (p === 'performance') return { now: () => Date.now() % 1e7 + Math.random(), timeOrigin: Date.now(), getEntriesByType: () => [], getEntries: () => [], mark() {}, measure() {}, timing: {} };
      if (p === 'addEventListener') return (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); };
      if (p === 'removeEventListener') return () => {};
      if (p === 'postMessage') return (msg) => { setTimeout(() => (listeners.message || []).forEach((fn) => { try { fn({ data: msg, source: ctx, origin: ORIGIN, ports: [] }); } catch (_) {} }), 0); };
      if (p === 'dispatchEvent') return () => true;
      if (p === 'requestAnimationFrame') return (f) => setTimeout(() => f(Date.now()), 16);
      if (p === 'requestIdleCallback') return (f) => setTimeout(() => f({ timeRemaining: () => 5, didTimeout: false }), 1);
      if (p === 'cancelAnimationFrame' || p === 'cancelIdleCallback') return () => {};
      if (p === 'fetch') return () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(''), arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)), json: () => Promise.resolve({}) });
      if (p === 'MutationObserver') return class { observe() {} disconnect() {} takeRecords() { return []; } };
      if (p === 'Image') return class { constructor() { setTimeout(() => this.onload && this.onload(), 0); } };
      if (p === 'btoa') return (s) => Buffer.from(s, 'binary').toString('base64');
      if (p === 'atob') return (s) => Buffer.from(s, 'base64').toString('binary');
      if (p === 'global') return ctx;
      if (typeof globalThis[p] !== 'undefined') return globalThis[p];
      if (typeof p === 'string') missing.add(p);
      return autoStub(String(p));
    },
    has() { return true; }, set(t, p, v) { t[p] = v; return true; },
  }));

  // 3) charger le vrai script (version courante si dispo, sinon cache)
  let scriptSrc;
  const verFile = path.join(SD, 'recaptcha__' + (process.env.RC_HL || 'en') + '.js');
  try { scriptSrc = fs.readFileSync(verFile, 'utf8'); } catch (_) { scriptSrc = fs.readFileSync(path.join(SD, 'recaptcha_pretty.js'), 'utf8'); }
  console.error('script chargé:', scriptSrc.length, 'octets');
  try { vm.runInContext(scriptSrc, ctx, { filename: 'recaptcha.js', timeout: 20000 }); }
  catch (e) { console.error('LOAD THROW:', e.message.slice(0, 150)); }

  const MainInit = sandbox.recaptcha && sandbox.recaptcha.anchor && sandbox.recaptcha.anchor.Main && sandbox.recaptcha.anchor.Main.init;
  console.error('Main.init:', typeof MainInit);
  if (typeof MainInit !== 'function') { console.error('Main.init non défini -> stop'); process.exit(3); }

  // 4) appeler Main.init(initStr)
  try { MainInit(initStr); console.error('Main.init appelé OK'); }
  catch (e) { console.error('Main.init THROW:', e.message.slice(0, 200), '\nSTACK:', (e.stack || '').split('\n').slice(1, 5).join('\n')); }

  // 5) laisser tourner l'event loop pour la collecte + /reload
  await new Promise((r) => setTimeout(r, 8000));
  console.error('\n--- résultat ---');
  console.error('parent postMessages:', parentPosted.length);
  console.error('/reload capturé:', captures.reload ? captures.reload.length + ' octets' : 'NON');
  console.error('globals manquants (top 20):', [...missing].filter((m) => !/CLOSURE_FLAGS|Array|Reflect|BigInt/.test(m)).slice(0, 20).join(', '));
  if (captures.reload) fs.writeFileSync(path.join(SD, 'vm_reload.bin'), captures.reload);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
