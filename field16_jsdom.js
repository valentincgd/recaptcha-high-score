/**
 * field16_jsdom.js — Génère le champ 16 (/reload) en EXÉCUTANT le vrai recaptcha__fr.js dans jsdom.
 *
 * ⚠️ USAGE RECHERCHE / ÉDUCATIF UNIQUEMENT (cf. disclaimers des repos elyelysiox/*).
 *
 * Idée (result.md §10 « Node + sandbox JS + shims ») : `deriveSignalCode` + le cipher du
 * champ 16 vivent dans du bytecode construit dynamiquement → non réimplémentables à la main.
 * On laisse donc le VRAI script les construire, dans une window jsdom shimmée, et on
 * intercepte le POST /reload pour en extraire le champ 16.
 *
 * Étapes :
 *   1. Charger le cache ./scripts (fait par: npm run fetch)
 *   2. Pré-fetch webworker.js (le shim Worker en a besoin au new Worker())
 *   3. Construire jsdom (page type Ticketmaster) + shims navigateur
 *   4. Intercepter réseau : ResourceLoader (scripts/anchor) + XHR/fetch (/reload)
 *   5. Injecter le loader enterprise.js → il charge recaptcha__fr.js (servi par le cache)
 *   6. grecaptcha.enterprise.ready(() => execute(siteKey,{action}))
 *   7. Capturer le body /reload → décoder protobuf → champ 16
 *
 * Lancer : node field16_jsdom.js [--probe] [--timeout=45000]
 *   --probe : ne déclenche pas execute(), observe juste le chargement (diagnostic).
 */
'use strict';
// Fuseau horaire cohérent avec l'IP (résidentielle FR → Europe/Paris). Posé AVANT tout usage de
// Date/Intl pour que la page jsdom reporte le bon getTimezoneOffset + Intl…timeZone. RC_TZ pour changer.
process.env.TZ = process.env.RC_TZ || 'Europe/Paris';
const fs = require('fs');
const path = require('path');
const { JSDOM, ResourceLoader, VirtualConsole, CookieJar } = require('jsdom');
const { installShims } = require('./tools/shims');
const pb = require('./tools/protobuf');
const xbv = require('./tools/xbv');
const tlsBridge = require('./tools/tls_bridge');

const ARGS = process.argv.slice(2);
// Config (module-level, surchargeable par run(opts) — voir plus bas). `let` volontaire.
let PROBE = ARGS.includes('--probe');
let DEBUG = ARGS.includes('--debug') || process.env.RC_DEBUG === '1';
let QUIET = false;
let TIMEOUT = Number((ARGS.find(a => a.startsWith('--timeout=')) || '').split('=')[1]) || 45000;

let SITE_KEY = process.env.RC_SITEKEY || '6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV';
let ORIGIN   = process.env.RC_ORIGIN  || 'https://www.ticketmaster.com';
// URL de la page vue par la VM reCAPTCHA (window.location.href / document.URL → fingerprint).
// Par défaut la page event Ticketmaster ciblée. RC_PAGE_URL (URL complète) ou RC_EVENT_ID (juste l'id) pour changer.
let EVENT_ID = process.env.RC_EVENT_ID || '020064BAD9B8236F';
let PAGE_URL = process.env.RC_PAGE_URL || null;   // si null → ORIGIN + '/event/' + EVENT_ID (résolu dans run())
let HL       = process.env.RC_HL      || 'fr';
let ACTION   = process.env.RC_ACTION  || 'Event';
let MODE     = process.env.RC_MODE    || 'enterprise';   // 'enterprise' (enterprise.js) | 'standard' (api.js)
// X-Browser-Validation : OFF par défaut. Un vrai Brave ne l'envoie pas ; l'injecter par-dessus un
// fingerprint jsdom faible ajoute une incohérence qui peut BAISSER le score. RC_XBV_INJECT=1 pour tester.
let INJECT_XBV = process.env.RC_XBV_INJECT === '1';
// Simulation de mouvements souris → remplit le champ 25 ([[[5006,N]]]) + signaux VM. ON par défaut.
let MOUSE = process.env.RC_MOUSE !== '0';
let MOUSE_MS = Number(process.env.RC_MOUSE_MS) || 1600;
// Mode de trajectoire souris : 'human' (Bézier/Fitts/tremor, défaut) | 'robotic' (ancien sinus déterministe, pour A/B)
let MOUSE_MODE = process.env.RC_MOUSE_MODE || 'human';
// Nombre d'appels execute() successifs dans LA MÊME session. Le 1er token v3 est « froid » (peu de
// signaux) → score bas ; les suivants scorent plus haut (la VM a accumulé timing/comportement).
// Observé : 1er reload=0.3, 2ᵉ=0.7. On garde le DERNIER token. RC_EXECUTE_TIMES pour changer.
let EXECUTE_TIMES  = Number(process.env.RC_EXECUTE_TIMES) || 2;
let EXECUTE_GAP_MS = Number(process.env.RC_EXECUTE_GAP_MS) || 3000;   // pause entre deux execute()
// Warm-up AVANT execute() : laisse la session « vivre » (temps + événements non-pointeur) pour accumuler
// des samples timing/événements dans le champ 20 (le vrai body a un compteur ~2× le nôtre = session + longue).
let PRE_EXECUTE_MS = Number(process.env.RC_PRE_EXECUTE_MS || 4000);
// A/B « body minimal » (hypothèse BypassV3 : le fingerprint synthétique DESSERT le score). RC_MINIMAL_BODY=1
// réécrit le body /reload sortant en ne gardant QUE certains champs (défaut 1,2,6,8,14 = comme BypassV3).
// RC_MINIMAL_KEEP="1,2,6,7,8,14,21" pour tester « sans fingerprint MAIS avec la confiance (7/21) ».
let MINIMAL_BODY = process.env.RC_MINIMAL_BODY === '1';
const MINIMAL_KEEP = new Set((process.env.RC_MINIMAL_KEEP || '1,2,6,8,14').split(',').map(s => Number(s.trim())).filter(Boolean));

