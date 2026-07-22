/**
 * tools/shims.js — Installe des shims "navigateur Chrome" sur une window jsdom.
 *
 * ⚠️ RECHERCHE / ÉDUCATIF.
 *
 * jsdom fournit DOM + une partie de window, mais il MANQUE beaucoup d'API que les
 * collecteurs de fingerprint reCAPTCHA lisent (cf. recaptcha/README.md §Signals & §VM Signals) :
 *   WebGL, Worker, navigator.userAgentData, performance.memory/timing/navigation,
 *   userActivation, getBattery, storage.estimate, crypto.subtle, screen, etc.
 *
 * On les remplit avec des valeurs cohérentes Chrome 150 / Windows. Toute API absente
 * finit en "signal échoué" côté reCAPTCHA (remplacé par un base64 random) — mais trop
 * d'échecs = score dégradé, donc on couvre le maximum.
 */
'use strict';
const vm = require('vm');
const { webcrypto } = require('crypto');
const { TextEncoder, TextDecoder } = require('util');

// performance minimal pour le contexte worker (pas d'accès au perf jsdom du window)
function workerPerformance(window) {
  const origin = (window.performance && window.performance.timeOrigin) || Date.now();
  const start = process.hrtime.bigint();
  return {
    timeOrigin: origin,
    now: () => Number(process.hrtime.bigint() - start) / 1e6,
    getEntries: () => [], getEntriesByType: () => [], getEntriesByName: () => [],
    mark() {}, measure() {}, clearMarks() {}, clearMeasures() {},
  };
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';

// Trace du fingerprint : RC_FP_TRACE=1 → logue ce que reCAPTCHA lit (canvas/WebGL/navigator).
const FP_TRACE = process.env.RC_FP_TRACE === '1';
const _fpSeen = new Set();
function fptrace(msg) {
  if (!FP_TRACE) return;
  if (_fpSeen.has(msg)) return; _fpSeen.add(msg);
  try { process.stderr.write(`  [fp] ${msg}\n`); } catch (_) {}
}

function preview(data) {
  try {
    if (data == null) return String(data);
    if (typeof data === 'string') return JSON.stringify(data.slice(0, 60));
    if (Array.isArray(data)) return `[len ${data.length}] ${JSON.stringify(data).slice(0, 60)}`;
    if (ArrayBuffer.isView(data)) return `<${data.constructor.name} ${data.byteLength}B>`;
    if (data instanceof ArrayBuffer) return `<ArrayBuffer ${data.byteLength}B>`;
    return JSON.stringify(data).slice(0, 70);
  } catch (_) { return typeof data; }
}

// --- Anti-détection : faire passer les fonctions shimmées pour natives ------------
// botguard teste Function.prototype.toString(fn) → doit dire "{ [native code] }".
const NATIVE_NAMES = new WeakMap();
function native(fn, name) { try { NATIVE_NAMES.set(fn, name || (fn && fn.name) || ''); } catch (_) {} return fn; }
function patchRealmToString(FP) {
  if (!FP || FP.__rcSpoofed) return;
  const orig = FP.toString;
  const proxy = new Proxy(orig, {
    apply(target, thisArg, args) {
      if (typeof thisArg === 'function' && NATIVE_NAMES.has(thisArg))
        return `function ${NATIVE_NAMES.get(thisArg)}() { [native code] }`;
      return Reflect.apply(target, thisArg, args);
    },
  });
  native(proxy, 'toString');
  try { Object.defineProperty(FP, 'toString', { value: proxy, configurable: true, writable: true }); FP.__rcSpoofed = true; } catch (_) {}
}
function installToStringSpoof(window) {
  // Les fonctions shim vivent dans le realm Node ; reCAPTCHA peut appeler soit fn.toString()
  // (realm Node), soit window.Function.prototype.toString.call(fn) (realm page) → on patche LES DEUX.
  patchRealmToString(window.Function && window.Function.prototype);   // realm page (vm jsdom)
  patchRealmToString(Function.prototype);                            // realm Node (où vivent les shims)
}

function def(obj, prop, value, opts = {}) {
  try {
    Object.defineProperty(obj, prop, {
      configurable: true, enumerable: true,
      ...(opts.get ? { get: opts.get } : { value, writable: true }),
    });
  } catch (_) { /* certaines props jsdom sont non-redéfinissables : on ignore */ }
}

function installShims(window, cfg = {}) {
  const { origin = 'https://www.ticketmaster.com' } = cfg;
  const nav = window.navigator;
  const perfOrigin = Date.now() - 1500; // le "chargement de page" a commencé ~1.5s avant

  installToStringSpoof(window);   // AVANT tout : les fonctions shimmées paraîtront natives

  /* ---- globals manquants dans jsdom (TextEncoder/Decoder, etc.) -------- */
  if (typeof window.TextEncoder === 'undefined') def(window, 'TextEncoder', TextEncoder);
  if (typeof window.TextDecoder === 'undefined') def(window, 'TextDecoder', TextDecoder);
  if (typeof window.queueMicrotask === 'undefined') def(window, 'queueMicrotask', (fn) => Promise.resolve().then(fn));
  if (typeof window.structuredClone === 'undefined' && typeof structuredClone === 'function') def(window, 'structuredClone', (v) => structuredClone(v));
  if (typeof window.btoa === 'undefined') def(window, 'btoa', (s) => Buffer.from(s, 'binary').toString('base64'));
  if (typeof window.atob === 'undefined') def(window, 'atob', (s) => Buffer.from(s, 'base64').toString('binary'));
  // globals réseau/encoding absents de jsdom mais présents dans Node 18+ (undici)
  for (const g of ['Response', 'Request', 'Headers', 'FormData', 'ReadableStream', 'AbortController', 'AbortSignal']) {
    if (typeof window[g] === 'undefined' && typeof globalThis[g] !== 'undefined') def(window, g, globalThis[g]);
  }

  // PointerEvent : absent de jsdom. reCAPTCHA compte les pointer* (hash 5006=pointermove…)
  // et lit pressure/pointerType/coalesced → on shim par-dessus MouseEvent.
  if (typeof window.PointerEvent === 'undefined' && window.MouseEvent) {
    class PointerEvent extends window.MouseEvent {
      constructor(type, p = {}) {
        super(type, p);
        this.pointerId = p.pointerId != null ? p.pointerId : 1;
        this.width = p.width != null ? p.width : 1;
        this.height = p.height != null ? p.height : 1;
        this.pressure = p.pressure != null ? p.pressure : (type === 'pointerdown' ? 0.5 : 0);
        this.tangentialPressure = 0; this.tiltX = 0; this.tiltY = 0; this.twist = 0;
        this.pointerType = p.pointerType || 'mouse';
        this.isPrimary = p.isPrimary != null ? p.isPrimary : true;
        this._coalesced = p._coalesced || [];
      }
      getCoalescedEvents() { return this._coalesced.length ? this._coalesced : [this]; }
      getPredictedEvents() { return []; }
    }
    def(window, 'PointerEvent', PointerEvent);
  }

  /* ---- navigator (dérivé de l'identité Chrome, cf. tools/xbv.js) -------- */
  const identity = cfg.identity || require('./xbv').browserIdentity();
  const UA = identity.userAgent;
  const uaCH = identity.secChUaPlatform.replace(/"/g, '');   // "Windows"
  def(nav, 'userAgent', UA, { get: () => UA });
  def(nav, 'appVersion', UA.replace('Mozilla/', ''), { get: () => UA.replace('Mozilla/', '') });
  def(nav, 'platform', identity.navPlatform, { get: () => identity.navPlatform });
  def(nav, 'vendor', 'Google Inc.', { get: () => 'Google Inc.' });
  def(nav, 'webdriver', false, { get: () => false });        // Key 545
  def(nav, 'maxTouchPoints', 0, { get: () => 0 });           // Key 370
  const _hw = Number(process.env.RC_HW_CONCURRENCY) || 8;
  const _mem = Number(process.env.RC_DEVICE_MEMORY) || 8;
  def(nav, 'hardwareConcurrency', _hw, { get: () => _hw });  // Key 1994 (profilable RC_HW_CONCURRENCY)
  def(nav, 'deviceMemory', _mem, { get: () => _mem });       // Key 1994 (profilable RC_DEVICE_MEMORY)
  // Locale profilable (doit être COHÉRENTE avec la géo de l'IP/proxy, sinon reCAPTCHA baisse le score).
  const _lang = process.env.RC_LOCALE || 'fr-FR';
  const _langs = (process.env.RC_LANGUAGES || 'fr-FR,fr,en-US,en').split(',').map((s) => s.trim()).filter(Boolean);
  def(nav, 'language', _lang, { get: () => _lang });
  def(nav, 'languages', _langs, { get: () => _langs });
  def(nav, 'doNotTrack', null, { get: () => null });
  def(nav, 'pdfViewerEnabled', true, { get: () => true });
  def(nav, 'productSub', '20030107', { get: () => '20030107' });
  def(nav, 'product', 'Gecko', { get: () => 'Gecko' });
  def(nav, 'appName', 'Netscape', { get: () => 'Netscape' });
  def(nav, 'appCodeName', 'Mozilla', { get: () => 'Mozilla' });
  def(nav, 'onLine', true, { get: () => true });
  def(nav, 'cookieEnabled', true, { get: () => true });

  // navigator.plugins / mimeTypes — vrai Chrome 150 : 5 plugins (2 moteurs PDF × alias) + 2 mimeTypes.
  // Absents/vides = signal bot. On reconstruit des PluginArray/MimeTypeArray plausibles.
  const pdfMimes = [
    { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
    { type: 'text/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
  ];
  const pluginDefs = [
    'PDF Viewer', 'Chrome PDF Viewer', 'Chromium PDF Viewer',
    'Microsoft Edge PDF Viewer', 'WebKit built-in PDF',
  ];
  const mimeArr = pdfMimes.map(m => ({ ...m, __proto__: {} }));
  const plugins = pluginDefs.map(name => {
    const p = { name, filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: pdfMimes.length };
    pdfMimes.forEach((m, i) => { p[i] = mimeArr[i]; });
    p.item = (i) => p[i] || null; p.namedItem = (n) => mimeArr.find(x => x.type === n) || null;
    return p;
  });
  plugins.item = (i) => plugins[i] || null;
  plugins.namedItem = (n) => plugins.find(p => p.name === n) || null;
  plugins.refresh = native(function refresh() {}, 'refresh');
  mimeArr.forEach(m => { m.enabledPlugin = plugins[0]; });
  mimeArr.item = (i) => mimeArr[i] || null;
  mimeArr.namedItem = (n) => mimeArr.find(x => x.type === n) || null;
  try { def(nav, 'plugins', plugins, { get: () => plugins }); } catch (_) {}
  try { def(nav, 'mimeTypes', mimeArr, { get: () => mimeArr }); } catch (_) {}

  // userAgentData (Idx 72) + getHighEntropyValues — cohérent avec l'UA/sec-ch-ua
  const brands = identity.brands;
  def(nav, 'userAgentData', {
    brands,
    mobile: false,
    platform: uaCH,
    getHighEntropyValues: (hints) => Promise.resolve({
      brands,
      mobile: false,
      platform: uaCH,
      platformVersion: uaCH === 'Windows' ? '15.0.0' : '',
      architecture: 'x86',
      bitness: '64',
      model: '',
      uaFullVersion: identity.version,
      fullVersionList: brands.map(b => ({ brand: b.brand, version: /Brand/.test(b.brand) ? b.version + '.0.0.0' : identity.version })),
      wow64: false,
    }),
    toJSON() { return { brands, mobile: false, platform: uaCH }; },
  });

  // userActivation (Idx 52 / Idx 50) — page "activée" (simule un vrai user)
  def(nav, 'userActivation', { isActive: true, hasBeenActive: true });

  // storage.estimate (Key 1994) + getBattery (Key 614) + cookieDeprecationLabel (loader)
  def(nav, 'storage', {
    estimate: () => Promise.resolve({ quota: 53324367238, usage: 12345678 }),
  });
  def(nav, 'getBattery', () => Promise.resolve({
    level: 1, charging: true, chargingTime: 0, dischargingTime: Infinity,
    addEventListener() {}, removeEventListener() {},
  }));
  def(nav, 'cookieDeprecationLabel', { getValue: () => Promise.resolve('') });
  def(nav, 'sendBeacon', () => true);
  if (!nav.permissions) def(nav, 'permissions', { query: () => Promise.resolve({ state: 'granted', addEventListener() {} }) });

  // AJOUTS SESSION-2 (RC_FP_EXTRA=1 pour activer) — gatés OFF par défaut : ce sont des stubs plain-object
  // (mediaDevices/Notification/gpu…) qui peuvent ÉCHOUER des checks instanceof/natif → incohérence = PIRE
  // qu'une API absente. Baseline 0.3 = SANS ces ajouts. À réactiver seulement avec un canal de mesure propre.
  if (process.env.RC_FP_EXTRA === '1') {
  // navigator.connection (NetworkInformation) — vrai Chrome l'expose ; absent = signal bot
  if (!nav.connection) def(nav, 'connection', { effectiveType: '4g', rtt: 50, downlink: 10, saveData: false, type: 'wifi', onchange: null, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } });

  // navigator.mediaDevices — un vrai Chrome liste ≥1 audioinput/videoinput/audiooutput (labels vides sans permission)
  if (!nav.mediaDevices) {
    const devices = [
      { kind: 'audioinput', label: '', deviceId: 'default', groupId: 'g-audio-in', toJSON() { return { kind: this.kind, label: this.label, deviceId: this.deviceId, groupId: this.groupId }; } },
      { kind: 'videoinput', label: '', deviceId: 'cam-0', groupId: 'g-video', toJSON() { return { kind: this.kind, label: this.label, deviceId: this.deviceId, groupId: this.groupId }; } },
      { kind: 'audiooutput', label: '', deviceId: 'default', groupId: 'g-audio-out', toJSON() { return { kind: this.kind, label: this.label, deviceId: this.deviceId, groupId: this.groupId }; } },
    ];
    def(nav, 'mediaDevices', {
      enumerateDevices: native(() => Promise.resolve(devices), 'enumerateDevices'),
      getUserMedia: native(() => Promise.reject(new (window.DOMException || Error)('Permission denied', 'NotAllowedError')), 'getUserMedia'),
      getSupportedConstraints: native(() => ({ width: true, height: true, aspectRatio: true, frameRate: true, facingMode: true, deviceId: true, groupId: true }), 'getSupportedConstraints'),
      addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; }, ondevicechange: null,
    });
  }

  // window.Notification — headless a souvent permission 'denied'/absent ; vrai Chrome = 'default'
  if (typeof window.Notification === 'undefined') {
    const Notification = native(function Notification() {}, 'Notification');
    Notification.permission = 'default';
    Notification.maxActions = 2;
    Notification.requestPermission = native(function requestPermission(cb) { const p = Promise.resolve('default'); if (typeof cb === 'function') p.then(cb); return p; }, 'requestPermission');
    def(window, 'Notification', Notification, { get: () => Notification });
  }

  // speechSynthesis.getVoices() — vrai Chrome/Windows renvoie des voix ; absent = signal
  if (!window.speechSynthesis) {
    const voices = [
      { voiceURI: 'Microsoft David - English (United States)', name: 'Microsoft David - English (United States)', lang: 'en-US', localService: true, default: true },
      { voiceURI: 'Microsoft Zira - English (United States)', name: 'Microsoft Zira - English (United States)', lang: 'en-US', localService: true, default: false },
      { voiceURI: 'Google français', name: 'Google français', lang: 'fr-FR', localService: false, default: false },
      { voiceURI: 'Google US English', name: 'Google US English', lang: 'en-US', localService: false, default: false },
    ];
    def(window, 'speechSynthesis', {
      getVoices: native(() => voices, 'getVoices'),
      speak() {}, cancel() {}, pause() {}, resume() {},
      pending: false, speaking: false, paused: false,
      onvoiceschanged: null, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    });
  }

  // navigator.gpu (WebGPU) — présent dans Chrome 150 ; requestAdapter renvoie un adapter plausible
  if (!nav.gpu) def(nav, 'gpu', {
    requestAdapter: native(() => Promise.resolve({
      features: new Set(), limits: {}, isFallbackAdapter: false,
      requestAdapterInfo: () => Promise.resolve({ vendor: 'intel', architecture: '', device: '', description: '' }),
      requestDevice: () => Promise.resolve({ features: new Set(), limits: {}, queue: {} }),
    }), 'requestAdapter'),
    getPreferredCanvasFormat: native(() => 'bgra8unorm', 'getPreferredCanvasFormat'),
    wgslLanguageFeatures: new Set(),
  });
  } // fin RC_FP_EXTRA

  /* ---- crypto.subtle (SHA-256, HMAC pour Idx 4/29/35/41/42) ------------ */
  try {
    if (!window.crypto || !window.crypto.subtle) {
      def(window, 'crypto', webcrypto, { get: () => webcrypto });
    }
  } catch (_) {}
  try { if (!nav.crypto) def(nav, 'crypto', window.crypto); } catch (_) {}

  /* ---- screen / window dims (Idx 67) ----------------------------------- */
  const _sw = Number(process.env.RC_SCREEN_W) || 1920, _sh = Number(process.env.RC_SCREEN_H) || 1080;
  const _savH = Number(process.env.RC_AVAIL_H) || (_sh - 48);
  def(window.screen, 'width', _sw, { get: () => _sw });        // Idx 67 (profilable RC_SCREEN_W/H)
  def(window.screen, 'height', _sh, { get: () => _sh });
  def(window.screen, 'availWidth', _sw, { get: () => _sw });
  def(window.screen, 'availHeight', _savH, { get: () => _savH });
  def(window.screen, 'colorDepth', 24, { get: () => 24 });
  def(window.screen, 'pixelDepth', 24, { get: () => 24 });
  def(window, 'innerWidth', 1280, { get: () => 1280 });
  def(window, 'innerHeight', 720, { get: () => 720 });
  def(window, 'outerWidth', 1920, { get: () => 1920 });
  def(window, 'outerHeight', 1032, { get: () => 1032 });
  def(window, 'devicePixelRatio', 1, { get: () => 1 });
  def(window, 'scrollY', 0, { get: () => 0 });
  def(window, 'scrollX', 0, { get: () => 0 });
  def(window, 'pageYOffset', 0, { get: () => 0 });
  def(window, 'opener', null, { get: () => null });   // Idx 56

  /* ---- performance (Idx 36-39, 64, 68, 71) ----------------------------- */
  const perf = window.performance;
  if (perf) {
    // Timing RÉALISTE + VARIÉ par run (le collecteur dominant : 455 accès mesurés). Un vrai Chrome a
    // une séquence DNS→TCP→TLS→TTFB→DOM→load cohérente et différente à chaque chargement ; nos valeurs
    // étaient FIGÉES (mêmes chiffres chaque run = signal bot évident). On génère une séquence plausible.
    const seed = Date.now();
    const rnd = (n) => (Math.sin(seed * 0.000733 + n * 1.7) * 0.5 + 0.5);   // 0..1 déterministe/run
    const dnsDur = 6 + Math.round(rnd(1) * 34);        // 6-40 ms
    const tcpDur = 8 + Math.round(rnd(2) * 42);        // 8-50
    const tlsDur = 18 + Math.round(rnd(3) * 60);       // 18-78
    const ttfb = 55 + Math.round(rnd(4) * 160);        // 55-215
    const respDur = 12 + Math.round(rnd(5) * 90);      // 12-102
    const domInteractiveT = 180 + Math.round(rnd(6) * 320);
    const domCompleteT = domInteractiveT + 260 + Math.round(rnd(7) * 500);
    const loadT = domCompleteT + 20 + Math.round(rnd(8) * 120);
    // jalons absolus (ms epoch) à partir de navigationStart = perfOrigin
    const T = {
      navigationStart: perfOrigin, fetchStart: perfOrigin + 2,
      domainLookupStart: perfOrigin + 3, domainLookupEnd: perfOrigin + 3 + dnsDur,
      connectStart: perfOrigin + 3 + dnsDur, secureConnectionStart: perfOrigin + 3 + dnsDur + tcpDur,
      connectEnd: perfOrigin + 3 + dnsDur + tcpDur + tlsDur,
      requestStart: perfOrigin + 4 + dnsDur + tcpDur + tlsDur,
      responseStart: perfOrigin + 4 + dnsDur + tcpDur + tlsDur + ttfb,
      responseEnd: perfOrigin + 4 + dnsDur + tcpDur + tlsDur + ttfb + respDur,
      domLoading: perfOrigin + 6 + dnsDur + tcpDur + tlsDur + ttfb + respDur,
      domInteractive: perfOrigin + domInteractiveT, domContentLoadedEventStart: perfOrigin + domInteractiveT + 8,
      domContentLoadedEventEnd: perfOrigin + domInteractiveT + 20, domComplete: perfOrigin + domCompleteT,
      loadEventStart: perfOrigin + loadT, loadEventEnd: perfOrigin + loadT + 4,
    };
    // performance.memory (Idx 71) — légèrement varié par run (un vrai Chrome n'a jamais 2× le même heap)
    def(perf, 'memory', {
      jsHeapSizeLimit: 2172649472,
      totalJSHeapSize: 40000000 + Math.round(rnd(9) * 30000000),
      usedJSHeapSize: 30000000 + Math.round(rnd(10) * 25000000),
    });
    if (!perf.timing) def(perf, 'timing', {
      navigationStart: T.navigationStart, unloadEventStart: 0, unloadEventEnd: 0,
      redirectStart: 0, redirectEnd: 0, fetchStart: T.fetchStart,
      domainLookupStart: T.domainLookupStart, domainLookupEnd: T.domainLookupEnd,
      connectStart: T.connectStart, secureConnectionStart: T.secureConnectionStart, connectEnd: T.connectEnd,
      requestStart: T.requestStart, responseStart: T.responseStart, responseEnd: T.responseEnd,
      domLoading: T.domLoading, domInteractive: T.domInteractive,
      domContentLoadedEventStart: T.domContentLoadedEventStart, domContentLoadedEventEnd: T.domContentLoadedEventEnd,
      domComplete: T.domComplete, loadEventStart: T.loadEventStart, loadEventEnd: T.loadEventEnd,
    });
    if (!perf.navigation) def(perf, 'navigation', { type: 0, redirectCount: 0 });
    // PerformanceNavigationTiming moderne — temps RELATIFS à startTime=0, cohérents avec timing ci-dessus
    const rel = (abs) => Math.max(0, +(abs - perfOrigin).toFixed(1));
    const navEntry = {
      entryType: 'navigation', name: origin + '/', nextHopProtocol: 'h2', initiatorType: 'navigation',
      startTime: 0, redirectStart: 0, redirectEnd: 0, workerStart: 0,
      fetchStart: rel(T.fetchStart), domainLookupStart: rel(T.domainLookupStart), domainLookupEnd: rel(T.domainLookupEnd),
      connectStart: rel(T.connectStart), secureConnectionStart: rel(T.secureConnectionStart), connectEnd: rel(T.connectEnd),
      requestStart: rel(T.requestStart), responseStart: rel(T.responseStart), responseEnd: rel(T.responseEnd),
      domInteractive: rel(T.domInteractive), domContentLoadedEventStart: rel(T.domContentLoadedEventStart),
      domContentLoadedEventEnd: rel(T.domContentLoadedEventEnd), domComplete: rel(T.domComplete),
      loadEventStart: rel(T.loadEventStart), loadEventEnd: rel(T.loadEventEnd), duration: rel(T.loadEventEnd),
      transferSize: 12000 + Math.round(rnd(11) * 40000), encodedBodySize: 11000 + Math.round(rnd(12) * 38000),
      decodedBodySize: 40000 + Math.round(rnd(13) * 120000), responseStatus: 200, type: 'navigate', redirectCount: 0,
    };
    const origGetByType = perf.getEntriesByType && perf.getEntriesByType.bind(perf);
    // resource-timing : un vrai navigateur a UNE entrée par ressource chargée (scripts/css/img).
    // jsdom n'en produit aucune → signal bot (perf entries vides). On les génère depuis le DOM réel
    // de la page, avec des timings plausibles échelonnés. reCAPTCHA lit getEntriesByType('resource').
    const buildResourceEntries = () => {
      const list = [];
      let t = 40;   // ms après navigationStart
      const push = (url, initiatorType) => {
        if (!url) return;
        let name = url; try { name = new window.URL(url, origin + '/').href; } catch (_) {}
        const dur = 8 + (name.length % 90);            // durée déterministe-ish
        const start = t; t += 12 + (name.length % 40);  // étalement dans le temps
        const enc = 1200 + (name.length * 7 % 90000);
        list.push({
          entryType: 'resource', name, initiatorType, nextHopProtocol: 'h2',
          startTime: start, duration: dur, fetchStart: start, responseEnd: start + dur,
          domainLookupStart: start, domainLookupEnd: start, connectStart: start, connectEnd: start + 1,
          secureConnectionStart: start, requestStart: start + 1, responseStart: start + dur * 0.6,
          transferSize: enc + 300, encodedBodySize: enc, decodedBodySize: enc * 3,
          workerStart: 0, redirectStart: 0, redirectEnd: 0, serverTiming: [], renderBlockingStatus: 'non-blocking',
        });
      };
      try {
        const doc = window.document;
        doc.querySelectorAll('script[src]').forEach(s => push(s.getAttribute('src'), 'script'));
        doc.querySelectorAll('link[href]').forEach(l => push(l.getAttribute('href'), 'link'));
        doc.querySelectorAll('img[src]').forEach(i => push(i.getAttribute('src'), 'img'));
      } catch (_) {}
      // ressources reCAPTCHA réellement chargées (observées par le harnais)
      for (const r of (window.__rcResourceEntries || [])) list.push(r);
      return list;
    };
    // DEFAULT ON : les resource-entries alimentent la liste des origines de scripts du champ 20 (prouvé :
    // sans elles = `null` là où le vrai body 0.7 a `["ajax.googleapis.com",…]`). RC_NO_RESTIMING=1 pour couper.
    const resourceEntries = () => process.env.RC_NO_RESTIMING === '1' ? (window.__rcResourceEntries || []) : buildResourceEntries();
    def(perf, 'getEntriesByType', (type) => {
      if (type === 'navigation') return [navEntry];
      if (type === 'resource') return resourceEntries();
      try { return origGetByType ? origGetByType(type) : []; } catch (_) { return []; }
    });
    def(perf, 'getEntries', () => [navEntry, ...resourceEntries()]);
    if (!perf.getEntriesByName) def(perf, 'getEntriesByName', () => []);
  }

  /* ---- MessageChannel / MessagePort (pont vers webworker.js) ----------- */
  installMessaging(window, { pageOrigin: origin });

  /* ---- WebGL (Key 1310 : vendor/renderer/extensions) ------------------- */
  installWebGL(window);

  /* ---- Worker (webworker.js) — jsdom n'a pas de vrai Worker ------------- */
  installWorkerShim(window, cfg);

  /* ---- divers ---------------------------------------------------------- */
  if (!window.getSelection) def(window, 'getSelection', () => ({ toString: () => '' })); // Idx 47
  if (!window.matchMedia) def(window, 'matchMedia', (q) => ({
    matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  }));
  if (!window.requestIdleCallback) def(window, 'requestIdleCallback', (cb) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 50 }), 1));
  if (!window.cancelIdleCallback) def(window, 'cancelIdleCallback', (id) => clearTimeout(id));
  // Graphe d'objets Chrome (champ 22 « all browser object keys » + Key 291 « proto hashes ») :
  // injecte les interfaces manquantes (SpeechSynthesisEvent, NetworkInformation, RTC*, Audio*, WebGL*…).
  try { const added = require('./browser_graph').installBrowserGraph(window, native); if (window.__rcDebug && window.__rcLogger) window.__rcLogger(`browser-graph: +${added} interfaces`); } catch (e) { /* best effort */ }

  // window.chrome (Key 1313) — vrai Chrome expose chrome.{app,runtime,loadTimes,csi}.
  // botguard vérifie leur présence ET que ce sont des fonctions natives.
  const chromeObj = {
    app: { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } },
    runtime: { OnInstalledReason: {}, OnRestartRequiredReason: {}, PlatformArch: {}, PlatformOs: {}, connect: native(function connect() {}, 'connect'), sendMessage: native(function sendMessage() {}, 'sendMessage') },
    loadTimes: native(function loadTimes() {
      return { requestTime: perfOrigin / 1000, startLoadTime: perfOrigin / 1000, commitLoadTime: perfOrigin / 1000 + 0.05,
        finishDocumentLoadTime: perfOrigin / 1000 + 0.6, finishLoadTime: perfOrigin / 1000 + 0.9, firstPaintTime: perfOrigin / 1000 + 0.4,
        navigationType: 'Other', wasFetchedViaSpdy: true, wasNpnNegotiated: true, npnNegotiatedProtocol: 'h2', wasAlternateProtocolAvailable: false, connectionInfo: 'h2' };
    }, 'loadTimes'),
    csi: native(function csi() { return { startE: Date.now(), onloadT: Date.now(), pageT: 900, tran: 15 }; }, 'csi'),
  };
  def(window, 'chrome', chromeObj, { get: () => chromeObj });

  // Sonde RC_PROBE_MISSING : navigator/screen/performance du thread principal (là où tournent la
  // plupart des collecteurs fingerprint) → logge les vraies API manquantes que le script lit.
  if (process.env.RC_PROBE_MISSING === '1') {
    try { const p = installMissProbe(nav, 'navigator'); def(window, 'navigator', p, { get: () => p }); } catch (_) {}
    try { def(window, 'screen', installMissProbe(window.screen, 'screen')); } catch (_) {}
    try { if (window.performance) def(window, 'performance', installMissProbe(window.performance, 'performance')); } catch (_) {}
  }

  // marque natives les fonctions les plus sondées (WebGL/canvas/Worker enregistrées dans leurs installeurs)
  [nav.getBattery, nav.sendBeacon, nav.permissions && nav.permissions.query,
   nav.storage && nav.storage.estimate, nav.userAgentData && nav.userAgentData.getHighEntropyValues,
   window.requestIdleCallback, window.matchMedia, window.getSelection]
    .forEach(fn => { if (typeof fn === 'function') native(fn); });

  return { UA, brands };
}

