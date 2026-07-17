/**
 * tools/fetch_scripts.js — Récupère et met en cache le vrai pipeline de scripts reCAPTCHA.
 *
 * ⚠️ USAGE RECHERCHE / ÉDUCATIF.
 *
 * Flux réel :
 *   1) GET enterprise.js?render=<siteKey>  → loader (contient l'URL recaptcha__<hl>.js courante + version v=)
 *   2) GET recaptcha__<hl>.js               → le vrai script (≈900 KB) qui construit/chiffre le champ 16
 *
 * Sortie : ./scripts/{enterprise.js, recaptcha__<hl>.js, meta.json}
 */
'use strict';
const fs = require('fs');
const path = require('path');
const xbv = require('./xbv');

const SITE_KEY = process.env.RC_SITEKEY || '6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV';
const ORIGIN   = process.env.RC_ORIGIN  || 'https://www.ticketmaster.com';
const HL       = process.env.RC_HL      || 'fr';
const IDENTITY = xbv.browserIdentity({
  version: process.env.RC_CHROME_VERSION, platform: process.env.RC_PLATFORM, apiKey: process.env.RC_XBV_KEY,
});
const UA = IDENTITY.userAgent;

const OUT = path.join(__dirname, '..', 'scripts');
fs.mkdirSync(OUT, { recursive: true });

// Headers "browser-like" (les X-Browser-* imitent Chrome ; utiles pour ne pas être servi une variante dégradée)
function browserHeaders(referer) {
  return {
    'User-Agent': UA,
    'Accept': '*/*',
    'Accept-Language': `${HL}-${HL.toUpperCase()},${HL};q=0.9,en-US;q=0.8,en;q=0.7`,
    'Referer': referer,
    'Origin': ORIGIN,
    ...xbv.chromeHeaders(IDENTITY),   // sec-ch-ua + X-Browser-* cohérents (cf. tools/xbv.js)
  };
}

async function get(url, referer) {
  const res = await fetch(url, { headers: browserHeaders(referer), redirect: 'follow' });
  const body = await res.text();
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}\n${body.slice(0, 300)}`);
  return { body, headers: Object.fromEntries(res.headers) };
}

async function fetchScripts({ quiet = false } = {}) {
  const say = (...a) => { if (!quiet) console.log(...a); };
  // 1) Loader
  const loaderUrl = `https://www.google.com/recaptcha/enterprise.js?render=${SITE_KEY}`;
  say('→ GET', loaderUrl);
  const loader = await get(loaderUrl, ORIGIN + '/');
  fs.writeFileSync(path.join(OUT, 'enterprise.js'), loader.body);

  // Extraire l'URL du script principal + la version (po.src='...releases/<VER>/recaptcha__<hl>.js')
  const srcMatch = loader.body.match(/po\.src\s*=\s*'([^']+recaptcha__[a-z]+\.js)'/i)
                 || loader.body.match(/'(https:\/\/www\.gstatic\.com\/recaptcha\/releases\/[^']+recaptcha__[a-z]+\.js)'/i);
  if (!srcMatch) {
    if (!quiet) console.error('Loader (début):\n' + loader.body.slice(0, 500));
    throw new Error("Impossible d'extraire l'URL recaptcha__*.js du loader");
  }
  const scriptUrl = srcMatch[1];
  const verMatch = scriptUrl.match(/releases\/([^/]+)\//);
  const version = verMatch ? verMatch[1] : 'unknown';
  const hlMatch = scriptUrl.match(/recaptcha__([a-z]+)\.js/i);
  const hl = hlMatch ? hlMatch[1] : HL;

  // Intégrité (sha384) éventuelle dans le loader
  const integMatch = loader.body.match(/integrity='([^']+)'/);

  say('→ version =', version, '| hl =', hl);
  say('→ GET', scriptUrl);
  const main = await get(scriptUrl, ORIGIN + '/');
  const mainFile = path.join(OUT, `recaptcha__${hl}.js`);
  fs.writeFileSync(mainFile, main.body);

  const meta = {
    fetchedFor: { siteKey: SITE_KEY, origin: ORIGIN, hl: HL },
    loaderUrl, scriptUrl, version, hl,
    integrity: integMatch ? integMatch[1] : null,
    scriptBytes: Buffer.byteLength(main.body),
    scriptFile: path.relative(path.join(__dirname, '..'), mainFile).replace(/\\/g, '/'),
  };
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 2));
  say('\n✔ Cache écrit dans ./scripts/');
  if (!quiet) console.log(JSON.stringify(meta, null, 2));
  return meta;
}

module.exports = { fetchScripts };

if (require.main === module) {
  fetchScripts().catch(e => { console.error('✖', e.message); process.exit(1); });
}