// Proxy (levier n°1 du score). Formats acceptés :
//   http://host:port · http://user:pass@host:port · host:port · host:port:user:pass
function parseProxy(raw) {
  if (!raw) return null;
  raw = String(raw).trim();
  if (/^[a-z0-9]+:\/\//i.test(raw)) return raw;                 // déjà une URL
  const p = raw.split(':');
  if (p.length === 2) return `http://${p[0]}:${p[1]}`;
  if (p.length === 4) return `http://${encodeURIComponent(p[2])}:${encodeURIComponent(p[3])}@${p[0]}:${p[1]}`;
  return raw;
}
let PROXY = parseProxy(process.env.RC_PROXY);

// TLS Chrome : route TOUT le trafic (jsdom + fetch loader/worker) via node-tls-client (JA3/JA4 +
// HTTP/2 de Chrome), en amont du proxy résidentiel. ON par défaut. RC_TLS=0 pour Node TLS brut.
// chrome_150 : JA4 t13d1517h2_8daaf6152771_dcad5a053991 (17 extensions, incl. post-quantique
// X25519MLKEM768) — le VRAI TLS de Chrome 150, distinct de chrome_131 (16 ext). La DLL le supporte.
let TLS_CHROME = process.env.RC_TLS !== '0';
let TLS_CID = process.env.RC_TLS_CID || 'chrome_150';
let BRIDGE = null;   // { url, port, close } — proxy local MITM, démarré dans run()

// netGet — un GET qui sort en Chrome-TLS via le pont si actif, sinon fetch Node (+ proxy undici).
async function netGet(url, headers) {
  if (BRIDGE) return tlsBridge.tlsFetch(url, { headers });
  return fetch(url, { headers, dispatcher: proxyDispatcher() });
}

// Dispatcher undici pour router les fetch Node (loader, webworker) via le proxy.
let PROXY_DISPATCHER = null;
function proxyDispatcher() {
  if (!PROXY) return undefined;
  if (!PROXY_DISPATCHER) {
    try { const { ProxyAgent } = require('undici'); PROXY_DISPATCHER = new ProxyAgent(PROXY); }
    catch (e) { PROXY_DISPATCHER = null; }
  }
  return PROXY_DISPATCHER || undefined;
}

// Endpoints selon le mode (enterprise = /enterprise/… ; standard v3 = /api2/…)
const modeInfo = () => MODE === 'standard'
  ? { loader: 'api.js',        seg: 'api2',       grec: (w) => w.grecaptcha }
  : { loader: 'enterprise.js', seg: 'enterprise', grec: (w) => w.grecaptcha && w.grecaptcha.enterprise };

// Récupère le loader (enterprise.js|api.js) frais pour cette clé/mode (1,5 Ko).
async function fetchLoader(siteKey) {
  const url = `https://www.google.com/recaptcha/${modeInfo().loader}?render=${siteKey}`;
  const res = await netGet(url, { 'User-Agent': IDENTITY.userAgent, 'Accept': '*/*', 'Referer': ORIGIN + '/' });
  const body = await res.text();
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  return body;
}

// Identité Chrome cohérente (UA + sec-ch-ua + X-Browser-Validation), cf. tools/xbv.js.
// Défaut : Chrome local extrait (scripts/xbv_key.json) sinon v138. RC_CHROME_VERSION/RC_XBV_KEY pour forcer.
let IDENTITY = xbv.browserIdentity({
  version: process.env.RC_CHROME_VERSION,       // ex. "150.0.0.0"
  platform: process.env.RC_PLATFORM,            // "windows" | "linux" | "macos"
  apiKey: process.env.RC_XBV_KEY,               // clé extraite (optionnel)
});
let CHROME_HEADERS = xbv.chromeHeaders(IDENTITY);

const SCRIPTS_DIR = path.join(__dirname, 'scripts');
function loadCache() {
  const metaPath = path.join(SCRIPTS_DIR, 'meta.json');
  if (!fs.existsSync(metaPath)) {
    console.error('✖ Cache absent. Lance d\'abord : node tools/fetch_scripts.js');
    process.exit(1);
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  // le loader est désormais fetché frais par run() (dépend clé/mode) ; on lit juste le gros script cache
  // RC_CIPHER_CAP : sert la version INSTRUMENTÉE (capture du cipher via self.__cc) au lieu du script normal.
  // RC_SCRIPT_FILE : sert un fichier de script arbitraire (ex. recaptcha_readable.js déobfusqué) pour
  // prouver l'équivalence comportementale de bout en bout (le script transformé génère-t-il un token ?).
  const scriptFile = process.env.RC_SCRIPT_FILE
    ? process.env.RC_SCRIPT_FILE
    : (process.env.RC_CIPHER_CAP && fs.existsSync(path.join(SCRIPTS_DIR, 'recaptcha_instrumented.js'))
      ? 'recaptcha_instrumented.js' : `recaptcha__${meta.hl}.js`);
  const main = fs.readFileSync(path.join(SCRIPTS_DIR, scriptFile), 'utf8');
  return { meta, main };
}

const log = (() => {
  const t0 = Date.now();
  return (tag, msg) => { if (!QUIET) console.log(`[+${String(Date.now() - t0).padStart(5)}ms] ${tag.padEnd(14)} ${msg}`); };
})();

// Les erreurs async du VM reCAPTCHA (Promises/worker) peuvent échapper à jsdom et tuer Node.
// On les loggue sans crasher, pour que le harnais continue jusqu'au /reload ou au timeout.
let __pageErrors = 0;
process.on('uncaughtException', (e) => { __pageErrors++; log('uncaught', (e && (e.message || e)) + ''); });
process.on('unhandledRejection', (e) => { __pageErrors++; log('unhandledRej', (e && (e.message || e)) + ''); });

/**
 * simulateMouse(window, ms) — dispatche une trajectoire réaliste de pointermove (+ un
 * pointerdown/up) sur le document, pour peupler le champ 25 ([[[5006,N]]]) et les signaux
 * VM souris (352/659). Un vrai body antcpt montre ~50-90 pointermove ; on vise ~60.
 */
// Dispatcher A/B : choisit la trajectoire selon RC_MOUSE_MODE.
async function simulateMouse(window, ms) {
  return MOUSE_MODE === 'robotic' ? simulateMouseRobotic(window, ms) : simulateMouseHuman(window, ms);
}

/**
 * sessionWarmup(window, ms) — laisse la page « vivre » pendant ms : ticks requestAnimationFrame +
 * temps qui passe + quelques événements NON-pointeur (visibilitychange/focus) bénins. But : accumuler
 * des samples timing/événements dans le champ 20 (le vrai body a un compteur ~2× le nôtre) SANS toucher
 * le champ 25 (souris) — donc on n'émet AUCUN pointer/mouse ici.
 */
async function sessionWarmup(window, ms) {
  const doc = window.document;
  const fire = (target, type) => {
    try {
      let ev;
      try { ev = new window.Event(type, { bubbles: false }); }
      catch (_) { ev = doc.createEvent('Event'); ev.initEvent(type, false, false); }
      target.dispatchEvent(ev);
    } catch (_) {}
  };
  const start = Date.now();
  let ticks = 0;
  while (Date.now() - start < ms) {
    try { if (window.requestAnimationFrame) window.requestAnimationFrame(() => {}); } catch (_) {}
    if (ticks % 8 === 4) fire(doc, 'visibilitychange');   // événements bénins, courants sur une vraie page
    if (ticks % 12 === 6) fire(window, 'focus');
    ticks++;
    await new Promise(r => setTimeout(r, 55));
  }
  return ticks;
}

// Ancienne trajectoire ROBOTIQUE (sinus déterministe, jitter fixe non-seedé → identique à chaque run).
// Conservée uniquement pour l'A/B : montrer le delta de score vs la version humaine.
async function simulateMouseRobotic(window, ms) {
  const doc = window.document;
  const W = window.innerWidth || 1280, H = window.innerHeight || 720;
  const PE = window.PointerEvent || window.MouseEvent;
  const steps = 60;
  const dt = Math.max(8, Math.floor(ms / steps));
  let x = Math.floor(W * 0.2), y = Math.floor(H * 0.3);
  const fire = (type, ex, ey, extra = {}) => {
    const init = { bubbles: true, cancelable: true, composed: true, view: window,
      clientX: ex, clientY: ey, screenX: ex, screenY: ey + 80,
      pointerId: 1, pointerType: 'mouse', isPrimary: true, ...extra };
    let ev; try { ev = new PE(type, init); } catch (_) { try { ev = new window.MouseEvent(type, init); } catch (_) { return; } }
    try { (doc.elementFromPoint ? (doc.elementFromPoint(ex, ey) || doc.body || doc) : (doc.body || doc)).dispatchEvent(ev); }
    catch (_) { try { doc.dispatchEvent(ev); } catch (_) {} }
  };
  let count = 0;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    x += Math.round(Math.sin(t * Math.PI * 2) * 14 + (Math.round((i * 9301 + 49297) % 233 / 233 * 10) - 5));
    y += Math.round(Math.cos(t * Math.PI * 1.5) * 10 + (Math.round((i * 4331 + 17) % 197 / 197 * 8) - 4));
    x = Math.max(2, Math.min(W - 2, x)); y = Math.max(2, Math.min(H - 2, y));
    fire('pointermove', x, y); fire('mousemove', x, y); count++;
    if (i === Math.floor(steps * 0.7)) {
      fire('pointerdown', x, y, { pressure: 0.5, buttons: 1 });
      fire('mousedown', x, y, { buttons: 1 });
      await new Promise(r => setTimeout(r, 40));
      fire('pointerup', x, y, { pressure: 0, buttons: 0 });
      fire('mouseup', x, y, { buttons: 0 });
      fire('click', x, y);
    }
    await new Promise(r => setTimeout(r, dt));
  }
  return count;
}

async function simulateMouseHuman(window, ms) {
  const doc = window.document;
  const W = window.innerWidth || 1280, H = window.innerHeight || 720;
  const PE = window.PointerEvent || window.MouseEvent;
  const R = Math.random;
  // Gaussienne (Box-Muller) pour tremor & bruit de timing
  const randn = () => { let u = 0, v = 0; while (u === 0) u = R(); while (v === 0) v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const sleep = m => new Promise(r => setTimeout(r, m));

  let lastX = null, lastY = null, lastT = 0;
  const fire = (type, ex, ey, extra = {}) => {
    ex = Math.max(1, Math.min(W - 1, ex)); ey = Math.max(1, Math.min(H - 1, ey));
    const cx = Math.round(ex), cy = Math.round(ey);
    const mv = (lastX == null) ? { movementX: 0, movementY: 0 } : { movementX: cx - lastX, movementY: cy - lastY };
    const init = { bubbles: true, cancelable: true, composed: true, view: window,
      clientX: cx, clientY: cy, screenX: cx, screenY: cy + 80, pageX: cx, pageY: cy,
      pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 0, ...mv, ...extra };
    let ev; try { ev = new PE(type, init); } catch (_) { try { ev = new window.MouseEvent(type, init); } catch (_) { return; } }
    try { (doc.elementFromPoint ? (doc.elementFromPoint(cx, cy) || doc.body || doc) : (doc.body || doc)).dispatchEvent(ev); }
    catch (_) { try { doc.dispatchEvent(ev); } catch (_) {} }
    if (type === 'pointermove' || type === 'mousemove') { lastX = cx; lastY = cy; }
  };

  // Point de départ : bord de l'écran comme si la souris venait d'entrer
  let x = W * (0.05 + R() * 0.25), y = H * (0.1 + R() * 0.3);
  // 3 à 6 gestes vers des cibles aléatoires (loi de Fitts : durée ∝ distance)
  const gestures = 3 + Math.floor(R() * 4);
  let count = 0, elapsed = 0;
  const budget = ms;

  const cubic = (p0, p1, p2, p3, t) => { const u = 1 - t; return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3; };

  for (let g = 0; g < gestures && elapsed < budget; g++) {
    const tx = W * (0.1 + R() * 0.8), ty = H * (0.1 + R() * 0.8);
    const dist = Math.hypot(tx - x, ty - y);
    // durée du geste (Fitts-like) + points de contrôle Bézier décentrés (courbe naturelle)
    const dur = Math.min(budget - elapsed, 180 + dist * (0.6 + R() * 0.5) + randn() * 40);
    const nSteps = Math.max(6, Math.round(dur / (14 + R() * 10)));
    // overshoot occasionnel : la cible réelle dépasse un peu, puis correction au geste suivant
    const overshoot = R() < 0.3 ? 1 + (0.04 + R() * 0.08) : 1;
    const ex = x + (tx - x) * overshoot, ey = y + (ty - y) * overshoot;
    const c1x = x + (ex - x) * (0.2 + R() * 0.2) + (randn() * dist * 0.15);
    const c1y = y + (ey - y) * (0.2 + R() * 0.2) + (randn() * dist * 0.15);
    const c2x = x + (ex - x) * (0.6 + R() * 0.2) + (randn() * dist * 0.12);
    const c2y = y + (ey - y) * (0.6 + R() * 0.2) + (randn() * dist * 0.12);

    for (let i = 1; i <= nSteps && elapsed < budget; i++) {
      // easing ease-in-out (accélère puis décélère — vitesse cloche)
      const s = i / nSteps, eased = s < 0.5 ? 2 * s * s : 1 - Math.pow(-2 * s + 2, 2) / 2;
      // position sur la Bézier + micro-tremor gaussien
      const px = cubic(x, c1x, c2x, ex, eased) + randn() * 0.8;
      const py = cubic(y, c1y, c2y, ey, eased) + randn() * 0.8;
      fire('pointermove', px, py); fire('mousemove', px, py); count++;
      // timing par pas : ~12-22ms + jitter, avec pauses humaines occasionnelles
      let step = Math.max(6, 14 + randn() * 5);
      if (R() < 0.06) step += 60 + R() * 220;            // pause de réflexion/hésitation
      elapsed += step; await sleep(Math.round(step));
    }
    x = ex; y = ey;
    // petite pause entre deux gestes (recentrage du regard)
    if (R() < 0.5) { const p = 40 + R() * 160; elapsed += p; await sleep(Math.round(p)); }

    // clic réaliste sur ~1 geste (down/up avec délai humain 60-140ms + léger drift)
    if (g === Math.floor(gestures / 2)) {
      fire('pointerdown', x, y, { pressure: 0.4 + R() * 0.2, button: 0, buttons: 1 });
      fire('mousedown', x, y, { button: 0, buttons: 1 });
      const hold = 60 + R() * 80; elapsed += hold; await sleep(Math.round(hold));
      x += randn() * 1.5; y += randn() * 1.5;             // micro-drift pendant l'appui
      fire('pointerup', x, y, { pressure: 0, button: 0, buttons: 0 });
      fire('mouseup', x, y, { button: 0, buttons: 0 });
      fire('click', x, y, { button: 0, buttons: 0, detail: 1 });
    }
  }
  return count;
}

async function prefetchWorker(version, hl) {
  const url = `https://www.google.com/recaptcha/${modeInfo().seg}/webworker.js?hl=${hl}&v=${version}`;
  try {
    const res = await netGet(url, {
      'User-Agent': IDENTITY.userAgent, 'Accept': '*/*',
      'Referer': 'https://www.google.com/recaptcha/enterprise/anchor',
    });
    const body = await res.text();
    log('prefetch', `webworker.js → HTTP ${res.status} (${body.length}B)`);
    return { url, body: res.ok ? body : null };
  } catch (e) {
    log('prefetch-err', `webworker.js: ${e.message}`);
    return { url, body: null };
  }
}

/** ResourceLoader : sert le script principal depuis le cache, laisse passer le reste.
 *  Le proxy posé ici couvre AUSSI le XHR /reload (jsdom XHR lit window._resourceLoader._proxy). */
function makeLoader(cache, captures) {
  const rlOpts = { userAgent: IDENTITY.userAgent };
  if (BRIDGE) { rlOpts.proxy = BRIDGE.url; rlOpts.strictSSL = false; }  // jsdom → MITM Chrome-TLS (cert jetable)
  else if (PROXY) rlOpts.proxy = PROXY;
  const base = new ResourceLoader(rlOpts);
  return new (class extends ResourceLoader {
    constructor() { super(rlOpts); }
    fetch(url, options) {
      const u = String(url);
      captures.requests.push({ kind: 'resource', url: u });
      log('resource', u.slice(0, 110));
      if (/recaptcha__[a-z]+\.js/i.test(u)) {
        return Promise.resolve(Buffer.from(cache.main, 'utf8'));   // ← cache, pas de refetch
      }
      // scripts/ressources LEURRES (googletagmanager, assets/static.ticketmaster…) : présents dans
      // document.scripts (Idx 57) mais servis à VIDE — pas de vrai fetch tiers (rapide, pas d'erreur).
      if (/(googletagmanager|google-analytics|assets\.ticketmaster|static\.ticketmaster|\/epsf\/asset\/|\/eps-mgr(\?|$)|\/asset\/)/i.test(u)
          // libs tierces des pages (antcpt : jquery/vue/bootstrap/ua-parser/persist/yandex) + le tag <script src=api.js>
          // de la page elle-même (notre harnais injecte le loader séparément → on évite le double-chargement).
          || /(ajax\.googleapis\.com|cdnjs\.cloudflare\.com|bootstrapcdn|maxcdn|mc\.yandex\.ru|\/js\/(persist|ua-parser)|\/recaptcha\/api\.js)/i.test(u)) {
        return Promise.resolve(Buffer.from('', 'utf8'));
      }
      // anchor : réel — on inspecte la réponse (token présent ? page d'erreur ?)
      if (/\/(enterprise|api2)\/anchor\?/.test(u)) {
        return base.fetch(u, options).then(buf => {
          const html = buf ? buf.toString('utf8') : '';
          const hasToken = /recaptcha-token/.test(html) || /"rresp"|cfg\['?rresp'?\]|botguard|bgdata|"finput"/.test(html);
          const m = html.match(/id="recaptcha-token"[^>]*value="([^"]*)"/);
          captures.anchor = { bytes: html.length, hasToken, tokenPreview: m ? m[1].slice(0, 24) : null };
          log('anchor-resp', `${html.length}B token=${hasToken}${m ? ' value=' + m[1].slice(0, 20) + '…' : ''}`);
          if (!hasToken && html.length < 4000) log('anchor-body', html.replace(/\s+/g, ' ').slice(0, 300));
          return buf;
        }).catch(e => { log('anchor-err', e.message); throw e; });
      }
      // bframe / autres sous-ressources : réel (peut échouer sous jsdom, on log)
      return base.fetch(u, options);
    }
  })();
}

/**
 * attach(window, captures, cache, label) : rend une frame "prête" —
 * shims navigateur + capture réseau + observation récursive de ses iframes.
 * Appliqué au frame principal ET à chaque iframe (anchor/bframe), car sous jsdom
 * le POST /reload part de l'iframe anchor (Origin: google.com), pas de la page.
 */
function attach(window, captures, cache, worker, label) {
  if (!window || window.__rcAttached) return;
  window.__rcAttached = true;
  captures.frames.add(label);
  // matériaux nécessaires aux shims/worker de CETTE frame :
  //   - webworker.js (fait importScripts(recaptcha__fr.js))
  //   - recaptcha__fr.js lui-même, pour que le worker.importScripts le charge depuis le cache
  window.__rcWorkerSources = {};
  if (worker.body) window.__rcWorkerSources[worker.url] = worker.body;
  window.__rcWorkerSources[cache.meta.scriptUrl] = cache.main;
  window.__rcResourceEntries = [];
  if (DEBUG) { window.__rcDebug = true; window.__rcLogger = (m) => log('chan', `[${label}] ${m}`); }
  try { installShims(window, { origin: ORIGIN, identity: IDENTITY, logger: (t, m) => log(t, `[${label}] ${m}`) }); }
  catch (e) { log('attach-err', `${label} shims: ${e.message}`); }
  // Sonde BotGuard (RC_PROBE_ANCHOR=1) : détecte si le script LIT/ÉCRIT window.botguard dans CETTE frame
  // → prouve si le chemin BotGuard (new window.botguard.bg(bgdata)) est vivant ou mort dans cette version.
  if (process.env.RC_PROBE_ANCHOR === '1') {
    try {
      let _bg;
      Object.defineProperty(window, 'botguard', {
        configurable: true,
        get() { log('probe', `${label} READ window.botguard (=${typeof _bg})`); return _bg; },
        set(v) { log('probe', `${label} SET window.botguard = ${typeof v}`); _bg = v; },
      });
    } catch (_) {}
  }
  instrumentNetwork(window, captures, label);
  observeFrames(window, captures, cache, worker, label);
}

/** Observe l'insertion d'iframes et attache les shims à leur contentWindow au plus tôt. */
function observeFrames(window, captures, cache, worker, parentLabel) {
  const tryAttach = (ifr, idx) => {
    let tries = 0;
    const grab = () => {
      let cw = null;
      try { cw = ifr.contentWindow; } catch (_) { cw = null; }
      if (cw && cw.document) { attach(cw, captures, cache, worker, `${parentLabel}>iframe#${idx}`); return; }
      if (tries++ < 50) queueMicrotask(grab);   // course : attacher avant l'exécution des scripts d'iframe
    };
    grab();
  };
  const scan = () => {
    if (!window.document) return;
    const iframes = window.document.querySelectorAll('iframe');
    iframes.forEach((ifr, i) => { if (!ifr.__rcSeen) { ifr.__rcSeen = true; tryAttach(ifr, i); } });
  };
  try {
    const mo = new window.MutationObserver(scan);
    mo.observe(window.document, { childList: true, subtree: true });
  } catch (e) { log('observe-err', `${parentLabel}: ${e.message}`); }
  scan();
}

/** Instrumente XHR + fetch de la window pour capturer /reload (et tout le reste). */
function instrumentNetwork(window, captures, label = 'main') {
  const OrigXHR = window.XMLHttpRequest;
  if (OrigXHR) {
    const openP = OrigXHR.prototype.open, sendP = OrigXHR.prototype.send;
    const setHdrP = OrigXHR.prototype.setRequestHeader;
    OrigXHR.prototype.setRequestHeader = function (h, v) {
      try { (this.__rc || (this.__rc = {})).headers = Object.assign(this.__rc.headers || {}, { [h]: v }); } catch (_) {}
      return setHdrP.call(this, h, v);
    };
    OrigXHR.prototype.open = function (method, url, ...r) {
      this.__rc = { method, url: String(url), headers: {} };
      const ret = openP.call(this, method, url, ...r);
      // Chrome ajoute X-Browser-* aux requêtes Google (jsdom ignore les headers "Sec-*" interdits,
      // mais X-Browser-Validation passe — c'est LE header d'intégrité du sample /reload).
      // URLs Google absolues OU chemins /recaptcha/ relatifs (XHR depuis l'iframe google)
      if (INJECT_XBV && (/(^|\/\/)([^/]*\.)?(google|gstatic)\.com/.test(String(url)) || /^\/?recaptcha\//.test(String(url)))) {
        const sent = [];
        for (const [h, v] of Object.entries(CHROME_HEADERS)) {
          try { this.setRequestHeader(h, v); sent.push(h); } catch (_) { /* header interdit par jsdom → ignoré */ }
        }
        if (/\/reload\?/.test(String(url))) log('xbv', `X-Browser-Validation=${IDENTITY.xBrowserValidation} (Chrome ${IDENTITY.major}) headers=[${sent.join(', ')}]`);
      }
      return ret;
    };
    OrigXHR.prototype.send = function (body) {
      const info = this.__rc || {};
      captures.requests.push({ kind: 'xhr', method: info.method, url: info.url });
      log('xhr', `[${label}] ${info.method} ${String(info.url).slice(0, 84)}`);
      const isReload = info.url && /\/reload\?/.test(info.url);
      if (isReload) {
        onReload(info.url, body, captures, `xhr/${label}`, info.headers);
        // RC_RELOAD_CHROME=1 : ne PAS envoyer le reload via node-tls (détecté). On a le body ;
        // il sera rejoué via un vrai Chrome en fin de run(). jsdom XHR reste pending (OK, grâce timeout).
        if (process.env.RC_RELOAD_CHROME === '1') { log('reload-skip', 'envoi jsdom bloqué → replay Chrome exclusif'); return; }
        // RC_BLOCK_RELOAD=1 : simule un reload BLOQUÉ (net::ERR_BLOCKED, comme devtools) → on trace ce que
        // le script génère en FALLBACK (requête alternative ? token calculé localement ?).
        if (process.env.RC_BLOCK_RELOAD === '1') {
          log('reload-block', 'reload BLOQUÉ → trace du fallback (erreur XHR dispatchée)');
          const xhr = this;
          setTimeout(() => {
            try {
              xhr.dispatchEvent(new window.Event('readystatechange'));
              const Err = window.ProgressEvent || window.Event;
              try { xhr.dispatchEvent(new Err('error')); } catch (_) { xhr.dispatchEvent(new window.Event('error')); }
              xhr.dispatchEvent(new window.Event('loadend'));
              if (typeof xhr.onerror === 'function') { try { xhr.onerror(new window.Event('error')); } catch (_) {} }
            } catch (e) { log('reload-block-err', e.message); }
          }, 50);
          return;
        }
      }
      // listener de réponse AVANT le send (sinon en mode minimal on return avant de l'attacher).
      this.addEventListener('load', () => {
        if (isReload) {
          log('reload-resp', `HTTP ${this.status} (${(this.responseText || '').length}B)`);
          captures.reloadResponse = { status: this.status, text: this.responseText };
          if (DEBUG) log('reload-body', String(this.responseText || '').replace(/\s+/g, ' ').slice(0, 200));
        }
      });
      // A/B body minimal : réécrit le body /reload sortant en ne gardant que MINIMAL_KEEP (fingerprint retiré).
      if (isReload && MINIMAL_BODY) {
        try {
          const full = bodyToBuffer(body);
          if (full && full.length) {
            const min = stripProtobufFields(full, MINIMAL_KEEP);
            log('minimal', `body ${full.length}→${min.length} octets (garde champs ${[...MINIMAL_KEEP].join(',')})`);
            const u = new window.Uint8Array(min.length); u.set(min);
            return sendP.call(this, u.buffer);
          }
        } catch (e) { log('minimal-err', e.message); }
      }
      return sendP.call(this, body);
    };
  }
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url);
      const method = (init && init.method) || 'GET';
      captures.requests.push({ kind: 'fetch', method, url });
      log('fetch', `[${label}] ${method} ${String(url).slice(0, 84)}`);
      if (url && /\/reload\?/.test(url)) onReload(url, init && init.body, captures, `fetch/${label}`);
      return origFetch.call(this, input, init);
    };
  }
  // sendBeacon (au cas où /reload passe par là)
  const nav = window.navigator;
  const origBeacon = nav.sendBeacon && nav.sendBeacon.bind(nav);
  try {
    nav.sendBeacon = function (url, data) {
      captures.requests.push({ kind: 'beacon', url: String(url) });
      if (/\/reload\?/.test(String(url))) onReload(url, data, captures, 'beacon');
      return origBeacon ? origBeacon(url, data) : true;
    };
  } catch (_) {}
}