/* ---- MessageChannel / MessagePort (même process, deux ports "entangled") ---- */
function extractPorts(...args) {
  const ports = [];
  for (const a of args) {
    if (Array.isArray(a)) for (const x of a) if (x && typeof x.postMessage === 'function' && '_partner' in x) ports.push(x);
  }
  return ports;
}
function makePort(scheduler, dbg) {
  const port = {
    _partner: null, _started: false, _queue: [], _l: [], _onmessage: null,
    postMessage(data, transfer, transfer2) {
      const ports = extractPorts(transfer, transfer2);
      const target = port._partner;
      if (dbg) dbg(`port send ports=${ports.length} ${preview(data)}`);
      if (process.env.RC_PORTHOOK === '1' && global.__port) { try { global.__port(data); } catch (_) {} }
      if (!target) return;
      const deliver = () => {
        const ev = { data, ports, type: 'message', target, source: port, origin: '' };
        try { if (typeof target._onmessage === 'function') target._onmessage(ev); } catch (e) {}
        target._l.slice().forEach(fn => { try { fn(ev); } catch (e) {} });
      };
      if (target._started) scheduler(deliver); else target._queue.push(deliver);
    },
    start() { if (port._started) return; port._started = true; const q = port._queue.splice(0); q.forEach(fn => scheduler(fn)); },
    close() { port._partner = null; },
    addEventListener(t, fn) { if (t === 'message' && typeof fn === 'function') port._l.push(fn); },
    removeEventListener(t, fn) { const i = port._l.indexOf(fn); if (i >= 0) port._l.splice(i, 1); },
    dispatchEvent() { return true; },
  };
  Object.defineProperty(port, 'onmessage', {
    configurable: true,
    get() { return port._onmessage; },
    set(v) { port._onmessage = v; if (v) port.start(); },  // assigner onmessage démarre le port (spec)
  });
  return port;
}
function makeMessaging(scheduler, dbg) {
  class MessageChannel {
    constructor() {
      this.port1 = makePort(scheduler, dbg && ((m) => dbg('p1 ' + m)));
      this.port2 = makePort(scheduler, dbg && ((m) => dbg('p2 ' + m)));
      this.port1._partner = this.port2;
      this.port2._partner = this.port1;
    }
  }
  return { MessageChannel };
}
function installMessaging(window, opts = {}) {
  const pageOrigin = opts.pageOrigin || 'https://www.ticketmaster.com';
  const scheduler = (fn) => { try { window.setTimeout(fn, 0); } catch (_) { setTimeout(fn, 0); } };
  const dbg = window.__rcDebug ? (window.__rcLogger || (() => {})) : null;
  const { MessageChannel } = makeMessaging(scheduler, dbg);
  // Origine "attendue" des messages ENTRANTS de cette frame :
  //  - une frame google.com (anchor/bframe) reçoit de la page parente → pageOrigin
  //  - la page principale reçoit d'une frame reCAPTCHA google.com → https://www.google.com
  let selfHref = ''; try { selfHref = window.location.href; } catch (_) {}
  const isGoogleFrame = /(^|\/\/)([^/]*\.)?google\.com/.test(selfHref);
  const incomingOrigin = isGoogleFrame ? pageOrigin : 'https://www.google.com';
  // Fenêtre émettrice attendue des messages ENTRANTS (reCAPTCHA vérifie event.source) :
  //  - frame google (anchor/bframe) : l'émetteur est la page parente
  //  - page principale : l'émetteur est l'iframe reCAPTCHA
  const inferSource = () => {
    try {
      if (isGoogleFrame) return window.parent && window.parent !== window ? window.parent : window;
      const ifr = window.document && window.document.querySelector('iframe[src*="/recaptcha/"]');
      if (ifr) { try { return ifr.contentWindow || window; } catch (_) {} }
      return (window.frames && window.frames[0]) || window;
    } catch (_) { return window; }
  };
  if (typeof window.MessageChannel === 'undefined') def(window, 'MessageChannel', MessageChannel);
  // MessagePort exposé comme "type" (certains checks font instanceof/typeof) — best effort
  if (typeof window.MessagePort === 'undefined') def(window, 'MessagePort', function MessagePort() {});
  window.__rcMakePort = () => makePort(scheduler);
  window.__rcScheduler = scheduler;

  // window.postMessage : jsdom ne supporte que (msg, targetOrigin:string, transfer).
  // reCAPTCHA appelle la forme récente (msg, {targetOrigin, transfer}) et transfère des MessagePort.
  // On réécrit pour accepter les deux et livrer un MessageEvent portant .ports.
  try {
    window.postMessage = function (message, targetOrigin, transfer) {
      if (targetOrigin && typeof targetOrigin === 'object' && !Array.isArray(targetOrigin)) {
        transfer = targetOrigin.transfer; // forme options {targetOrigin, transfer}
      }
      const ports = extractPorts(transfer);
      if (window.__rcDebug && window.__rcLogger) window.__rcLogger(`postMessage ports=${ports.length} ${preview(message)}`);
      const source = inferSource();
      scheduler(() => {
        let ev;
        try { ev = new window.MessageEvent('message', { data: message, origin: incomingOrigin, source }); }
        catch (_) { ev = { type: 'message', data: message, origin: incomingOrigin, source }; }
        try { Object.defineProperty(ev, 'ports', { configurable: true, value: ports }); } catch (_) {}
        try { if (!ev.source) Object.defineProperty(ev, 'source', { configurable: true, value: source }); } catch (_) {}
        try { window.dispatchEvent(ev); } catch (e) {}
      });
    };
  } catch (_) {}
}

