'use strict';
/**
 * ticketmaster.js — TEST bout-en-bout Ticketmaster (reCAPTCHA v3 Enterprise).
 *
 *   1) pull enterprise.js → version → recaptcha__fr.js (bonne version, tous les headers Chrome)
 *   2) flux complet dans jsdom → token v3 (TLS Chrome 150 + x-browser-* sur toutes les requêtes Google)
 *   3) POST du token sur https://www.ticketmaster.com/epsf/gec/v3/Event
 *   4) affiche la réponse + les COOKIES renvoyés (Set-Cookie)
 *
 * Usage : node ticketmaster.js
 *   env : RC_PROXY (proxy résidentiel), TM_EPS_SID (cookie session), TM_REFERER, RC_XBV_OVERRIDE
 *
 * ⚠️ RECHERCHE / ÉDUCATIF.
 */
process.env.RC_MODE = 'enterprise';
process.env.RC_XBV_INJECT = process.env.RC_XBV_INJECT || '1';   // headers x-browser-* sur les requêtes Google
process.env.TZ = process.env.RC_TZ || 'Europe/Paris';

const { run } = require('./field16_jsdom');
const xbv = require('./tools/xbv');
const tlsc = require('node-tls-client');

const SITE_KEY = process.env.RC_SITEKEY || '6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV';
const ORIGIN   = 'https://www.ticketmaster.com';
// Action reCAPTCHA = celle attendue par l'endpoint verify /epsf/gec/v3/Event → "Event". Le token doit
// porter cette action (sinon mismatch côté serveur → pas de tmpt). "identify" = action du challenge
// interstitiel de la page bloquante, PAS de l'appel gec/v3/Event.
const ACTION   = process.env.RC_ACTION || 'Event';
const HOSTNAME = 'www.ticketmaster.com';
const VERIFY   = 'https://www.ticketmaster.com/epsf/gec/v3/Event';
const EVENT_ID = process.env.TM_EVENT_ID || '020064BAD9B8236F';
const REFERER  = process.env.TM_REFERER || `${ORIGIN}/event/${EVENT_ID}`;
const EPS_SID  = process.env.TM_EPS_SID || '35ece8f8fb19731d.1782927211.x/2ZaGDQlSdQqdF2Vb+jp+mOYAOCNFbQiXsPaaA57UQ=';

const DEBUG = process.argv.includes('--debug') || process.argv.includes('-d');

const EVENT_URL = REFERER;   // https://www.ticketmaster.com/event/<id>

function parseSetCookie(setCookie) {
  const out = {};
  for (const c of setCookie) {
    const nv = c.split(';')[0];
    const i = nv.indexOf('=');
    if (i > 0) out[nv.slice(0, i).trim()] = nv.slice(i + 1).trim();
  }
  return out;
}

const EPS_MGR = 'https://www.ticketmaster.com/eps-mgr';
const getSetCookie = (h) => { let c = h && (h['set-cookie'] || h['Set-Cookie']); if (c && !Array.isArray(c)) c = [c]; return c || []; };

async function tmFlow(token) {
  await tlsc.initTLS();
  const s = new tlsc.Session({ clientIdentifier: 'chrome_150', timeout: 30000 });
  const id = xbv.browserIdentity({});
  const ch = xbv.chromeHeaders(id);
  const jar = {};                         // accumulateur de cookies
  const merge = (sc) => Object.assign(jar, parseSetCookie(sc));
  const cookieStr = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  try {
    // ── 1. GET /eps-mgr → bootstrap la session (pose eps_sid) ──
    const mgr = await s.get(EPS_MGR, { headers: {
      'accept': '*/*', 'accept-language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7', 'referer': EVENT_URL,
      'sec-ch-ua': ch['sec-ch-ua'], 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': ch['sec-ch-ua-platform'],
      'sec-fetch-dest': 'script', 'sec-fetch-mode': 'no-cors', 'sec-fetch-site': 'same-origin',
      'user-agent': id.userAgent,
    }, followRedirects: false });
    await mgr.text();
    const mgrCookies = getSetCookie(mgr.headers);
    merge(mgrCookies);
    if (!jar.eps_sid && EPS_SID) jar.eps_sid = EPS_SID;   // fallback si eps-mgr n'en pose pas
    const epsSid = jar.eps_sid || null;

    // ── 2. POST verify (avec eps_sid) → tmpt / SID / BID ──
    const postBody = Buffer.from(JSON.stringify({ hostname: HOSTNAME, key: SITE_KEY, token })).toString('base64');
    const pr = await s.post(VERIFY, { headers: {
      'accept': '*/*', 'accept-language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7', 'content-type': 'application/json',
      'origin': ORIGIN, 'priority': 'u=1, i', 'referer': REFERER,
      'sec-ch-ua': ch['sec-ch-ua'], 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': ch['sec-ch-ua-platform'],
      'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-origin',
      'user-agent': id.userAgent, 'cookie': cookieStr(),
    }, body: postBody, followRedirects: false });
    const postText = await pr.text();
    const verifySetCookie = getSetCookie(pr.headers);
    merge(verifySetCookie);

    // ── 3. GET la page event AVEC eps_sid + tmpt ──
    const ev = await s.get(EVENT_URL, { headers: {
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'accept-language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7', 'priority': 'u=0, i',
      'sec-ch-ua': ch['sec-ch-ua'], 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': ch['sec-ch-ua-platform'],
      'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'none', 'sec-fetch-user': '?1',
      'upgrade-insecure-requests': '1', 'user-agent': id.userAgent, 'cookie': cookieStr(),
    }, followRedirects: false });
    const evText = await ev.text();
    const loc = ev.headers && (ev.headers['location'] || ev.headers['Location']);
    return {
      mgrStatus: mgr.status, epsSid,
      postStatus: pr.status, postBody: postText, setCookie: verifySetCookie,
      tmpt: jar.tmpt || null, cookieHeader: cookieStr(),
      eventStatus: ev.status, eventLocation: loc || null, eventBytes: evText.length, eventBody: evText,
    };
  } finally {
    try { await s.close(); } catch (_) {}
    try { await tlsc.destroyTLS(); } catch (_) {}
  }
}