function toBuffer(body) {
  if (body == null) return null;
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body, 'binary');
  if (body instanceof ArrayBuffer) return Buffer.from(new Uint8Array(body));
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (typeof body.arrayBuffer === 'function') return null; // Blob async — géré ailleurs si besoin
  return null;
}

// bodyToBuffer — normalise le body d'un XHR (string latin1 / ArrayBuffer / TypedArray du realm window) en Buffer Node.
function bodyToBuffer(body) {
  if (body == null) return null;
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body, 'latin1');
  if (typeof body.byteLength === 'number' && body.buffer) {                      // TypedArray / DataView
    return Buffer.from(body.buffer, body.byteOffset || 0, body.byteLength);
  }
  if (typeof body.byteLength === 'number') return Buffer.from(new Uint8Array(body)); // ArrayBuffer
  return null;
}

// stripProtobufFields — parse les champs top-level du protobuf et ne garde QUE ceux de `keep`, en
// conservant les octets EXACTS (tag+len+payload) de chaque champ gardé et leur ordre. Retourne un Buffer.
function stripProtobufFields(buf, keep) {
  const out = [];
  let i = 0;
  const readVarint = () => {
    let shift = 0n, result = 0n;
    while (i < buf.length) { const b = buf[i++]; result |= BigInt(b & 0x7f) << shift; if ((b & 0x80) === 0) break; shift += 7n; }
    return result;
  };
  while (i < buf.length) {
    const start = i;
    const tag = readVarint();
    const field = Number(tag >> 3n), wire = Number(tag & 7n);
    if (wire === 0) readVarint();
    else if (wire === 2) { const len = Number(readVarint()); i += len; }
    else if (wire === 5) i += 4;
    else if (wire === 1) i += 8;
    else break;
    if (keep.has(field)) out.push(buf.slice(start, i));
  }
  return Buffer.concat(out);
}

