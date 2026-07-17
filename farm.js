'use strict';
/**
 * farm.js — Ferme de tokens reCAPTCHA v3 Enterprise HAUT SCORE.
 *
 * Vrai Chrome headful (seul à passer le seuil de score, cf. mesures), mais un POOL de pages
 * qui appellent grecaptcha.enterprise.execute() EN BOUCLE → plusieurs tokens/s sans relancer
 * de navigateur. Débit réaliste (dizaines/s selon machine + IP), pas 10k/s (impossible haut-score).
 *
 * Usage :
 *   node farm.js                          # mesure le débit (headful) pendant DURATION s
 *   CONCURRENCY=8 DURATION=20 node farm.js
 *   RC_PROXY=host:port:user:pass node farm.js
 *   OUT=tokens.txt node farm.js           # écrit les tokens dans un fichier
 *
 * ⚠️ RECHERCHE / ÉDUCATIF.
 */
const fs = require('fs');
const puppeteer = require('puppeteer-extra');
const Stealth = require('puppeteer-extra-plugin-stealth');
puppeteer.use(Stealth());

const SITE_KEY = process.env.RC_SITEKEY || '6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV';
const ORIGIN   = process.env.RC_ORIGIN || 'https://www.ticketmaster.com';
const ACTION   = process.env.RC_ACTION || 'Event';
const CONCURRENCY = +process.env.CONCURRENCY || 6; // pages TOTAL
const BROWSERS = +process.env.BROWSERS || 1;       // instances Chrome (répartir la charge CPU)
const DURATION = +process.env.DURATION || 15;         // secondes de mesure (0 = infini)
const TARGET = +process.env.TARGET || 0;              // objectif tok/s (affiché)
// MODE: 'hidden' (headful hors-écran = invisible + bon score, RECOMMANDÉ) | 'headful' (visible) | 'headless' (score 0%)
const MODE = process.env.MODE || (process.env.HEADLESS === '1' ? 'headless' : 'hidden');
const OUT = process.env.OUT || null;

const INJECT_URL = ORIGIN + '/__rc_farm__';
const INJECT_HTML = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>tm</title>
<script src="https://www.google.com/recaptcha/enterprise.js?render=${SITE_KEY}"></script>
</head><body><div id="app"></div></body></html>`;

function parseProxy(raw) {
  if (!raw) return null;
  raw = String(raw).trim();
  if (/^[a-z0-9]+:\/\//i.test(raw)) { const u = new URL(raw); return { server: `${u.protocol}//${u.host}`, username: decodeURIComponent(u.username || ''), password: decodeURIComponent(u.password || '') }; }
  const p = raw.split(':');
  if (p.length === 4) return { server: `http://${p[0]}:${p[1]}`, username: p[2], password: p[3] };
  if (p.length === 2) return { server: `http://${p[0]}:${p[1]}`, username: '', password: '' };
  return null;
}

async function newWorkerPage(browser, proxy) {
  const page = await browser.newPage();
  if (proxy && proxy.username) await page.authenticate({ username: proxy.username, password: proxy.password });
  await page.setRequestInterception(true);
  page.on('request', r => {
    if (r.url().startsWith(INJECT_URL)) r.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: INJECT_HTML });
    else r.continue();
  });
  await page.goto(INJECT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => new Promise(res => {
    const iv = setInterval(() => {
      if (window.grecaptcha && window.grecaptcha.enterprise) { clearInterval(iv); window.grecaptcha.enterprise.ready(res); }
    }, 80);
  }));
  return page;
}

