/**
 * tools/xbv.js — X-Browser-Validation + identité Chrome cohérente.
 *
 * ⚠️ RECHERCHE / ÉDUCATIF.
 *
 * Chrome émet, vers certaines propriétés Google, un header d'intégrité :
 *     X-Browser-Validation = base64( SHA1( <clé API plateforme> + <User-Agent> ) )   (SANS séparateur)
 * La clé API est une constante par PLATEFORME, embarquée dans le binaire Chrome et
 * (rarement) rotée entre versions majeures.
 *
 * Clés publiques (reverse : dsekz/chrome-x-browser-validation-header, kekeds/x-browser-validation).
 * Vérifiées reproduire le vecteur de test v138 (voir selfTest en bas). Elles couvrent
 * Chrome v134..~v148 ; elles NE matchent PAS l'échantillon v150 de prompt.md → clé rotée en v150.
 *
 * ⇒ Pour un header VALIDE, l'UA et la clé doivent être COHÉRENTS. On dérive donc toute
 *    l'identité (UA, sec-ch-ua, X-Browser-*) d'un seul numéro de version, par défaut une
 *    version que la clé publique valide (138). Si tu extrais la clé v150 du binaire Chrome,
 *    passe-la via opts.apiKey et mets version:'150.0.0.0'.
 */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Clé + version confirmées par tools/extract_xbv_key.js (scan du chrome.dll local), si dispo.
function loadExtracted() {
  try {
    const p = path.join(__dirname, '..', 'scripts', 'xbv_key.json');
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {}
  return null;
}
const EXTRACTED = loadExtracted();

// Constantes Chrome (clés API par plateforme). Valides jusqu'à ~v148 ; v150 = clé rotée (non publique).
const PLATFORM_API_KEYS = {
  windows: 'AIzaSyA2KlwBX3mkFo30om9LUFYQhpqLoa_BNhE',
  linux:   'AIzaSyBqJZh-7pA44blAaAkH6490hUFOwX0KCYM',
  macos:   'AIzaSyDr2UxVnv_U85AbhhY8XSHSIavUW0DC-sY',
};

// Version Chrome par défaut : la plus récente que la clé PUBLIQUE valide de façon prouvée.
const DEFAULT_VERSION = '138.0.0.0';

const PLATFORM_META = {
  windows: { uaOS: 'Windows NT 10.0; Win64; x64', ch: 'Windows', navPlatform: 'Win32', keyName: 'windows' },
  linux:   { uaOS: 'X11; Linux x86_64',           ch: 'Linux',   navPlatform: 'Linux x86_64', keyName: 'linux' },
  macos:   { uaOS: 'Macintosh; Intel Mac OS X 10_15_7', ch: 'macOS', navPlatform: 'MacIntel', keyName: 'macos' },
};

function platformFromUA(ua) {
  const u = ua.toLowerCase();
  if (u.includes('windows')) return 'windows';
  if (u.includes('linux')) return 'linux';
  if (u.includes('macintosh') || u.includes('mac os x')) return 'macos';
  return 'windows';
}

/** X-Browser-Validation d'un UA. apiKey explicite prioritaire (ex. clé v150 extraite). */
function xBrowserValidation(userAgent, opts = {}) {
  const plat = opts.platform || platformFromUA(userAgent);
  const apiKey = opts.apiKey || PLATFORM_API_KEYS[plat];
  if (!apiKey) throw new Error('Pas de clé API pour la plateforme ' + plat);
  return crypto.createHash('sha1').update(apiKey + userAgent, 'utf8').digest('base64');
}

/**
 * Construit une identité Chrome cohérente à partir d'un numéro de version.
 * @returns { userAgent, secChUa, secChUaMobile, secChUaPlatform, xBrowserValidation,
 *            xBrowserYear, xBrowserChannel, xBrowserCopyright, brands, major, platform, apiKey }
 */
function browserIdentity(opts = {}) {
  const platform = opts.platform || (EXTRACTED && EXTRACTED.platform) || 'windows';
  const meta = PLATFORM_META[platform] || PLATFORM_META.windows;
  // Version : explicite > version du Chrome local extrait > défaut prouvé (138)
  const extractedVersion = EXTRACTED && EXTRACTED.chromeMajor ? EXTRACTED.chromeMajor + '.0.0.0' : null;
  const version = opts.version || extractedVersion || DEFAULT_VERSION;
  const major = String(version).split('.')[0];            // "150"
  // Clé : explicite > clé extraite/confirmée du binaire local > clé publique par plateforme
  const apiKey = opts.apiKey || (EXTRACTED && EXTRACTED.apiKey) || PLATFORM_API_KEYS[meta.keyName];
  // Année du build ~ mapping approximatif version→année (v138≈2025, v150≈2026)
  const year = opts.year || (Number(major) >= 149 ? '2026' : '2025');

  const userAgent = `Mozilla/5.0 (${meta.uaOS}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
  const brands = [
    { brand: 'Not;A=Brand', version: '8' },
    { brand: 'Chromium', version: major },
    { brand: 'Google Chrome', version: major },
  ];
  const secChUa = brands.map(b => `"${b.brand}";v="${b.version}"`).join(', ');

  return {
    platform, major, version, apiKey, brands, userAgent,
    navPlatform: meta.navPlatform,
    secChUa,
    secChUaMobile: '?0',
    secChUaPlatform: `"${meta.ch}"`,
    xBrowserValidation: xBrowserValidation(userAgent, { platform: meta.keyName, apiKey }),
    xBrowserYear: String(year),
    xBrowserChannel: 'stable',
    xBrowserCopyright: `Copyright ${year} Google LLC. All Rights Reserved.`,
  };
}

/** Les headers X-Browser-* + sec-ch-ua qu'un vrai Chrome ajoute aux requêtes Google. */
function chromeHeaders(identity) {
  return {
    'sec-ch-ua': identity.secChUa,
    'sec-ch-ua-mobile': identity.secChUaMobile,
    'sec-ch-ua-platform': identity.secChUaPlatform,
    'X-Browser-Channel': identity.xBrowserChannel,
    'X-Browser-Year': identity.xBrowserYear,
    'X-Browser-Copyright': identity.xBrowserCopyright,
    'X-Browser-Validation': identity.xBrowserValidation,
  };
}

// Auto-vérif : la clé publique DOIT reproduire le vecteur de test v138 (dsekz README).
function selfTest() {
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
  const got = xBrowserValidation(ua, { platform: 'windows' });
  const expected = '6h3XF8YcD8syi2FF2BbuE2KllQo=';
  if (got !== expected) throw new Error(`xbv selfTest FAILED: ${got} != ${expected}`);
  return true;
}

if (require.main === module) {
  selfTest();
  console.log('selfTest v138 ✔');
  const id = browserIdentity({ version: process.env.RC_CHROME_VERSION });
  console.log('\nidentité Chrome/' + id.version + ' (' + id.platform + ') :');
  console.log('  User-Agent           :', id.userAgent);
  console.log('  sec-ch-ua            :', id.secChUa);
  console.log('  X-Browser-Validation :', id.xBrowserValidation, '(clé', id.apiKey.slice(0, 12) + '…)');
  console.log('  X-Browser-Year       :', id.xBrowserYear);
}

module.exports = { PLATFORM_API_KEYS, DEFAULT_VERSION, xBrowserValidation, browserIdentity, chromeHeaders, selfTest };