function onReload(url, body, captures, via, headers) {
  const buf = toBuffer(body);
  if (!buf) { log('reload!', `body /reload capturé via ${via} mais type non-binaire (${typeof body})`); return; }
  captures.reload = { url: String(url), body: buf, via, headers: headers || {} };
  log('reload!', `body /reload CAPTURÉ via ${via} (${buf.length} octets)`);
  if (process.env.RC_VERIFY_BODY === '1') {
    const h = require('crypto').createHash('sha256').update(buf).digest('hex').slice(0, 16);
    log('xhr-body', `/reload CAPTURÉ à l'XHR: ${buf.length} octets sha256=${h}  (comparer avec bridge-body)`);
  }
  try {
    const field16 = pb.extractField16(buf);
    captures.field16 = field16;
    const summary = pb.summarize(buf);
    log('field16', field16 ? `len=${field16.length} : ${field16.slice(0, 48)}…` : '(absent du protobuf)');
    captures.reloadSummary = summary;
    if (DEBUG) {
      log('payload', 'protobuf /reload décodé (' + Object.keys(summary).length + ' champs) :');
      for (const k of Object.keys(summary)) {
        const v = JSON.stringify(summary[k]);
        log('  champ ' + k, v.length > 80 ? v.slice(0, 78) + '…' : v);
      }
    }
  } catch (e) {
    log('decode-err', e.message);
  }
}