/* WebGL stub minimal : juste assez pour vendor/renderer/extensions */
function installWebGL(window) {
  const GL_CONSTANTS = {
    VENDOR: 0x1f00, RENDERER: 0x1f01, VERSION: 0x1f02, SHADING_LANGUAGE_VERSION: 0x8b8c,
    UNMASKED_VENDOR_WEBGL: 0x9245, UNMASKED_RENDERER_WEBGL: 0x9246,
    MAX_TEXTURE_SIZE: 0x0d33, MAX_VIEWPORT_DIMS: 0x0d3a, MAX_RENDERBUFFER_SIZE: 0x84e8,
  };
  function makeGL() {
    const exts = [
      'ANGLE_instanced_arrays', 'EXT_blend_minmax', 'EXT_color_buffer_half_float',
      'EXT_float_blend', 'EXT_texture_filter_anisotropic', 'OES_element_index_uint',
      'OES_standard_derivatives', 'OES_texture_float', 'OES_texture_float_linear',
      'OES_texture_half_float', 'OES_vertex_array_object', 'WEBGL_debug_renderer_info',
      'WEBGL_lose_context', 'WEBGL_depth_texture',
    ];
    return {
      ...GL_CONSTANTS,
      canvas: null,
      getParameter(p) {
        fptrace(`webgl.getParameter(0x${Number(p).toString(16)})`);
        switch (p) {
          case GL_CONSTANTS.UNMASKED_VENDOR_WEBGL: return process.env.RC_WEBGL_VENDOR || 'Google Inc. (Intel)';
          case GL_CONSTANTS.VENDOR: return 'WebKit';
          case GL_CONSTANTS.UNMASKED_RENDERER_WEBGL:
            return process.env.RC_WEBGL_RENDERER || 'ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E9B) Direct3D11 vs_5_0 ps_5_0, D3D11)';
          case GL_CONSTANTS.RENDERER: return 'WebKit WebGL';
          case GL_CONSTANTS.VERSION: return 'WebGL 1.0 (OpenGL ES 2.0 Chromium)';
          case GL_CONSTANTS.SHADING_LANGUAGE_VERSION: return 'WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)';
          case GL_CONSTANTS.MAX_TEXTURE_SIZE: return 16384;
          case GL_CONSTANTS.MAX_RENDERBUFFER_SIZE: return 16384;
          case GL_CONSTANTS.MAX_VIEWPORT_DIMS: return new Int32Array([32767, 32767]);
          default: return 0;
        }
      },
      getExtension(name) {
        fptrace(`webgl.getExtension(${name})`);
        if (name === 'WEBGL_debug_renderer_info') {
          return { UNMASKED_VENDOR_WEBGL: GL_CONSTANTS.UNMASKED_VENDOR_WEBGL, UNMASKED_RENDERER_WEBGL: GL_CONSTANTS.UNMASKED_RENDERER_WEBGL };
        }
        if (name === 'WEBGL_lose_context') return { loseContext() {}, restoreContext() {} };
        return exts.includes(name) ? {} : null;
      },
      getSupportedExtensions() { return exts.slice(); },
      getContextAttributes() { return { alpha: true, antialias: true, depth: true, stencil: false }; },
      // no-op API surface pour éviter les throws si le collecteur dessine
      createShader() { return {}; }, shaderSource() {}, compileShader() {},
      createProgram() { return {}; }, attachShader() {}, linkProgram() {}, useProgram() {},
      createBuffer() { return {}; }, bindBuffer() {}, bufferData() {},
      getAttribLocation() { return 0; }, getUniformLocation() { return {}; },
      enableVertexAttribArray() {}, vertexAttribPointer() {}, uniform2f() {},
      viewport() {}, clearColor() {}, clear() {}, drawArrays() { fptrace('webgl.drawArrays'); }, drawElements() { fptrace('webgl.drawElements'); },
      readPixels(x, y, w, h, fmt, type, dst) { fptrace(`webgl.readPixels(${w}x${h})`); }, getError() { return 0; }, finish() {}, flush() {},
      getShaderPrecisionFormat() { fptrace('webgl.getShaderPrecisionFormat'); return { rangeMin: 127, rangeMax: 127, precision: 23 }; },
      createTexture() { return {}; }, bindTexture() {}, texParameteri() {}, texImage2D() {}, activeTexture() {},
      createFramebuffer() { return {}; }, bindFramebuffer() {}, framebufferTexture2D() {}, checkFramebufferStatus() { return 0x8cd5; },
      pixelStorei() {}, generateMipmap() {}, depthFunc() {}, enable() {}, disable() {}, blendFunc() {}, scissor() {}, colorMask() {},
    };
  }
  const HTMLCanvasElement = window.HTMLCanvasElement;
  if (HTMLCanvasElement) {
    const orig = HTMLCanvasElement.prototype.getContext;
    native(HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      fptrace(`canvas.getContext(${type})`);
      if (type === 'webgl' || type === 'experimental-webgl' || type === 'webgl2') {
        const gl = makeGL(); gl.canvas = this; return gl;
      }
      if (type === '2d') {
        // jsdom renvoie null sans le pkg 'canvas' → fournir un 2d minimal
        try { const c = orig && orig.call(this, type, ...rest); if (c) return c; } catch (_) {}
        return make2D(this);
      }
      try { return orig ? orig.call(this, type, ...rest) : null; } catch (_) { return null; }
    }, 'getContext');
    // toDataURL (canvas fingerprint) — jsdom throw sans 'canvas'
    native(HTMLCanvasElement.prototype.toDataURL = function (type) {
      fptrace(`canvas.toDataURL(${type || 'image/png'}) [${this.width}x${this.height}]`);
      return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    }, 'toDataURL');
  }
  function make2D(canvas) {
    return {
      canvas, fillStyle: '#000', strokeStyle: '#000', font: '10px sans-serif',
      globalCompositeOperation: 'source-over', textBaseline: 'alphabetic',
      fillRect() {}, strokeRect() {}, clearRect() {}, beginPath() {}, closePath() {},
      moveTo() {}, lineTo() {}, arc() {}, rect() {}, fill() {}, stroke() {},
      fillText(t) { fptrace(`2d.fillText(${JSON.stringify(String(t).slice(0, 40))}) font=${this.font}`); },
      strokeText() {}, measureText: (t) => { fptrace(`2d.measureText(${JSON.stringify(String(t).slice(0, 30))})`); return { width: (t || '').length * 6 }; },
      getImageData: (x, y, w, h) => { fptrace(`2d.getImageData(${w}x${h})`); return { data: new Uint8ClampedArray(Math.max(1, w * h * 4)) }; },
      putImageData() {}, drawImage() {}, save() {}, restore() {}, translate() {}, scale() {},
      rotate() {}, setTransform() {}, createLinearGradient: () => ({ addColorStop() {} }),
      isPointInPath: () => false,
    };
  }
}

