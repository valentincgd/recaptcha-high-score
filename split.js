'use strict';
/**
 * split.js — PoC : le VRAI Chrome produit UNIQUEMENT le payload /reload (champ 16 réel) ;
 * Node fait le POST /reload et récupère le token.
 *
 *   browser: execute() → construit champ 16 → tente POST /reload  ──(intercepté + annulé)──►
 *   Node   : renvoie le payload capturé au /reload (TLS Chrome 150) → token
 *
 * But : déporter tout le réseau côté Node (proxies, TLS, retries) ; le browser n'est qu'un
 * « oracle champ 16 ». Vérifie ensuite que le token obtenu passe l'event Ticketmaster (200).
 *
 * ⚠️ RECHERCHE / ÉDUCATIF. Note : le champ 16 est MONO-USAGE (lié à un anchor token).
 */
const puppeteer = require('puppeteer-extra');
const Stealth = require('puppeteer-extra-plugin-stealth');
puppeteer.use(Stealth());
const tlsc = require('node-tls-client');
const xbv = require('./tools/xbv');

// PATCH CRITIQUE : forcer isByteRequest=true → node-tls-client décode le body base64 en octets
// bruts (protobuf /reload binaire). Sans ça, le base64 est envoyé en texte → payload corrompu → NULL.
try { require('node-tls-client/dist/utils/request').isByteRequest = () => true; }
catch (_) { try { require('node-tls-client/dist/utils').isByteRequest = () => true; } catch (_) {} }