// ── Persistance du jar de cookies (accumulation de CONFIANCE, sans navigateur ni hardcode) ──
// Google pose _GRECAPTCHA (Idx 69, « increments the score if valid ») avec une expiration à 6 mois et le
// fait TOURNER à chaque reload. Un vrai navigateur garde ce cookie longtemps → la confiance s'accumule.
// Si on repart d'un jar vide à chaque run, le cookie ne vieillit jamais = confiance 0. On persiste donc le
// jar entre les runs : on ne stocke QUE ce que Google nous donne dynamiquement (pas du hardcode), comme le
// ferait le cookie-store d'un navigateur. RC_NO_COOKIE_PERSIST=1 pour couper. RC_COOKIE_JAR = chemin.
const JAR_FILE = process.env.RC_COOKIE_JAR || path.join(__dirname, 'scripts', 'cookie_jar.json');
function loadCookieJar() {
  try {
    if (process.env.RC_NO_COOKIE_PERSIST !== '1' && fs.existsSync(JAR_FILE)) {
      const jar = CookieJar.deserializeSync(fs.readFileSync(JAR_FILE, 'utf8'));
      return jar;
    }
  } catch (_) {}
  return new CookieJar();
}
function saveCookieJar(jar) {
  try {
    if (process.env.RC_NO_COOKIE_PERSIST === '1' || !jar || !jar.serializeSync) return;
    fs.writeFileSync(JAR_FILE, JSON.stringify(jar.serializeSync()));
  } catch (_) {}
}

/**
 * run(opts) — exécute le harnais et renvoie { token, field16, reloadStatus, accepted, ... }.
 * opts (tous optionnels) : { siteKey, origin, action, hl, timeout, quiet, probe,
 *                            chromeVersion, platform, apiKey }
 * Réutilisable comme module : const { run } = require('./field16_jsdom').
 */
