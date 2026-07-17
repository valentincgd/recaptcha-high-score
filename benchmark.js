'use strict';
/**
 * benchmark.js — HEADLESS patché : pour CHAQUE token → tmpt → requête event → status.
 * Tableau récap à la fin (taux de succès 200). Objectif : voir si un headless patché passe.
 *
 * Patches anti-détection headless :
 *   - puppeteer-extra-plugin-stealth
 *   - vrai GPU/WebGL (--use-angle=d3d11) : headless tombe sinon sur "SwiftShader" (flag bot, Key 1310)
 *   - flags AutomationControlled off, window 1920x1080, spoof WebGL renderer si SwiftShader
 *
 * Usage :
 *   node benchmark.js                       # 20 essais, 4 pages
 *   ITERATIONS=50 CONCURRENCY=6 node benchmark.js
 *   HEADFUL=1 node benchmark.js             # comparer en headful
 *   RC_PROXY=host:port:user:pass node benchmark.js
 *
 * ⚠️ RECHERCHE / ÉDUCATIF.
 */
const puppeteer = require('puppeteer-extra');
const Stealth = require('puppeteer-extra-plugin-stealth');
puppeteer.use(Stealth());

const SITE_KEY = process.env.RC_SITEKEY || '6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV';
const ORIGIN   = 'https://www.ticketmaster.com';
const ACTION   = process.env.RC_ACTION || 'Event';
const EVENT_ID = process.env.TM_EVENT_ID || '1600647921872DC4';
const EVENT_URL = `${ORIGIN}/event/${EVENT_ID}`;
const ITERATIONS = +process.env.ITERATIONS || 20;
const CONCURRENCY = +process.env.CONCURRENCY || 4;
// MODE: 'headless' (patché, défaut) | 'headful' (visible) | 'hidden' (headful hors-écran = invisible mais passe)
const MODE = process.env.MODE || (process.env.HEADFUL === '1' ? 'headful' : 'headless');

const INJECT_URL = ORIGIN + '/__rc_bench__';
const INJECT_HTML = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Ticketmaster</title>
<script src="https://www.google.com/recaptcha/enterprise.js?render=${SITE_KEY}"></script>
</head><body><div id="app"></div></body></html>`;

// Patch injecté avant tout script de page : masque les tells headless restants.
const PATCH = `(() => {
  try {
    // WebGL : si SwiftShader (headless), rendre un vrai GPU (Key 1310 = vendor/renderer/#ext)
    const RE = { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)' };
    for (const proto of [self.WebGLRenderingContext && WebGLRenderingContext.prototype, self.WebGL2RenderingContext && WebGL2RenderingContext.prototype]) {
      if (!proto) continue;
      const gp = proto.getParameter;
      proto.getParameter = function (p) {
        if (p === 37445) return RE.vendor;        // UNMASKED_VENDOR_WEBGL
        if (p === 37446) return RE.renderer;       // UNMASKED_RENDERER_WEBGL
        return gp.apply(this, arguments);
      };
    }
    // navigator hardening (compléments au stealth)
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });

    // outerWidth/outerHeight = 0 en headless = TELL fort → aligner sur inner + chrome
    try {
      Object.defineProperty(window, 'outerWidth', { get: () => window.innerWidth });
      Object.defineProperty(window, 'outerHeight', { get: () => window.innerHeight + 88 });
      Object.defineProperty(window, 'screenX', { get: () => 0 });
      Object.defineProperty(window, 'screenY', { get: () => 0 });
    } catch (e) {}

    // focus / visibilité : headless n'a jamais le focus → reCAPTCHA le voit
    try {
      Object.defineProperty(document, 'hasFocus', { value: () => true });
      Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
      Object.defineProperty(document, 'hidden', { get: () => false });
      Object.defineProperty(document, 'webkitVisibilityState', { get: () => 'visible' });
    } catch (e) {}

    // Notification.permission = 'denied' par défaut en headless (réel = 'default')
    try {
      const ON = window.Notification;
      if (ON && ON.permission === 'denied') Object.defineProperty(ON, 'permission', { get: () => 'default' });
      if (navigator.permissions && navigator.permissions.query) {
        const q = navigator.permissions.query.bind(navigator.permissions);
        navigator.permissions.query = (p) => p && p.name === 'notifications'
          ? Promise.resolve({ state: 'prompt', onchange: null }) : q(p);
      }
    } catch (e) {}

    // window.chrome complet (runtime/csi/loadTimes) — un vrai Chrome les a
    try {
      window.chrome = window.chrome || {};
      window.chrome.runtime = window.chrome.runtime || {};
      if (!window.chrome.csi) window.chrome.csi = function () { return { startE: Date.now(), onloadT: Date.now(), pageT: 1000, tran: 15 }; };
      if (!window.chrome.loadTimes) window.chrome.loadTimes = function () { return { requestTime: Date.now() / 1000, finishLoadTime: Date.now() / 1000 }; };
      window.chrome.app = window.chrome.app || { isInstalled: false, InstallState: { DISABLED: 'disabled' }, RunningState: { RUNNING: 'running' } };
    } catch (e) {}
  } catch (e) {}
})();`;

function parseProxy(raw) {
  if (!raw) return null; raw = String(raw).trim();
  if (/^[a-z0-9]+:\/\//i.test(raw)) { const u = new URL(raw); return { server: `${u.protocol}//${u.host}`, username: decodeURIComponent(u.username || ''), password: decodeURIComponent(u.password || '') }; }
  const p = raw.split(':');
  if (p.length === 4) return { server: `http://${p[0]}:${p[1]}`, username: p[2], password: p[3] };
  if (p.length === 2) return { server: `http://${p[0]}:${p[1]}`, username: '', password: '' };
  return null;
}