(async () => {
  console.log('══════════════════════════════════════════════');
  console.log(' TEST TICKETMASTER — reCAPTCHA v3 Enterprise');
  console.log('══════════════════════════════════════════════');
  console.log(`  sitekey : ${SITE_KEY}`);
  console.log(`  action  : ${ACTION}   origin : ${ORIGIN}`);
  console.log(`  proxy   : ${process.env.RC_PROXY ? 'oui (résidentiel)' : 'non (IP locale)'}`);
  console.log('');

  console.log('1) génération du token (TLS Chrome 150 + x-browser-* sur requêtes Google)…');
  const res = await run({
    siteKey: SITE_KEY, origin: ORIGIN, action: ACTION, hl: 'fr', mode: 'enterprise',
    eventId: EVENT_ID, pageUrl: EVENT_URL,     // la VM voit la même page event que le flux eps-mgr/verify
    quiet: !DEBUG, debug: DEBUG, timeout: 60000,
  });
  if (!res || !res.token) {
    console.error('\n✖ Pas de token généré (reload HTTP ' + (res && res.reloadStatus) + '). Abandon.');
    process.exit(2);
  }
  console.log(`   ✔ token (${res.token.length} chars) : ${res.token.slice(0, 48)}…`);
  console.log(`   /reload HTTP ${res.reloadStatus}${res.accepted ? ' ✔' : ''}   champ 16 : ${res.field16 ? res.field16.length + ' chars' : '—'}`);
  console.log('');

  console.log('2) bootstrap /eps-mgr + POST du token → tmpt …');
  let tm;
  try { tm = await tmFlow(res.token); }
  catch (e) { console.error('   ✖ flux Ticketmaster KO : ' + e.message); process.exit(3); }

  console.log(`   GET /eps-mgr : HTTP ${tm.mgrStatus}   eps_sid : ${tm.epsSid ? tm.epsSid.slice(0, 24) + '…' : '— (aucun)'}`);
  console.log(`   POST verify : HTTP ${tm.postStatus}   tmpt : ${tm.tmpt ? tm.tmpt.slice(0, 32) + '…' : '— (aucun)'}`);
  console.log('   Set-Cookie :');
  for (const c of tm.setCookie) console.log('     ' + c.split(';')[0]);
  console.log('');
  console.log('3) GET page event AVEC cookies → ' + EVENT_URL);
  const ok = tm.eventStatus === 200;
  console.log(`   ┌────────────────────────────────────────────`);
  console.log(`   │  STATUS : ${tm.eventStatus}  ${ok ? '✔ 200 — PAGE ACCESSIBLE' : (tm.eventLocation ? '→ redirect ' + tm.eventLocation : '✖ non-200')}`);
  console.log(`   │  taille : ${tm.eventBytes} octets`);
  console.log(`   └────────────────────────────────────────────`);
  if (!ok) {
    // indices de blocage : mots-clés bot-wall / challenge dans le corps
    const b = (tm.eventBody || '').toLowerCase();
    const hints = ['captcha', 'blocked', 'access denied', 'unusual', 'verify you are human', 'incapsula', 'imperva', 'pardon our interruption', 'queue-it', 'bot'];
    const found = hints.filter(h => b.includes(h));
    if (found.length) console.log(`   ⚠ indices dans la page : ${found.join(', ')}`);
    console.log('\n── CORPS DU 403 (extrait) ─────────────────────');
    console.log((tm.eventBody || '').replace(/\s+/g, ' ').slice(0, 700));
    console.log('\n   ⟹ Page pas encore 200. Le token/score reCAPTCHA est probablement trop faible.');
    console.log('     Relance (le score varie), ou améliore le fingerprint (cf. score-reality).');
  } else {
    console.log('\n   ✔✔ Objectif atteint : la page event répond 200 avec notre token reCAPTCHA.');
  }
  console.log('══════════════════════════════════════════════');
  process.exit(ok ? 0 : 4);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