(async () => {
  const PROXY = parseProxy(process.env.RC_PROXY);
  console.log('══════════════════════════════════════════════');
  console.log(' FERME DE TOKENS — vrai Chrome headful (pool)');
  console.log('══════════════════════════════════════════════');
  console.log(`  sitekey     : ${SITE_KEY}`);
  console.log(`  action      : ${ACTION}   origin : ${ORIGIN}`);
  console.log(`  pages TOTAL : ${CONCURRENCY}   navigateurs : ${BROWSERS} (${Math.ceil(CONCURRENCY / BROWSERS)}/browser)   mode : ${MODE}${MODE === 'headless' ? ' (score ~0% !)' : ''}`);
  console.log(`  proxy       : ${PROXY ? PROXY.server : 'non (IP locale)'}   durée : ${DURATION || '∞'}s${TARGET ? `   cible : ${TARGET} tok/s` : ''}`);
  console.log('');

  const args = ['--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check', '--disable-features=IsolateOrigins,site-per-process',
    '--window-size=1920,1080', '--use-angle=d3d11', '--use-gl=angle', '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'];
  if (MODE === 'hidden') args.push('--window-position=-32000,-32000');   // hors-écran = invisible mais bon score
  if (PROXY) args.push(`--proxy-server=${PROXY.server}`);
  const opts = { headless: MODE === 'headless' ? 'new' : false, args, ignoreDefaultArgs: ['--enable-automation'] };
  if (process.env.CHROME_PATH) opts.executablePath = process.env.CHROME_PATH; else opts.channel = 'chrome';

  const stop = { v: false };
  let count = 0, errors = 0, lastToken = null;
  const outStream = OUT ? fs.createWriteStream(OUT, { flags: 'a' }) : null;
  const onToken = (t) => { count++; lastToken = t; if (outStream) outStream.write(t + '\n'); };

  console.log(`→ lancement de ${BROWSERS} navigateur(s)…`);
  let browsers;
  try { browsers = await Promise.all(Array.from({ length: BROWSERS }, () => puppeteer.launch(opts))); }
  catch (e) { console.error('✖ Chrome KO :', e.message, '\n  → CHROME_PATH=chemin\\chrome.exe'); process.exit(1); }

  console.log(`→ ouverture de ${CONCURRENCY} pages…`);
  const pagePromises = [];
  for (let i = 0; i < CONCURRENCY; i++) pagePromises.push(newWorkerPage(browsers[i % BROWSERS], PROXY));
  let pages;
  try { pages = await Promise.all(pagePromises); }
  catch (e) { console.error('✖ init pages :', e.message); for (const b of browsers) { try { await b.close(); } catch (_) {} } process.exit(1); }
  console.log(`✔ ${pages.length} workers prêts. Génération…\n`);

  const t0 = Date.now();
  const loops = pages.map(async (page) => {
    while (!stop.v) {
      try { const t = await page.evaluate((sk, a) => window.grecaptcha.enterprise.execute(sk, { action: a }), SITE_KEY, ACTION); if (t) onToken(t); }
      catch (e) { errors++; }
    }
  });

  // ── Sonde QUALITÉ périodique : token dédié → event, pour voir si le score TIENT sous volume ──
  const EVENT_URL = `${ORIGIN}/event/${process.env.TM_EVENT_ID || '1600647921872DC4'}`;
  const probes = [];
  let probeBusy = false;
  const probePage = /ticketmaster\.com/.test(ORIGIN) ? pages[pages.length - 1] : null;
  async function probe() {
    if (!probePage || probeBusy || stop.v) return;
    probeBusy = true;
    try {
      const r = await probePage.evaluate(async (o) => {
        const tok = await window.grecaptcha.enterprise.execute(o.SITE_KEY, { action: o.ACTION });
        await fetch(o.ORIGIN + '/eps-mgr', { credentials: 'include', headers: { accept: '*/*' } });
        await fetch(o.ORIGIN + '/epsf/gec/v3/Event', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json', accept: '*/*' }, body: JSON.stringify({ hostname: 'www.ticketmaster.com', key: o.SITE_KEY, token: tok }) });
        const ev = await fetch(o.EVENT_URL, { credentials: 'include', headers: { accept: 'text/html' } });
        const body = await ev.text();
        return { status: ev.status, botwall: /identity verified|not a bot|make sure you're not/i.test(body) };
      }, { SITE_KEY, ACTION, ORIGIN, EVENT_URL });
      const s = (Date.now() - t0) / 1000;
      const ok = r.status === 200 && !r.botwall;
      probes.push({ at: s.toFixed(0), rate: count / s, status: r.status, ok });
      process.stderr.write(`\n  [sonde ${s.toFixed(0)}s] débit≈${(count / s).toFixed(0)}/s → event ${r.status} ${ok ? '✔' : '✖ SCORE DÉGRADÉ'}\n`);
    } catch (_) {} finally { probeBusy = false; }
  }
  const prober = setInterval(probe, 4000);

  const reporter = setInterval(() => {
    const s = (Date.now() - t0) / 1000;
    process.stderr.write(`\r  ${count} tokens  |  ${(count / s).toFixed(1)} tok/s  |  ${errors} err  |  ${s.toFixed(0)}s   `);
  }, 500);

  if (DURATION) setTimeout(() => { stop.v = true; }, DURATION * 1000);
  process.on('SIGINT', () => { stop.v = true; });

  await Promise.race([Promise.all(loops), new Promise(r => { const iv = setInterval(() => { if (stop.v) { clearInterval(iv); r(); } }, 200); })]);
  stop.v = true;
  clearInterval(reporter); clearInterval(prober);
  const total = (Date.now() - t0) / 1000;
  if (outStream) outStream.end();
  for (const b of browsers) { try { await b.close(); } catch (_) {} }

  console.log('\n');
  console.log('══════════════════════════════════════════════');
  console.log(`  TOTAL : ${count} tokens en ${total.toFixed(1)}s  →  ${(count / total).toFixed(1)} tokens/s`);
  console.log(`  débit projeté : ${Math.round(count / total * 60)} /min  ·  ${Math.round(count / total * 3600)} /h`);
  console.log(`  erreurs : ${errors}${OUT ? `   ·  tokens écrits dans ${OUT}` : ''}`);
  if (TARGET) console.log(`  cible ${TARGET}/s : ${(count / total) >= TARGET ? '✔ ATTEINTE' : `✖ ${((count / total) / TARGET * 100).toFixed(0)}% (${(count / total).toFixed(0)}/s)`}`);
  if (probes.length) {
    const good = probes.filter(p => p.ok).length;
    console.log(`  QUALITÉ sous charge : ${good}/${probes.length} sondes event=200` + (good < probes.length ? '  ⚠️ SCORE DÉGRADÉ par le volume/IP' : '  ✔ score tient'));
    for (const p of probes) console.log(`     ${String(p.at).padStart(3)}s  ~${String(Math.round(p.rate)).padStart(4)}/s  → event ${p.status} ${p.ok ? '✔' : '✖'}`);
  }
  console.log('══════════════════════════════════════════════');
  process.exit(0);
})();