async function newPage(browser, proxy) {
  const page = await browser.newPage();
  if (proxy && proxy.username) await page.authenticate({ username: proxy.username, password: proxy.password });
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  // Focus emulation : fait croire à la page qu'elle a le focus (headless ne l'a jamais)
  try {
    const cdp = await page.target().createCDPSession();
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await cdp.send('Page.enable').catch(() => {});
  } catch (_) {}
  await page.evaluateOnNewDocument(PATCH);
  await page.setRequestInterception(true);
  page.on('request', r => { if (r.url().startsWith(INJECT_URL)) r.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: INJECT_HTML }); else r.continue(); });
  await page.goto(INJECT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => new Promise(res => { const iv = setInterval(() => { if (window.grecaptcha && window.grecaptcha.enterprise) { clearInterval(iv); window.grecaptcha.enterprise.ready(res); } }, 80); }));
  return page;
}

// une itération complète : token → eps-mgr → verify(tmpt) → event → status
async function oneShot(page) {
  return page.evaluate(async (o) => {
    const t0 = Date.now();
    let token = null, postStatus = 0, eventStatus = 0, botwall = false, err = null, tmpt = false;
    try {
      token = await window.grecaptcha.enterprise.execute(o.SITE_KEY, { action: o.ACTION });
      await fetch(o.ORIGIN + '/eps-mgr', { credentials: 'include', headers: { accept: '*/*' } });
      const pr = await fetch(o.ORIGIN + '/epsf/gec/v3/Event', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json', accept: '*/*' }, body: JSON.stringify({ hostname: 'www.ticketmaster.com', key: o.SITE_KEY, token }) });
      postStatus = pr.status;
      const sc = pr.headers.get('set-cookie') || '';
      tmpt = /tmpt/i.test(sc) || pr.status === 200;
      const ev = await fetch(o.EVENT_URL, { credentials: 'include', headers: { accept: 'text/html' } });
      eventStatus = ev.status;
      const body = await ev.text();
      botwall = /identity verified|not a bot|make sure you're not/i.test(body);
    } catch (e) { err = String(e.message || e).slice(0, 40); }
    return { tokenLen: token ? token.length : 0, postStatus, eventStatus, botwall, err, ms: Date.now() - t0 };
  }, { SITE_KEY, ACTION, ORIGIN, EVENT_URL });
}

(async () => {
  const PROXY = parseProxy(process.env.RC_PROXY);
  console.log('══════════════════════════════════════════════════════');
  console.log(` BENCHMARK — mode ${MODE.toUpperCase()}  ·  ${ITERATIONS} essais  ·  ${CONCURRENCY} pages`);
  console.log(`  proxy : ${PROXY ? PROXY.server : 'IP locale'}`);
  console.log('══════════════════════════════════════════════════════');

  const args = ['--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check',
    '--window-size=1920,1080', '--disable-features=IsolateOrigins,site-per-process',
    '--use-angle=d3d11', '--use-gl=angle', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-webgl',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'];
  if (MODE === 'hidden') args.push('--window-position=-32000,-32000');   // hors-écran = invisible
  if (PROXY) args.push(`--proxy-server=${PROXY.server}`);
  const opts = { headless: MODE === 'headless' ? 'new' : false, args, ignoreDefaultArgs: ['--enable-automation'] };
  if (process.env.CHROME_PATH) opts.executablePath = process.env.CHROME_PATH; else opts.channel = 'chrome';

  let browser;
  try { browser = await puppeteer.launch(opts); } catch (e) { console.error('✖ Chrome KO:', e.message); process.exit(1); }

  let pages;
  try { pages = await Promise.all(Array.from({ length: CONCURRENCY }, () => newPage(browser, PROXY))); }
  catch (e) { console.error('✖ init pages:', e.message); await browser.close(); process.exit(1); }

  // diagnostic WebGL réel (headless SwiftShader ?)
  try {
    const gl = await pages[0].evaluate(() => { const c = document.createElement('canvas').getContext('webgl'); const d = c.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'n/a'; });
    console.log(`  WebGL renderer : ${gl}\n`);
  } catch (_) {}

  const results = [];
  let next = 0;
  const worker = async (page) => { while (next < ITERATIONS) { const i = next++; process.stderr.write(`\r  essai ${i + 1}/${ITERATIONS}…   `); const r = await oneShot(page); results.push({ i: i + 1, ...r }); } };
  await Promise.all(pages.map(p => worker(p)));
  try { await browser.close(); } catch (_) {}

  // ── TABLEAU ──
  console.log('\n');
  console.log('  #   token  POST  event  verdict         ms');
  console.log('  ─── ────── ───── ────── ─────────────── ─────');
  let ok = 0;
  for (const r of results.sort((a, b) => a.i - b.i)) {
    const pass = r.eventStatus === 200 && !r.botwall;
    if (pass) ok++;
    const verdict = r.err ? 'ERR ' + r.err : (pass ? '✔ 200 OK' : (r.botwall ? '✖ bot-wall' : '✖ ' + r.eventStatus));
    console.log(`  ${String(r.i).padStart(3)} ${String(r.tokenLen || '-').padStart(6)} ${String(r.postStatus).padStart(5)} ${String(r.eventStatus).padStart(6)} ${verdict.padEnd(15)} ${String(r.ms).padStart(5)}`);
  }
  console.log('  ─────────────────────────────────────────────────');
  const rate = (ok / results.length * 100).toFixed(0);
  console.log(`  SUCCÈS (event 200) : ${ok}/${results.length}  (${rate}%)   mode: ${MODE}`);
  console.log('══════════════════════════════════════════════════════');
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
