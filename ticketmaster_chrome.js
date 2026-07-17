'use strict';
/**
 * ticketmaster_chrome.js — Génère le token reCAPTCHA v3 Enterprise avec un VRAI Chrome
 * (Puppeteer + ton Chrome 150 installé + stealth), puis rejoue la chaîne Ticketmaster :
 *   token → GET /eps-mgr → POST /epsf/gec/v3/Event (tmpt) → GET page event (status).
 *
 * Contrairement à jsdom, un vrai Chrome fournit un vrai graphe d'objets / VM / canvas / WebGL →
 * score élevé → tmpt fort → l'event doit répondre 200 (comme ton navigateur à 0.9).
 *
 * Prérequis : Chrome installé (chemin standard) OU CHROME_PATH=...
 *   HEADLESS=1 pour headless (défaut : fenêtre visible = score max).
 *   RC_PROXY=host:port:user:pass pour sortir via proxy (sinon IP locale).
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
const VERIFY   = `${ORIGIN}/epsf/gec/v3/Event`;
const EPS_MGR  = `${ORIGIN}/eps-mgr`;
const INJECT_PATH = '/__rc_inject__';
const INJECT_URL  = ORIGIN + INJECT_PATH;
const HEADLESS = process.env.HEADLESS === '1';

// Page servie SOUS l'origine ticketmaster.com (via interception) → token à la bonne origine.
const INJECT_HTML = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Ticketmaster</title>
<script src="https://www.google.com/recaptcha/enterprise.js?render=${SITE_KEY}"></script>
</head><body><div id="app">loading…</div></body></html>`;

function parseProxy(raw) {
  if (!raw) return null;
  raw = String(raw).trim();
  if (/^[a-z0-9]+:\/\//i.test(raw)) { const u = new URL(raw); return { server: `${u.protocol}//${u.host}`, username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) }; }
  const p = raw.split(':');
  if (p.length === 4) return { server: `http://${p[0]}:${p[1]}`, username: p[2], password: p[3] };
  if (p.length === 2) return { server: `http://${p[0]}:${p[1]}` };
  return null;
}

(async () => {
  const PROXY = parseProxy(process.env.RC_PROXY);
  console.log('══════════════════════════════════════════════');
  console.log(' TICKETMASTER — vrai Chrome (Puppeteer + stealth)');
  console.log('══════════════════════════════════════════════');
  console.log(`  sitekey : ${SITE_KEY}`);
  console.log(`  action  : ${ACTION}   headless : ${HEADLESS ? 'oui' : 'non (fenêtre visible)'}`);
  console.log(`  proxy   : ${PROXY ? PROXY.server : 'non (IP locale)'}`);
  console.log('');

  const launchArgs = ['--disable-blink-features=AutomationControlled', '--disable-features=IsolateOrigins,site-per-process', '--no-first-run', '--no-default-browser-check'];
  if (PROXY) launchArgs.push(`--proxy-server=${PROXY.server}`);
  const launchOpts = {
    headless: HEADLESS ? 'new' : false,
    args: launchArgs,
    ignoreDefaultArgs: ['--enable-automation'],
  };
  if (process.env.CHROME_PATH) launchOpts.executablePath = process.env.CHROME_PATH;
  else launchOpts.channel = 'chrome';   // utilise le Chrome installé (150)

  let browser;
  try { browser = await puppeteer.launch(launchOpts); }
  catch (e) {
    console.error('✖ Lancement Chrome KO :', e.message);
    console.error('  → installe Chrome, ou passe CHROME_PATH=chemin\\vers\\chrome.exe');
    process.exit(1);
  }

  try {
    const page = await browser.newPage();
    if (PROXY && PROXY.username) await page.authenticate({ username: PROXY.username, password: PROXY.password });

    await page.setRequestInterception(true);
    page.on('request', req => {
      if (req.url().startsWith(INJECT_URL)) req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: INJECT_HTML });
      else req.continue();
    });

    console.log('1) chargement page (origine ticketmaster.com) + reCAPTCHA enterprise…');
    await page.goto(INJECT_URL, { waitUntil: 'networkidle2', timeout: 60000 });

    // vérif IP de sortie
    try {
      const ip = await page.evaluate(async () => (await (await fetch('https://api.ipify.org?format=json')).json()).ip);
      console.log(`   IP de sortie : ${ip}`);
    } catch (_) {}

    console.log('2) grecaptcha.enterprise.execute…');
    const token = await page.evaluate((sk, action) => new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('timeout grecaptcha')), 45000);
      function go() {
        try {
          window.grecaptcha.enterprise.ready(() => {
            window.grecaptcha.enterprise.execute(sk, { action }).then(t => { clearTimeout(to); res(t); }).catch(rej);
          });
        } catch (e) { rej(e); }
      }
      if (window.grecaptcha && window.grecaptcha.enterprise) go();
      else { const iv = setInterval(() => { if (window.grecaptcha && window.grecaptcha.enterprise) { clearInterval(iv); go(); } }, 200); }
    }), SITE_KEY, ACTION);
    console.log(`   ✔ token (${token.length} chars) : ${token.slice(0, 48)}…`);
    console.log('');

    console.log('3) chaîne Ticketmaster (in-browser, cookies réels) : eps-mgr → verify → event…');
    const flow = await page.evaluate(async (o) => {
      const out = {};
      const mgr = await fetch(o.EPS_MGR, { credentials: 'include', headers: { accept: '*/*' } });
      out.mgrStatus = mgr.status;
      const pr = await fetch(o.VERIFY, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json', accept: '*/*' },
        body: JSON.stringify({ hostname: 'www.ticketmaster.com', key: o.SITE_KEY, token: o.token }),
      });
      out.postStatus = pr.status;
      out.postBody = (await pr.text()).slice(0, 200);
      return out;
    }, { token, SITE_KEY, VERIFY, EPS_MGR });
    console.log(`   /eps-mgr : HTTP ${flow.mgrStatus}   POST verify : HTTP ${flow.postStatus}`);
    console.log('');

    console.log('4) navigation vers la page event → status…');
    const resp = await page.goto(EVENT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const status = resp ? resp.status() : 0;
    const title = await page.title().catch(() => '');
    const ok = status === 200 && !/identity verified|not a bot/i.test(title);
    console.log('   ┌────────────────────────────────────────────');
    console.log(`   │  STATUS : ${status}   title: "${title.slice(0, 50)}"`);
    console.log(`   │  ${ok ? '✔✔ PAGE EVENT ACCESSIBLE (200) — token accepté !' : '✖ bloqué (identity/bot-wall)'}`);
    console.log('   └────────────────────────────────────────────');

    if (!HEADLESS) { console.log('\n   (fenêtre laissée ouverte 8s pour inspection)'); await new Promise(r => setTimeout(r, 8000)); }
    await browser.close();
    process.exit(ok ? 0 : 4);
  } catch (e) {
    console.error('✖', e.message);
    try { await browser.close(); } catch (_) {}
    process.exit(1);
  }
})();