/**
 * Worker shim : exécute webworker.js (→ importScripts(recaptcha__fr.js)) dans un VRAI
 * contexte JS Node (module `vm`), avec un DedicatedWorkerGlobalScope shimmé SANS document/window
 * (pour que le script prenne sa branche worker). Même process, un seul thread : le pont
 * postMessage/MessagePort relie ce contexte au frame principal.
 *
 * window.__rcWorkerSources doit mapper : { <webworker.js url>: src, <recaptcha__fr.js url>: src }.
 */
function installWorkerShim(window, cfg) {
  const logger = cfg.logger || (() => {});
  const scheduler = window.__rcScheduler || ((fn) => setTimeout(fn, 0));
  class FakeWorker {
    constructor(url) {
      this._url = String(url);
      this.onmessage = null; this.onerror = null;
      this._listeners = { message: [], error: [] };
      logger('worker', `new Worker(${this._url})`);
      const sources = window.__rcWorkerSources || {};
      const bootSrc = sources[this._url];
      const self = this;

      // DedicatedWorkerGlobalScope : navigator/crypto/performance/messaging, PAS de document/window.
      const { MessageChannel } = makeMessaging(scheduler);
      const wnav = window.navigator;
      const wid = (cfg.identity) || require('./xbv').browserIdentity();
      const g = {
        location: { href: this._url, origin: 'https://www.google.com' },
        navigator: {
          userAgent: wid.userAgent, platform: wid.navPlatform, hardwareConcurrency: 8, deviceMemory: 8,
          language: (process.env.RC_LOCALE || 'fr-FR'),
          languages: (process.env.RC_LANGUAGES || 'fr-FR,fr,en-US,en').split(',').map((s) => s.trim()).filter(Boolean),
          webdriver: false,
          userAgentData: wnav.userAgentData, storage: wnav.storage, getBattery: wnav.getBattery,
          onLine: true, product: 'Gecko',
        },
        crypto: window.crypto, performance: workerPerformance(window),
        TextEncoder, TextDecoder, MessageChannel, MessagePort: window.MessagePort,
        URL: window.URL, URLSearchParams: window.URLSearchParams, Blob: window.Blob,
        atob: (s) => Buffer.from(s, 'base64').toString('binary'),
        btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
        setTimeout: (fn, ms, ...a) => setTimeout(fn, ms, ...a),
        clearTimeout: (id) => clearTimeout(id),
        setInterval: (fn, ms, ...a) => setInterval(fn, ms, ...a),
        clearInterval: (id) => clearInterval(id),
        queueMicrotask: (fn) => queueMicrotask(fn),
        close() {}, onmessage: null, onerror: null, onmessageerror: null,
        _l: { message: [], error: [] },
        addEventListener(t, fn) { (g._l[t] = g._l[t] || []).push(fn); },
        removeEventListener(t, fn) { const a = g._l[t] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
        postMessage: (data, transfer, transfer2) => self._deliverToMain(data, extractPorts(transfer, transfer2)),
        importScripts: (...urls) => {
          for (const u of urls) {
            const key = String(u);
            const s = sources[key] || sources[key.split('?')[0]];
            if (!s) { logger('worker-import-miss', key.slice(0, 80)); continue; }
            try { vm.runInContext(s, ctx, { filename: key }); }
            catch (e) { logger('worker-import-err', `${key.slice(0, 60)}: ${e.message}`); }
          }
        },
      };
      g.self = g; g.globalThis = g;
      // Enrichissement du WorkerGlobalScope (champ 22 worker) — OPT-IN : un graphe partiel peut être
      // PIRE (hash anormal = flaggé) qu'une surface minimale. RC_WORKER_GRAPH=1 pour l'activer/A-B tester.
      if (process.env.RC_WORKER_GRAPH === '1') { try { enrichWorkerGlobal(g, window); } catch (_) {} }
      if (global.__cc) { try { g.__cc = global.__cc; } catch (_) {} }   // canal capture cipher (RC_CIPHER_CAP)
      if (global.__cc2) { try { g.__cc2 = global.__cc2; } catch (_) {} } // canal capture hashString
      if (global.__b64) { try { g.__b64 = global.__b64; } catch (_) {} } // canal capture encodeur base64 (reverse field16)
      if (global.__dsc) { try { g.__dsc = global.__dsc; } catch (_) {} } // canal capture deriveSignalCode (reverse field16)
      if (global.__bloomAdd) { try { g.__bloomAdd = global.__bloomAdd; } catch (_) {} } // canal capture bloom Ot.add (field16)
      if (global.__bloomOut) { try { g.__bloomOut = global.__bloomOut; } catch (_) {} } // canal capture bloom Ot.toString (field16)
      if (global.__f16enc) { try { g.__f16enc = global.__f16enc; } catch (_) {} } // canal capture encodeur field16
      if (global.__f16msg) { try { g.__f16msg = global.__f16msg; } catch (_) {} } // canal capture message field16
      if (process.env.RC_U8HOOK === '1' && g.Uint8Array) { // hook alloc Uint8Array ~2660 DANS le worker (cipher field16)
        try {
          const OU = g.Uint8Array;
          g.Uint8Array = new Proxy(OU, { construct(T, args) { const o = Reflect.construct(T, args); try { const n = typeof args[0] === 'number' ? args[0] : (o && o.length); if (n >= 2400 && n <= 2900 && global.__u8) global.__u8(n, 'WORKER\n' + (new Error()).stack); } catch (_) {} return o; } });
        } catch (_) {}
      }
      if (process.env.RC_JOINHOOK === '1' && g.Array && g.Array.prototype) { // hook join DANS le worker (field16 y est construit)
        try {
          const AP = g.Array.prototype, oj = AP.join;
          AP.join = function (sep) { const r = oj.apply(this, arguments); try { if (typeof r === 'string' && r.length > 2500 && global.__join) global.__join(r.length, r.slice(0, 24), 'WORKER\n' + (new Error()).stack); } catch (_) {} return r; };
        } catch (_) {}
      }
      // RC_COV : pré-seed le collecteur de couverture du worker vers un tableau Node partagé (lu par field16_jsdom)
      if (process.env.RC_COV) { try { g.__COVSET = global.__RC_WORKER_COV = global.__RC_WORKER_COV || []; } catch (_) {} }
      this._workerGlobal = g;
      // Sonde RC_PROBE_MISSING=1 : logge tout accès à une propriété ABSENTE du global worker et de
      // navigator (= ce que le script fingerprint cherche mais que jsdom n'a pas → collecteur échoué).
      let ctxTarget = g;
      if (process.env.RC_PROBE_MISSING === '1') {
        try { g.navigator = installMissProbe(g.navigator, 'navigator'); } catch (_) {}
        ctxTarget = installMissProbe(g, 'self');
        g.self = ctxTarget; g.globalThis = ctxTarget;
      }
      const ctx = vm.createContext(ctxTarget);
      if (bootSrc) {
        try { vm.runInContext(bootSrc, ctx, { filename: this._url }); }
        catch (e) { logger('worker-boot-err', e.message); }
      } else {
        logger('worker-warn', 'source webworker.js absente au new Worker()');
      }
    }
    postMessage(data, transfer, transfer2) {
      // main → worker (avec ports transférés éventuels)
      const wg = this._workerGlobal;
      const ports = extractPorts(transfer, transfer2);
      const ev = { data, ports, type: 'message', origin: '' };
      if (window.__rcDebug) logger('w<-main', `${typeof data} ports=${ports.length} ${preview(data)}`);
      scheduler(() => {
        try {
          if (typeof wg.onmessage === 'function') wg.onmessage(ev);
          (wg._l.message || []).forEach(fn => fn(ev));
        } catch (e) { logger('worker-onmsg-error', e.message); }
      });
    }
    _deliverToMain(data, ports) {
      const ev = { data, ports: ports || [], type: 'message', origin: '' };
      if (window.__rcDebug) logger('w->main', `ports=${(ports || []).length} ${preview(data)}`);
      scheduler(() => {
        try {
          if (typeof this.onmessage === 'function') this.onmessage(ev);
          (this._listeners.message || []).forEach(fn => fn(ev));
        } catch (e) {}
      });
    }
    addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
    removeEventListener() {}
    terminate() {}
  }
  try { native(FakeWorker, 'Worker'); Object.defineProperty(window, 'Worker', { configurable: true, writable: true, value: FakeWorker }); } catch (_) {}
}

/**
 * enrichWorkerGlobal(g, window) - rapproche le WorkerGlobalScope shimme d'un vrai
 * DedicatedWorkerGlobalScope de Chrome. Le fingerprint hashe les cles du global worker
 * (champ 22 cote worker) ; notre g n'avait que ~30 cles vs des centaines dans un vrai
 * Chrome, discriminant structurel. On ajoute (a) les vrais globals Web dispo dans Node,
 * (b) les interfaces worker-compatibles en constructeurs natif-like (comme browser_graph
 * pour le window). On N'ajoute PAS les interfaces window-only (document, HTML, Window).
 */
function enrichWorkerGlobal(g, window) {
  let added = 0;
  // (a) vrais globals Web présents dans Node 18+ (mêmes objets → prototypes/toString natifs réels)
  const REAL = ['fetch', 'Headers', 'Request', 'Response', 'FormData', 'Blob', 'File',
    'ReadableStream', 'WritableStream', 'TransformStream', 'ByteLengthQueuingStrategy', 'CountQueuingStrategy',
    'TextEncoder', 'TextDecoder', 'TextEncoderStream', 'TextDecoderStream', 'CompressionStream', 'DecompressionStream',
    'URL', 'URLSearchParams', 'WebSocket', 'Event', 'EventTarget', 'MessageEvent', 'CloseEvent', 'ErrorEvent',
    'CustomEvent', 'PromiseRejectionEvent', 'AbortController', 'AbortSignal', 'DOMException', 'structuredClone',
    'BroadcastChannel', 'reportError', 'EventSource'];
  for (const k of REAL) {
    if (g[k] === undefined && typeof globalThis[k] !== 'undefined') { try { g[k] = globalThis[k]; added++; } catch (_) {} }
  }
  // (b) interfaces worker : self-scope + celles de browser_graph compatibles worker (pas de DOM/HTML/window-only)
  let CHROME_GLOBALS = [];
  try { CHROME_GLOBALS = require('./browser_graph').CHROME_GLOBALS || []; } catch (_) {}
  const WORKER_SCOPE = ['DedicatedWorkerGlobalScope', 'WorkerGlobalScope', 'WorkerNavigator', 'WorkerLocation',
    'ImageData', 'ImageBitmap', 'createImageBitmap', 'OffscreenCanvas', 'OffscreenCanvasRenderingContext2D',
    'ImageBitmapRenderingContext', 'Path2D', 'IDBFactory', 'IDBDatabase', 'IDBObjectStore', 'IDBIndex', 'IDBCursor',
    'IDBCursorWithValue', 'IDBKeyRange', 'IDBTransaction', 'IDBRequest', 'IDBOpenDBRequest', 'IDBVersionChangeEvent',
    'CacheStorage', 'Cache', 'FileReader', 'FileReaderSync', 'ProgressEvent', 'WebGLRenderingContext',
    'WebGL2RenderingContext', 'WebGLBuffer', 'WebGLProgram', 'WebGLShader', 'WebGLTexture', 'WebGLFramebuffer',
    'WebGLRenderbuffer', 'WebGLUniformLocation', 'WebGLActiveInfo', 'WebGLShaderPrecisionFormat',
    'PerformanceObserver', 'PerformanceObserverEntryList', 'PerformanceEntry', 'PerformanceMark', 'PerformanceMeasure',
    'PerformanceResourceTiming', 'PerformanceServerTiming', 'CompressionStream', 'DecompressionStream',
    'CryptoKey', 'SubtleCrypto', 'Crypto', 'CustomStateSet', 'CountQueuingStrategy'];
  // interfaces window-only à EXCLURE de la liste browser_graph (elles n'existent pas dans un worker)
  const NOT_IN_WORKER = /^(RTC|Notification|Payment|Speech|Gamepad|GPU|USB|Bluetooth|Serial|HID|MIDI|XR|Sensor|Accelerometer|Gyroscope|Magnetometer|AbsoluteOrientation|RelativeOrientation|AmbientLight|LinearAcceleration|Gravity|AudioContext|webkitAudioContext|OfflineAudioContext|webkitOfflineAudioContext|Audio|Gain|Oscillator|Analyser|Biquad|Dynamics|Convolver|Delay|Panner|StereoPanner|WaveShaper|ChannelMerger|ChannelSplitter|ConstantSource|IIRFilter|MediaElement|MediaStream|BaseAudio|PeriodicWave|MediaRecorder|MediaSource|SourceBuffer|BlobEvent|ImageCapture|MediaDevices|MediaDeviceInfo|MediaEncrypted|MediaKey|CSS|FontFace|VisualViewport|IntersectionObserver|ResizeObserver|ServiceWorker|Push|Battery|NetworkInformation|Ink|EyeDropper|WakeLock|LaunchQueue|VirtualKeyboard|Highlight|BarcodeDetector|IdleDetector|Sanitizer|Trusted|CookieStore|CookieChange|ContentIndex|BackgroundFetch|NavigationPreload|PressureObserver|Scheduler|Scheduling|Task|Report|LargestContentful|Layout|FileSystem|StorageManager)/;
  const list = WORKER_SCOPE.concat(CHROME_GLOBALS.filter(n => !NOT_IN_WORKER.test(n)));
  const TypeErr = g.TypeError || globalThis.TypeError;
  for (const name of list) {
    if (g[name] !== undefined) continue;
    try {
      const ctor = function () { throw new TypeErr(`Failed to construct '${name}': Illegal constructor`); };
      try { Object.defineProperty(ctor, 'name', { value: name, configurable: true }); } catch (_) {}
      const proto = {}; try { Object.defineProperty(proto, 'constructor', { value: ctor, configurable: true, writable: true }); } catch (_) {}
      try { Object.defineProperty(ctor, 'prototype', { value: proto, writable: false }); } catch (_) {}
      native(ctor, name);
      Object.defineProperty(g, name, { value: ctor, configurable: true, writable: true, enumerable: false });
      added++;
    } catch (_) {}
  }
  // WorkerNavigator enrichi : connection + les compteurs qu'un vrai worker expose
  try {
    if (g.navigator && !g.navigator.connection) g.navigator.connection = { downlink: 10, effectiveType: '4g', rtt: 50, saveData: false, type: 'wifi', onchange: null, addEventListener() {}, removeEventListener() {} };
  } catch (_) {}
  return added;
}

// Registre global des accès manquants (partagé entre worker + window). RC_PROBE_MISSING=1.
const _MISS = new Set();
const _HITS = { total: 0, byLabel: {} };
if (process.env.RC_PROBE_MISSING === '1') {
  process.on('exit', () => { try { process.stderr.write(`  [probe] accès total=${_HITS.total} par=${JSON.stringify(_HITS.byLabel)} manquants=${_MISS.size}\n`); } catch (_) {} });
}
function installMissProbe(obj, label) {
  if (!obj || typeof obj !== 'object') return obj;
  const skip = (k) => typeof k !== 'string' || /^(then|Symbol|__|constructor|document|inspect|toJSON|nodeType|prototype|length|name|caller|arguments)$/.test(k) || typeof globalThis[k] !== 'undefined';
  const note = (kind, k) => { const key = kind + ' ' + label + '.' + k; if (!_MISS.has(key)) { _MISS.add(key); try { process.stderr.write(`  [miss ${kind}] ${label}.${k}\n`); } catch (_) {} } };
  return new Proxy(obj, {
    get(t, k, r) {
      _HITS.total++; _HITS.byLabel[label] = (_HITS.byLabel[label] || 0) + 1;
      let v; try { v = Reflect.get(t, k, r); } catch (e) { return undefined; }
      if (v === undefined && !skip(k)) note('get', k);
      return v;
    },
    has(t, k) {                 // 'X' in obj → feature-detection
      const present = Reflect.has(t, k);
      if (!present && !skip(k)) note('has', k);
      return present;
    },
  });
}

module.exports = { installShims, UA, enrichWorkerGlobal, installMissProbe, _MISS };