const SITE_KEY = process.env.RC_SITEKEY || '6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV';
const ORIGIN   = 'https://www.ticketmaster.com';
const ACTION   = process.env.RC_ACTION || 'Event';
const HEADLESS = process.env.HEADLESS === '1';
const INJECT_URL = ORIGIN + '/__rc_split__';
const INJECT_HTML = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>tm</title>
<script src="https://www.google.com/recaptcha/enterprise.js?render=${SITE_KEY}"></script>
</head><body><div id="app"></div></body></html>`;

let _sess = null;  // session TLS pré-chauffée (POST reload instantané, gap anchor→reload minimal)
async function warmTLS() { await tlsc.initTLS(); _sess = new tlsc.Session({ clientIdentifier: 'chrome_150', timeout: 30000 }); }
async function nodeReload(url, bodyBuf, headers) {
  const r = await _sess.post(url, { headers, body: bodyBuf.toString('base64'), followRedirects: false });
  return { status: r.status, body: await r.text() };
}

// La réponse /reload est )]}'\n["rresp","<token>",...] → extraire le token
function extractToken(text) {
  try {
    const j = JSON.parse(text.replace(/^\)\]\}'/, '').trim());
    if (Array.isArray(j) && j[0] === 'rresp') return j[1] || null;
  } catch (_) {}
  const m = text.match(/"rresp","([^"]+)"/);
  return m ? m[1] : null;
}

(async () => {
  console.log('══════════════════════════════════════════════');
  console.log(' SPLIT — champ 16 (browser) + /reload (Node)');
  console.log('══════════════════════════════════════════════');
  const opts = { headless: HEADLESS ? 'new' : false, args: ['--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check', '--disable-features=IsolateOrigins,site-per-process,ProcessPerSiteUpToMainFrameThreshold', '--disable-site-isolation-trials'], ignoreDefaultArgs: ['--enable-automation'] };
  if (process.env.CHROME_PATH) opts.executablePath = process.env.CHROME_PATH; else opts.channel = 'chrome';
  await warmTLS();  // TLS prêt AVANT l'execute → POST reload instantané (gap anchor→reload minimal)
  const browser = await puppeteer.launch(opts);

  let captured = null;
  try {
    const page = await browser.newPage();
    // Capture BYTE-EXACTE du body via l'event CDP (postDataEntries = base64 exact, pas lossy)
    const cdp = await page.target().createCDPSession();
    await cdp.send('Network.enable', { maxPostDataSize: 5000000 });
    cdp.on('Network.requestWillBeSent', (e) => {
      if (captured) return;
      const r = e.request || {};
      if (/\/(enterprise|api2)\/reload\?/.test(r.url || '') && r.method === 'POST') {
        let buf = Buffer.alloc(0);
        const entries = r.postDataEntries || [];
        for (const en of entries) if (en && en.bytes) buf = Buffer.concat([buf, Buffer.from(en.bytes, 'base64')]);
        if (!buf.length && typeof r.postData === 'string') buf = Buffer.from(r.postData, 'binary');
        captured = { url: r.url, headers: r.headers || {}, bodyB64: buf.toString('base64'), bytes: buf.length, t: Date.now() };
      }
    });
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const u = req.url();
      if (/\/(enterprise|api2)\/reload\?/.test(u) && req.method() === 'POST') req.abort().catch(() => {}); // browser N'envoie pas
      else if (u.startsWith(INJECT_URL)) req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: INJECT_HTML });
      else req.continue();
    });

    console.log('1) browser : chargement + execute() (construit le champ 16)…');
    await page.goto(INJECT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.evaluate(() => new Promise(res => { const iv = setInterval(() => { if (window.grecaptcha && window.grecaptcha.enterprise) { clearInterval(iv); window.grecaptcha.enterprise.ready(res); } }, 80); }));
    // execute() va construire le champ 16 et tenter le /reload → intercepté/annulé (donc la promesse ne résout pas)
    page.evaluate((sk, a) => { try { window.grecaptcha.enterprise.execute(sk, { action: a }); } catch (_) {} }, SITE_KEY, ACTION);

    // attendre la capture du /reload
    for (let i = 0; i < 100 && !captured; i++) await new Promise(r => setTimeout(r, 100));
    if (!captured || !captured.bodyB64) { console.error('✖ /reload non capturé (ou body vide)'); await browser.close(); process.exit(2); }
    const bodyBuf = Buffer.from(captured.bodyB64, 'base64');
    console.log(`   ✔ payload /reload capturé : ${bodyBuf.length} octets   url=${captured.url.slice(0, 70)}…`);
    // cookies google.com du browser (_GRECAPTCHA, NID…) → nécessaires au /reload
    try {
      const all = await cdp.send('Network.getAllCookies');
      const g = (all.cookies || []).filter(c => /(^|\.)google\.com$/.test(c.domain));
      captured.cookieHeader = g.map(c => `${c.name}=${c.value}`).join('; ');
      console.log(`   cookies google capturés : ${g.length} (${g.map(c => c.name).join(',').slice(0, 60)})`);
    } catch (_) {}
  } catch (e) { console.error('✖ browser:', e.message); try { await browser.close(); } catch (_) {} process.exit(1); }
  // NB : on NE ferme PAS le browser ici — on POSTe le reload IMMÉDIATEMENT (gap anchor→reload minimal)

  console.log('2) Node : POST /reload (TLS Chrome 150) avec le payload capturé…');
  // Forwarder les headers EXACTS que le browser a envoyés (cookie _GRECAPTCHA, referer, x-client-data…)
  const headers = {};
  for (const [k, v] of Object.entries(captured.headers)) {
    const lk = k.toLowerCase();
    if (['host', 'content-length', 'connection', 'transfer-encoding', ':method', ':path', ':authority', ':scheme'].includes(lk)) continue;
    headers[lk] = v;
  }
  if (!headers['content-type']) headers['content-type'] = 'application/x-protobuffer';
  if (captured.cookieHeader) headers['cookie'] = captured.cookieHeader;   // _GRECAPTCHA etc.
  console.log(`   cookie forwardé : ${headers['cookie'] ? headers['cookie'].slice(0, 50) + '…' : '— (aucun)'}`);
  const bodyBuf = Buffer.from(captured.bodyB64, 'base64');
  let rr;
  try { rr = await nodeReload(captured.url, bodyBuf, headers); }
  catch (e) { console.error('✖ POST /reload Node:', e.message); process.exit(3); }
  const gap = Date.now() - captured.t;
  console.log(`   gap anchor→reload : ${gap} ms`);
  try { await browser.close(); } catch (_) {}   // browser plus nécessaire, on ferme après le POST
  const token = extractToken(rr.body);
  console.log(`   /reload → HTTP ${rr.status}   token : ${token ? token.slice(0, 48) + '…' : '✖ NULL (payload corrompu ou score refusé)'}`);
  if (!token) { console.log('══════════════════════════════════════════════'); console.log('✖ échec : pas de token'); process.exit(4); }

  // ── Vérif SCORE : le token du split passe-t-il l'event Ticketmaster (200) ? ──
  console.log('3) Node : chaîne Ticketmaster (eps-mgr → verify → event) pour tester le SCORE…');
  const id = xbv.browserIdentity({});
  const ch = xbv.chromeHeaders(id);
  const s = _sess;   // réutilise la session TLS pré-chauffée
  let eventStatus = 0, botwall = false, postStatus = 0;
  try {
    const uaH = { 'user-agent': id.userAgent, 'accept-language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7', 'sec-ch-ua': ch['sec-ch-ua'], 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': ch['sec-ch-ua-platform'] };
    const mgr = await s.get(ORIGIN + '/eps-mgr', { headers: { ...uaH, accept: '*/*' } });
    let epsSid = '';
    const sc1 = mgr.headers['set-cookie'] || mgr.headers['Set-Cookie'];
    if (sc1) { const m = String(Array.isArray(sc1) ? sc1.join(';') : sc1).match(/eps_sid=([^;]+)/); if (m) epsSid = 'eps_sid=' + m[1]; }
    const pr = await s.post(ORIGIN + '/epsf/gec/v3/Event', { headers: { ...uaH, 'content-type': 'application/json', accept: '*/*', cookie: epsSid }, body: Buffer.from(JSON.stringify({ hostname: 'www.ticketmaster.com', key: SITE_KEY, token })).toString('base64') });
    postStatus = pr.status;
    let tmpt = '';
    const sc2 = pr.headers['set-cookie'] || pr.headers['Set-Cookie'];
    if (sc2) { const m = String(Array.isArray(sc2) ? sc2.join(';') : sc2).match(/tmpt=([^;]+)/); if (m) tmpt = 'tmpt=' + m[1]; }
    const ev = await s.get(ORIGIN + '/event/' + (process.env.TM_EVENT_ID || '1600647921872DC4'), { headers: { ...uaH, accept: 'text/html', cookie: [epsSid, tmpt].filter(Boolean).join('; ') } });
    eventStatus = ev.status;
    const body = await ev.text();
    botwall = /identity verified|not a bot|make sure you're not/i.test(body);
  } catch (e) { console.error('   verify err:', e.message); }
  finally { try { await _sess.close(); } catch (_) {} try { await tlsc.destroyTLS(); } catch (_) {} }

  const scoreOk = eventStatus === 200 && !botwall;
  console.log(`   POST verify : HTTP ${postStatus}   event : HTTP ${eventStatus} ${scoreOk ? '✔ BON SCORE' : '✖ score refusé (bot-wall)'}`);
  console.log('══════════════════════════════════════════════');
  console.log(`✔ SPLIT OK : champ 16 (browser) + reload (Node) → token   ·   SCORE : ${scoreOk ? '✔ event 200' : '✖ 403'}`);
  process.exit(scoreOk ? 0 : 5);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