async function run(opts = {}) {
  if (opts.siteKey)  SITE_KEY = opts.siteKey;
  if (opts.origin)   ORIGIN   = opts.origin;
  if (opts.eventId)  EVENT_ID = opts.eventId;
  if (opts.pageUrl)  PAGE_URL = opts.pageUrl;
  if (opts.executeTimes)  EXECUTE_TIMES  = opts.executeTimes;
  if (opts.executeGapMs !== undefined) EXECUTE_GAP_MS = opts.executeGapMs;
  if (opts.mouse !== undefined) MOUSE = opts.mouse;   // antcpt : OFF (le vrai body a champ 25 = [] vide)
  if (opts.action)   ACTION   = opts.action;
  if (opts.hl)       HL       = opts.hl;
  if (opts.mode)     MODE     = opts.mode;
  if (opts.proxy)  { PROXY = parseProxy(opts.proxy); PROXY_DISPATCHER = null; }
  if (opts.timeout)  TIMEOUT  = opts.timeout;
  if (opts.quiet !== undefined) QUIET = opts.quiet;
  if (opts.probe !== undefined) PROBE = opts.probe;
  if (opts.debug) { DEBUG = true; QUIET = false; }   // debug force la verbosité maximale
  if (opts.chromeVersion || opts.platform || opts.apiKey) {
    IDENTITY = xbv.browserIdentity({ version: opts.chromeVersion, platform: opts.platform, apiKey: opts.apiKey });
    CHROME_HEADERS = xbv.chromeHeaders(IDENTITY);
  }

  if (opts.tls !== undefined) TLS_CHROME = opts.tls;
  if (opts.tlsClient) TLS_CID = opts.tlsClient;

  // Re-télécharge le vrai recaptcha__<hl>.js frais À CHAQUE RUN (le cache disque est écrasé).
  // RC_NO_FETCH=1 pour réutiliser le cache existant (offline / debug rapide).
  if (process.env.RC_NO_FETCH !== '1') {
    try {
      const { fetchScripts } = require('./tools/fetch_scripts');
      const m = await fetchScripts({ quiet: true });
      log('fetch', `recaptcha__${m.hl}.js re-téléchargé (version=${m.version}, ${m.scriptBytes}B)`);
    } catch (e) { log('fetch-err', `re-download KO: ${e.message} (fallback cache existant)`); }
  }

  const cache = loadCache();
  log('cache', `version=${cache.meta.version} hl=${cache.meta.hl} main=${cache.meta.scriptBytes}B`);

  // Pont TLS Chrome : démarre le proxy local MITM (jsdom + nos fetch sortent en JA3/JA4+H2 Chrome).
  if (TLS_CHROME) {
    try {
      const ch = CHROME_HEADERS || {};
      const bridgeIdentity = {
        major: IDENTITY.major, platform: IDENTITY.platform, userAgent: IDENTITY.userAgent,
        secChUa: ch['sec-ch-ua'], secChUaPlatform: ch['sec-ch-ua-platform'],
        // x-browser-* injectés sur les requêtes Google si RC_XBV_INJECT=1 (vrai Chrome les envoie)
        xBrowser: INJECT_XBV ? {
          'x-browser-channel': ch['X-Browser-Channel'],
          'x-browser-copyright': ch['X-Browser-Copyright'],
          'x-browser-year': ch['X-Browser-Year'],
          'x-browser-validation': process.env.RC_XBV_OVERRIDE || ch['X-Browser-Validation'],
        } : null,
      };
      const acceptLanguage = `${HL}-${HL.toUpperCase()},${HL};q=0.9,en-US;q=0.8,en;q=0.7`;
      BRIDGE = await tlsBridge.startBridge({ proxy: PROXY, clientIdentifier: TLS_CID, identity: bridgeIdentity, acceptLanguage, log });
      log('tls', `client Chrome ${TLS_CID} actif (JA4 t13d1517h2…dcad5a053991 + H2 Chrome, UA v${IDENTITY.major}, ${HL}-${HL.toUpperCase()}) — trafic via ${BRIDGE.url}`);
    } catch (e) { log('tls-err', `pont TLS KO: ${e.message} (fallback Node TLS)`); BRIDGE = null; }
  }

  // Vérif IP de sortie (celle que Google verra sur /reload → détermine le score)
  if (PROXY || BRIDGE) {
    try {
      const ipr = await netGet('https://api.ipify.org?format=json', { 'User-Agent': IDENTITY.userAgent });
      const ipj = await ipr.json();
      log('proxy', `IP de sortie = ${ipj.ip}${BRIDGE ? ' (via TLS Chrome)' : ''}${PROXY ? ' [résidentiel]' : ''}`);
    } catch (e) { log('proxy-err', `IP check KO: ${e.message} (on continue)`); }
  } else {
    log('proxy', 'aucun (IP directe/datacenter — score plafonné)');
  }

  const worker = await prefetchWorker(cache.meta.version, cache.meta.hl);

  const captures = { requests: [], field16: null, reload: null };

  const vconsole = new VirtualConsole();
  vconsole.on('jsdomError', e => {
    const msg = (e && (e.detail || e.message || e)) + '';
    log('jsdomError', msg.slice(0, 140));
    if (DEBUG && e && e.detail && e.detail.stack) log('  stack', String(e.detail.stack).split('\n').slice(0, 3).join(' | ').slice(0, 200));
  });
  if (DEBUG) ['log', 'info', 'warn', 'error'].forEach(m =>
    vconsole.on(m, (...a) => log('page.' + m, a.map(x => { try { return typeof x === 'string' ? x : JSON.stringify(x); } catch (_) { return String(x); } }).join(' ').slice(0, 160))));

  // Page réaliste type event Ticketmaster (signaux Idx 16 head, 57 scripts, 62 title, 70 total…).
  // Les <script src> tiers sont des LEURRES : présents dans document.scripts (Idx 57) mais court-circuités
  // à vide par makeLoader (pas de vrai fetch). Surchargeable via opts.pageHtml.
  // Page réelle « Let's Get Your Identity Verified » (la vraie page anti-bot Ticketmaster qui
  // sert le reCAPTCHA action=identify). Matcher exactement la page où le token est réellement émis
  // rend le fingerprint (title Idx 62, scripts Idx 57, structure DOM) cohérent avec le vrai contexte.
  const html = opts.pageHtml || `<!doctype html>
<html>

<head>
    <noscript>
        <link rel="stylesheet" type="text/css" charset="utf-8" href="/epsf/asset/tm.css" />
        <title>Let's Get Your Identity Verified</title>
        <div class="container">
            <div class="box">
                <div class="c1">Let's Get Your Identity Verified</div>
                <div class="c2">
                    Your browser hit a snag and we need to make sure you're
                    not a bot. There are a couple of reasons why this may
                    have happened:
                </div>
                <ul class="c3">
                    <li>
                        You were browsing too quickly for our site to catch
                        up.
                    </li>
                    <li>You disabled your cookies.</li>
                    <li>
                        A third-party browser plugin, such as Ghostery or
                        NoScript, is preventing Javascript from running.
                    </li>
                </ul>
                <div class="c4">
                    To stay on track, please make sure your cookies and
                    JavaScript are enabled, then go ahead and reload your
                    screen to continue using our site.
                </div>
            </div>
            <div class="box2">
                <div class="c5">cfee81aa-7475-4653-9b66-8499f5077548</div>
                <div data-cs-mask class="c6">88.183.171.198</div>
            </div>
        </div>
    </noscript>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex, nofollow" />
    <meta http-equiv="cache-control" content="no-cache, no-store, must-revalidate" />
    <meta http-equiv="pragma" content="no-cache" />
    <meta http-equiv="expires" content="0" />
    <script>
        function showBlockPage() {
                document.title = "Your Browsing Activity Has Been Paused";
            }
            setTimeout(showBlockPage, 10000);
    </script>
    <script>
        var tc = "tm" == "ln" ? { "en-us": "en" } : "";
            var al = "";
            var rid = "cfee81aa-7475-4653-9b66-8499f5077548";
            var ip = "88.183.171.198";
            var rr = "";
            var host = "www.ticketmaster.com";
            var action = "identify";
            var tg = "";
            var ss = "tm.css";
            var epsPageName = "Event";
            var path = window.location.pathname;
            var search = window.location.search;
            var umbrella = true;
            var brand = "tm";
            function isWidget(uri, parms) {
                return (
                    uri != undefined &&
                    uri.indexOf("authorization.oauth2") != -1 &&
                    parms != undefined &&
                    parms.indexOf("placementId") != -1
                );
            }
            function getWidgetModeHeader(uri, parameters) {
                if (isWidget(uri, parameters)) {
                    var w = document.createElement("script");
                    w.src = "";
                    w.charset = "utf-8";
                    document.head.appendChild(w);
                    var cs = document.createElement("link");
                    cs.setAttribute("type", "text/css");
                    cs.setAttribute("href", "");
                    cs.setAttribute("rel", "stylesheet");
                    document.head.appendChild(cs);
                }
            }
            getWidgetModeHeader(path, search);
    </script>
    <script>
        function preloadAsset(path, asType) {
                if (path && window.epsfBase) {
                    const link = document.createElement("link");
                    link.rel = "preload";
                    link.as = asType;
                    link.href = window.epsfBase + path;
                    link.crossOrigin = "anonymous";
                    document.head.appendChild(link);
                }
            }

            // Preload translation JSON
            if (window.action && window.action.trim()) {
                preloadAsset("/asset/" + window.action + ".json", "fetch");
            }

            // Preload brand CSS
            if (window.brand && window.brand.trim()) {
                preloadAsset("/asset/" + window.brand + ".css", "style");
            }
    </script>

    <script type='text/javascript' src='/eps-mgr' async defer></script>
    <script type='text/javascript' charset='utf-8' src='/epsf/asset/shared.js'></script>
</head>

<body onload="load('',false)">
    <div class="container">
        <div>
            <div class="bg"></div>
            <div class="lg"></div>
        </div>
        <div id="boxes_container">
            <div class="box">
                <div class="c1" id="t1"></div>
                <div class="c2" id="t2"></div>
                <ul class="c3" id="t3"></ul>
                <div class="c4" id="t4"></div>
            </div>
            <div class="be" id="be"></div>
            <div class="box2">
                <div class="c5" id="t5"></div>
                <div data-cs-mask class="c6" id="t6"></div>
            </div>
        </div>
    </div>

    <abuse-component ip="88.183.171.198" rid="cfee81aa-7475-4653-9b66-8499f5077548" action="identify" dbp-with-signin=""
        reload="true"></abuse-component>

</body>

</html>`;

  const pageUrl = opts.pageUrl || PAGE_URL || (ORIGIN + '/event/' + EVENT_ID);
  log('page', `URL vue par la VM = ${pageUrl}  (domain=${new URL(pageUrl).host})`);
  const cookieJar = loadCookieJar();   // jar PERSISTANT → _GRECAPTCHA vieillit entre les runs (confiance)
  const dom = new JSDOM(html, {
    url: pageUrl,
    referrer: ORIGIN + '/',
    contentType: 'text/html',
    runScripts: 'dangerously',
    resources: makeLoader(cache, captures),
    cookieJar,
    pretendToBeVisual: true,
    virtualConsole: vconsole,
  });
  const { window } = dom;
  if (global.__cc) { try { window.__cc = global.__cc; } catch (_) {} }   // canal capture cipher (RC_CIPHER_CAP)
  if (global.__cc2) { try { window.__cc2 = global.__cc2; } catch (_) {} } // canal capture hashString

  // rc::a (Idx 4) + localStorage réaliste (Idx 5 length, Idx 58 clé échantillonnée)
  try {
    const ls = window.localStorage;
    ls.setItem('rc::a', Buffer.from('khr51n4286p7').toString('base64'));
    ls.setItem('_gcl_au', '1.1.354395113.1778502448');
    ls.setItem('_ga', 'GA1.1.354395113.1778502448');
    ls.setItem('tmui', JSON.stringify({ v: 3, ts: Date.now() }));
    ls.setItem('mapslitepromosdismissed1', 'true');
    ls.setItem('bm_sv', '9F7A1C2E');
    ls.setItem('edgeChannel', 'prod');
    ls.setItem('AMCV_TM', '1099438348%7CMCMID%7C123');
    ls.setItem('__tm_referrer', ORIGIN + '/');
  } catch (_) {}
  // cookies (Idx 31 keys, Idx 63 epoch ids, Idx 69 human-token, Idx 78 GA)
  try {
    const d = window.document;
    d.cookie = '_ga=GA1.1.354395113.1778502448';
    d.cookie = '_gid=GA1.1.998877665.1782900000';
    d.cookie = '_gcl_au=1.1.354395113.1778502448';
    d.cookie = 'eps_sid=' + Buffer.from(String(Date.now())).toString('hex').slice(0, 16);
    d.cookie = 'session=1778502450481';
    d.cookie = 'TapAd_DID=1782900000123';
  } catch (_) {}

  captures.frames = new Set();
  attach(window, captures, cache, worker, 'main');

  // Injecte le loader frais (enterprise.js|api.js) pour CETTE clé/mode ; il insérera
  // <script src=…recaptcha__*.js> → servi par le cache.
  const loaderSrc = await fetchLoader(SITE_KEY);
  log('inject', `${modeInfo().loader} (loader, mode=${MODE})`);
  const s = window.document.createElement('script');
  s.textContent = loaderSrc;
  window.document.head.appendChild(s);

  // Attendre que grecaptcha[.enterprise] soit prêt, puis execute()
  const grec = () => modeInfo().grec(window);
  const grecaptchaReady = () => { const g = grec(); return g && typeof g.execute === 'function'; };

  const deadline = Date.now() + TIMEOUT;
  await new Promise((resolve) => {
    const tick = setInterval(() => {
      // fini quand la séquence de N execute() est terminée (dernier token capturé), ou timeout
      if (captures.__allDone || Date.now() > deadline) { clearInterval(tick); return resolve(); }
      if (!PROBE && !captures.__executed && grecaptchaReady()) {
        captures.__executed = true;
        const g = grec();
        // Un execute() = un /reload → un token frais. On en enchaîne EXECUTE_TIMES dans la MÊME
        // session : le 1er est « froid » (score bas), les suivants réchauffent le score. Dernier gardé.
        const doExecute = (n) => new Promise((res) => {
          log('execute', `#${n}/${EXECUTE_TIMES} grecaptcha${MODE === 'standard' ? '' : '.enterprise'}.execute(${SITE_KEY.slice(0, 12)}…, {action:'${ACTION}'})`);
          try {
            g.ready(() => {
              Promise.resolve(g.execute(SITE_KEY, { action: ACTION }))
                .then(tok => { captures.token = tok; captures.tokenCount = (captures.tokenCount || 0) + 1; log('token', `#${n} ` + String(tok).slice(0, 40) + '…'); res(tok); })
                .catch(e => { log('execute-err', e.message); res(null); });
            });
          } catch (e) { log('execute-err', e.message); res(null); }
        });
        (async () => {
          // Warm-up : fait « vivre » la page (temps + événements non-pointeur : scroll/focus/visibility/rAF)
          // pour accumuler des samples timing/événements dans le champ 20, SANS toucher le champ 25 (souris).
          if (PRE_EXECUTE_MS > 0) {
            try { await sessionWarmup(window, PRE_EXECUTE_MS); log('warmup', `${PRE_EXECUTE_MS}ms d'activité pré-execute (champ 20)`); }
            catch (e) { log('warmup-err', e.message); }
          }
          if (MOUSE) {
            try { const c = await simulateMouse(window, MOUSE_MS); log('mouse', `${c} pointermove simulés (champ 25)`); }
            catch (e) { log('mouse-err', e.message); }
          }
          for (let n = 1; n <= EXECUTE_TIMES; n++) {
            await doExecute(n);
            if (n < EXECUTE_TIMES && Date.now() < deadline - EXECUTE_GAP_MS - 1000) {
              // réchauffe : bouge la souris + laisse passer du temps (accumule signaux avant le reload suivant)
              if (MOUSE) { try { await simulateMouse(window, Math.max(500, Math.floor(MOUSE_MS / 2))); } catch (_) {} }
              await new Promise(r => setTimeout(r, EXECUTE_GAP_MS));
            }
          }
          // petite grâce pour laisser remonter le dernier rresp si execute() a résolu avant le reload-resp
          await new Promise(r => setTimeout(r, 800));
          captures.__allDone = true;
        })();
      }
    }, 200);
  });

  // ---- #2 : rejouer le /reload via un VRAI Chrome (TLS/H2 authentique) --------------------
  // Le token jsdom part via node-tls-client (détecté). Avec RC_RELOAD_CHROME=1, on rejoue le body
  // capturé dans un Chrome headless → le handshake scoré par Google est celui de Chrome.
  if (process.env.RC_RELOAD_CHROME === '1' && captures.reload && captures.reload.body) {
    try {
      const { reloadViaChrome, closeBrowser } = require('./tools/chrome_reload');
      log('chrome', 'replay /reload via vrai Chrome (TLS authentique)…');
      const cr = await reloadViaChrome({
        url: captures.reload.url, body: captures.reload.body, headers: captures.reload.headers,
        sitekey: SITE_KEY, hl: HL, version: cache.meta.version, proxy: opts.proxy || process.env.RC_PROXY,
        userAgent: IDENTITY.userAgent, log,
      });
      captures.reloadResponseChrome = { status: cr.status, len: (cr.text || '').length };
      if (cr.token) { captures.tokenChrome = cr.token; captures.token = cr.token; log('token-chrome', cr.token.slice(0, 40) + '… (scoré via Chrome TLS)'); }
      if (process.env.RC_RELOAD_CHROME_KEEP !== '1') await closeBrowser();
    } catch (e) { log('chrome-err', e.message); }
  }

  const accepted = !!((captures.reloadResponse && captures.reloadResponse.status === 200) ||
                      (captures.reloadResponseChrome && captures.reloadResponseChrome.status === 200));

  // Toujours sauver le dernier résultat (pour verify_token.js, debug, etc.)
  if (captures.field16) {
    try {
      fs.writeFileSync(path.join(__dirname, 'scripts', 'last_field16.json'), JSON.stringify({
        token: captures.token || null, field16: captures.field16,
        siteKey: SITE_KEY, action: ACTION, origin: ORIGIN,
        reloadSummary: captures.reloadSummary || null,
        reloadResponse: captures.reloadResponse || null,
        when: new Date(deadline - TIMEOUT).toISOString(),
      }, null, 2));
    } catch (_) {}
  }

  // ---- Rapport (silencieux si quiet) ------------------------------------
  if (!QUIET) {
    console.log('\n══════════════════ RÉSULTAT ══════════════════');
    console.log('identité                   : Chrome ' + IDENTITY.major + ' / ' + IDENTITY.platform +
                '  X-Browser-Validation=' + IDENTITY.xBrowserValidation);
    console.log('grecaptcha.enterprise prêt :', grecaptchaReady());
    if (captures.field16) {
      console.log('\n✔ CHAMP 16 GÉNÉRÉ (' + captures.field16.length + ' chars) :');
      console.log('  ' + captures.field16.slice(0, 180) + '…  [complet → scripts/last_field16.json]');
      if (captures.reloadSummary) {
        console.log('\n  protobuf /reload :');
        for (const k of Object.keys(captures.reloadSummary)) {
          const v = JSON.stringify(captures.reloadSummary[k]);
          console.log(`    [${k}] ${v.length > 64 ? v.slice(0, 62) + '…' : v}`);
        }
      }
      console.log('\n  /reload          : HTTP ' + (captures.reloadResponse ? captures.reloadResponse.status : '—') +
                  (accepted ? '  ✔ accepté par Google' : ''));
      console.log('  token v3 (rresp) : ' + (captures.token ? String(captures.token).slice(0, 40) + '…' : '—'));
      console.log('  (sauvé dans scripts/last_field16.json)');
    } else {
      console.log('\n✖ Champ 16 non capturé — le script n\'a pas atteint le POST /reload sous jsdom.');
    }
    console.log('══════════════════════════════════════════════');
  }

  // Persiste le jar (avec le _GRECAPTCHA le plus frais que Google vient de faire tourner) pour le prochain run.
  saveCookieJar(cookieJar);
  // RC_COV : dump de la couverture de fonctions (main + worker fusionnés) pour la réduction v3-only.
  if (process.env.RC_COV) {
    try {
      const set = new Set([...(window.__COVSET || []), ...((global.__RC_WORKER_COV) || [])]);
      // union avec l'existant → accumulation robuste sur plusieurs runs
      try { if (fs.existsSync(process.env.RC_COV)) for (const x of JSON.parse(fs.readFileSync(process.env.RC_COV, 'utf8'))) set.add(x); } catch (_) {}
      fs.writeFileSync(process.env.RC_COV, JSON.stringify([...set]));
      log('coverage', `${set.size} fonctions couvertes (cumul) → ${process.env.RC_COV}`);
    } catch (e) { log('cov-err', e.message); }
  }
  // RC_TOKGEN : révèle la fonction qui a assemblé le token de repli (+ stack) — cf. tools/trace_token.js
  if (process.env.RC_TOKGEN) {
    try {
      const tg = window.__TOKGEN || global.__RC_WORKER_TOKGEN;
      if (tg) { log('TOKGEN', `assemblé par ${tg.fn}`); console.error('STACK:\n' + String(tg.stack).split('\n').slice(0, 12).join('\n')); }
      else log('TOKGEN', 'non capturé (ni window ni worker)');
    } catch (e) { log('tokgen-err', e.message); }
  }
  // RC_HFDUMP : dump du plaintext (E.CE()) + clé du token de repli HF, capturés par fn_L_44 instrumenté.
  if (process.env.RC_HFDUMP) {
    try {
      const hd = window.__HFDUMP;
      if (hd) {
        const toHex = s => Buffer.from(Array.from(String(s), c => c.charCodeAt(0) & 0xff)).toString('hex');
        const out = { key: String(hd.k), keyLen: String(hd.k).length, keyHex: toHex(hd.k),
          plainLen: String(hd.p).length, plainHex: toHex(hd.p), token: hd.t || null };
        fs.writeFileSync(process.env.RC_HFDUMP, JSON.stringify(out, null, 2));
        log('HFDUMP', `plaintext ${out.plainLen}B, key(${out.keyLen})="${out.key}" → ${process.env.RC_HFDUMP}`);
      } else log('HFDUMP', 'window.__HFDUMP absent (pas de branche HF exécutée)');
    } catch (e) { log('hfdump-err', e.message); }
  }
  try { window.close(); } catch (_) {}
  if (BRIDGE) { try { await BRIDGE.close(); } catch (_) {} BRIDGE = null; }
  return {
    token: captures.token || null,
    field16: captures.field16 || null,
    reloadStatus: captures.reloadResponse ? captures.reloadResponse.status : null,
    reloadResponse: captures.reloadResponse || null,
    reloadSummary: captures.reloadSummary || null,
    accepted,
    identity: { major: IDENTITY.major, platform: IDENTITY.platform, xBrowserValidation: IDENTITY.xBrowserValidation },
  };
}

module.exports = { run };

if (require.main === module) {
  run().then(r => process.exit(r && r.field16 ? 0 : 2))
       .catch(e => { console.error('FATAL', e); process.exit(1); });
}
