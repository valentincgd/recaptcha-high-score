'use strict';
/**
 * gen_hf.js — Génère le token de REPLI reCAPTCHA v3 « HF… » en PUR NODE, SANS jsdom.
 *
 * Reversé/vérifié bit-à-bit (cf. mémoire [[fallback-token]]) :
 *   HF = "HF" + base64url( seed[3] ++ ( encodeURIComponent(JSON.stringify(E)) XOR key XOR seed ) )
 *   - key  = la site-key (40 chars)
 *   - seed = 3 octets (lettres minuscules aléatoires), préfixés au token (transmis en clair)
 *   - E = tableau JSON des signaux d'erreur, TOUS dérivables (aucune VM, aucun champ 16) :
 *        [ "fetoken", Date.now(), "Error: reCAPTCHA XhrError", pageUrl, v, 0,
 *          anchorToken, anchor-ms, execute-ms, null, action, co(origin:port), userAgent ]
 *     anchorToken = GET /anchor → id="recaptcha-token".
 *
 * ⚠️ RECHERCHE / ÉDUCATIF. Ce token ENCODE l'erreur « reload a échoué » : il est structurellement
 *    valide/parseable mais scorera comme un échec côté serveur. (cf. [[fallback-token]])
 *
 * Usage :
 *   node gen_hf.js                                  # défauts Ticketmaster (Event)
 *   node gen_hf.js <siteKey> <action> <origin> <pageUrl>
 *   node gen_hf.js --json
 *   RC_SITEKEY=… RC_ACTION=… RC_ORIGIN=… RC_PAGEURL=… node gen_hf.js
 */
const fs = require('fs');
const path = require('path');
const tlsc = require('node-tls-client');
const xbv = require('./tools/xbv');

// ---- helpers ---------------------------------------------------------------
const b64url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
// co = base64(origin_avec_port) façon reCAPTCHA : +→- /→_ =→.
function encodeCo(origin) {
  return Buffer.from(origin, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '.');
}
// cipher fn_H_3 : triple XOR par caractère + seed 3 octets cyclé.
function cipherHF(plain, key, seed) {
  const EU = encodeURIComponent(plain);
  const out = Buffer.alloc(3 + EU.length);
  out[0] = seed[0]; out[1] = seed[1]; out[2] = seed[2];
  for (let f = 0; f < EU.length; f++) {
    out[3 + f] = (EU.charCodeAt(f) ^ key.charCodeAt(f % key.length) ^ seed[f % 3]) & 0xff;
  }
  return 'HF' + b64url(out);
}
function randSeed() {
  // R[48](79) observé = 3 lettres minuscules ; le seed est transmis en clair (self-describing).
  const a = 'abcdefghijklmnopqrstuvwxyz';
  const s = [];
  for (let i = 0; i < 3; i++) s.push(a.charCodeAt(Math.floor(Math.random() * 26)));
  return s;
}

// ---- config ----------------------------------------------------------------
function readVersion() {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(__dirname, 'scripts', 'meta.json'), 'utf8'));
    if (meta.version) return meta.version;
  } catch (_) {}
  return 'TnA7HacJFoBWt9hnlunBlYfK';
}

// ---- GET /anchor → token ---------------------------------------------------
async function fetchAnchorToken({ siteKey, origin, hl, version, id, session, mode }) {
  const co = encodeCo(origin.replace(/\/$/, '') + ':443');
  const cb = Math.random().toString(36).slice(2, 12);
  const seg = mode === 'standard' ? 'api2' : 'enterprise';
  const url = `https://www.google.com/recaptcha/${seg}/anchor?ar=1&k=${siteKey}` +
    `&co=${co}&hl=${hl}&v=${version}&size=invisible&cb=${cb}`;
  const ch = xbv.chromeHeaders ? xbv.chromeHeaders(id) : {};
  const res = await session.get(url, {
    headers: {
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'accept-language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
      'sec-ch-ua': ch['sec-ch-ua'] || '"Not;A=Brand";v="8", "Chromium";v="150", "Google Chrome";v="150"',
      'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': ch['sec-ch-ua-platform'] || '"Windows"',
      'sec-fetch-dest': 'iframe', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'cross-site',
      'upgrade-insecure-requests': '1', 'user-agent': id.userAgent,
      'referer': origin.replace(/\/$/, '') + '/',
    },
    followRedirects: true,
  });
  const html = await res.text();
  const m = html.match(/id="recaptcha-token"[^>]*value="([^"]*)"/);
  return { status: res.status, token: m ? m[1] : null, co, bytes: html.length, url };
}

// ---- génération ------------------------------------------------------------
async function generate(opts = {}) {
  const siteKey = opts.siteKey || process.env.RC_SITEKEY || '6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV';
  const action  = opts.action  || process.env.RC_ACTION  || 'Event';
  const origin  = (opts.origin || process.env.RC_ORIGIN  || 'https://www.ticketmaster.com').replace(/\/$/, '');
  const pageUrl = opts.pageUrl || process.env.RC_PAGEURL || `${origin}/event/020064BAD9B8236F`;
  const hl      = opts.hl      || process.env.RC_HL      || 'fr';
  const mode    = opts.mode    || process.env.RC_MODE    || 'enterprise';
  const anchorMs = opts.anchorMs || 20000, executeMs = opts.executeMs || 30000;
  const version = opts.version || readVersion();
  const id = xbv.browserIdentity({ version: process.env.RC_CHROME_VERSION });

  await tlsc.initTLS();
  const session = new tlsc.Session({ clientIdentifier: 'chrome_150', timeout: 30000 });
  let anchor;
  try {
    anchor = await fetchAnchorToken({ siteKey, origin, hl, version, id, session, mode });
  } finally {
    try { await session.close(); } catch (_) {}
    try { await tlsc.destroyTLS(); } catch (_) {}
  }
  if (!anchor.token) {
    const e = new Error('anchor sans token (HTTP ' + anchor.status + ', ' + anchor.bytes + 'B)');
    e.anchor = anchor; throw e;
  }

  // Tableau E (ordre EXACT observé au dump)
  const E = [
    'fetoken',
    Date.now(),
    'Error: reCAPTCHA XhrError',
    pageUrl,
    version,
    0,
    anchor.token,
    anchorMs,
    executeMs,
    null,
    action,
    anchor.co,
    id.userAgent,
  ];
  const plain = JSON.stringify(E);
  const token = cipherHF(plain, siteKey, opts.seed || randSeed());
  return { token, plain, E, anchor, identity: { userAgent: id.userAgent, version } };
}

module.exports = { generate, cipherHF, encodeCo, readVersion };

// ---- CLI -------------------------------------------------------------------
if (require.main === module) {
  const argv = process.argv.slice(2);
  const JSON_OUT = argv.includes('--json');
  const pos = argv.filter(a => !a.startsWith('-'));
  const opts = { siteKey: pos[0], action: pos[1], origin: pos[2], pageUrl: pos[3] };
  generate(opts).then(r => {
    if (JSON_OUT) {
      console.log(JSON.stringify({
        token: r.token, anchorStatus: r.anchor.status,
        anchorToken: r.anchor.token.slice(0, 24) + '…', plainLen: r.plain.length,
        E: r.E.map(v => typeof v === 'string' && v.length > 40 ? v.slice(0, 40) + `…(${v.length})` : v),
      }, null, 2));
    } else {
      console.log(r.token);
    }
    process.exit(0);
  }).catch(e => {
    console.error('✖ ' + e.message);
    if (e.anchor) console.error('  anchor url:', e.anchor.url);
    process.exit(2);
  });
}
