/**
 * tools/extract_xbv_key.js — Extrait/confirme la clé API X-Browser-Validation du Chrome local.
 *
 * ⚠️ RECHERCHE / ÉDUCATIF. Lit TON chrome.dll (aucune donnée envoyée nulle part).
 *
 * La clé de validation est une clé `AIza…` embarquée dans le binaire. Deux stratégies :
 *   1) CONFIRMATION : si une clé de validation CONNUE (tools/xbv.js) est présente dans le
 *      binaire, c'est elle → toujours valide pour cette version Chrome (pas de rotation).
 *   2) ORACLE : si tu fournis une vraie paire (UA, X-Browser-Validation) capturée de ton
 *      Chrome (RC_ORACLE_UA / RC_ORACLE_XBV), on identifie la clé qui vérifie
 *      base64(sha1(clé + UA)) == header — utile SI la clé a réellement été rotée.
 *
 * ⚠️ Le header `mNzuBeCu/…` de prompt.md est FABRIQUÉ (non reproductible) — ne pas l'utiliser
 *    comme oracle. Capture-en un vrai : DevTools ▸ Network ▸ requête google.com ▸ en-têtes
 *    `x-browser-validation` + `user-agent`.
 *
 * Usage :
 *   node tools/extract_xbv_key.js [chemin\chrome.dll]
 *   RC_ORACLE_UA="…" RC_ORACLE_XBV="…" node tools/extract_xbv_key.js
 *
 * Sortie : scripts/xbv_key.json (auto-chargé par tools/xbv.js).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { PLATFORM_API_KEYS } = require('./xbv');

// --- Oracle optionnel (paire UA ↔ header RÉELLE) ----------------------------
const ORACLE_UA = process.env.RC_ORACLE_UA || null;
const ORACLE_XBV = process.env.RC_ORACLE_XBV || null;

function xbvFor(key, ua) {
  return crypto.createHash('sha1').update(key + ua, 'utf8').digest('base64');
}

// --- Localiser chrome.dll ----------------------------------------------------
function findChromeDll() {
  if (process.argv[2]) return process.argv[2];
  const roots = [
    'C:/Program Files/Google/Chrome/Application',
    'C:/Program Files (x86)/Google/Chrome/Application',
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application'),
  ];
  const found = [];
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    for (const d of fs.readdirSync(r)) {
      const dll = path.join(r, d, 'chrome.dll');
      if (/^\d+\./.test(d) && fs.existsSync(dll)) found.push({ dll, ver: d });
    }
  }
  found.sort((a, b) => b.ver.localeCompare(a.ver, undefined, { numeric: true }));
  return found.length ? found[0].dll : null;
}

// --- Extraire toutes les clés AIza… (39 chars) via scan octet -------------------
function extractKeys(buf) {
  const NEEDLE = Buffer.from('AIza', 'ascii');
  const isKeyChar = (c) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 45 || c === 95; // [0-9A-Za-z_-]
  const keys = new Set();
  let pos = 0;
  for (;;) {
    const i = buf.indexOf(NEEDLE, pos);
    if (i < 0) break;
    pos = i + 1;
    let j = i + 4, n = 4;
    while (j < buf.length && n < 39 && isKeyChar(buf[j])) { j++; n++; }
    if (n === 39) keys.add(buf.toString('latin1', i, i + 39));
  }
  return [...keys];
}

(function main() {
  const dll = findChromeDll();
  if (!dll || !fs.existsSync(dll)) {
    console.error('✖ chrome.dll introuvable. Passe le chemin : node tools/extract_xbv_key.js "C:\\...\\chrome.dll"');
    process.exit(1);
  }
  let ver = '';
  try { ver = execSync(`powershell -NoProfile -Command "(Get-Item '${dll}').VersionInfo.ProductVersion"`).toString().trim(); } catch (_) {}
  const major = (ver || '').split('.')[0] || null;
  console.log('chrome.dll :', dll, ver ? `(v${ver})` : '');

  console.log('lecture du binaire…');
  const buf = fs.readFileSync(dll);           // 250-300 MB : OK (buffer hors heap V8)
  console.log(`scan de ${(buf.length / 1048576).toFixed(0)} Mo…`);
  const keys = extractKeys(buf);
  console.log(`→ ${keys.length} clés AIza… uniques trouvées`);

  let platform = null, apiKey = null, how = null;

  // Stratégie 1 : oracle réel fourni → identifie la clé exacte (gère une rotation).
  if (ORACLE_UA && ORACLE_XBV) {
    const m = keys.find(k => xbvFor(k, ORACLE_UA) === ORACLE_XBV);
    if (m) { apiKey = m; platform = /macintosh|mac os/i.test(ORACLE_UA) ? 'macos' : /linux/i.test(ORACLE_UA) ? 'linux' : 'windows'; how = 'oracle'; }
    else {
      console.log('\n✖ Oracle fourni mais aucune clé du binaire ne le vérifie.');
      console.log('  Vérifie que UA et header viennent de la MÊME requête de CE Chrome.');
      keys.forEach(k => console.log('   ', k, '→', xbvFor(k, ORACLE_UA)));
      process.exit(2);
    }
  }

  // Stratégie 2 : confirmation — une clé de validation CONNUE est-elle dans le binaire ?
  if (!apiKey) {
    for (const [plat, k] of Object.entries(PLATFORM_API_KEYS)) {
      if (keys.includes(k)) { apiKey = k; platform = plat; how = 'known-present'; break; }
    }
  }

  if (apiKey) {
    console.log('\n✔ CLÉ X-Browser-Validation ' + (how === 'oracle' ? 'IDENTIFIÉE (oracle)' : 'CONFIRMÉE (connue, présente dans le binaire)') + ' :');
    console.log('   ' + apiKey + '   [' + platform + ']');
    if (how === 'known-present') {
      console.log('   → la clé n\'a PAS changé pour Chrome ' + (major || '?') + ' : toujours valide.');
    }
    const out = path.join(__dirname, '..', 'scripts', 'xbv_key.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({
      platform, apiKey, chromeVersion: ver || null, chromeMajor: major, how,
    }, null, 2));
    console.log('   → écrit dans scripts/xbv_key.json (auto-chargé par tools/xbv.js)');
    console.log('\n   Le harnais utilisera Chrome ' + (major || '138') + ' + cette clé automatiquement.');
    console.log('   node field16_jsdom.js');
  } else {
    console.log('\n⚠ Aucune clé de validation connue dans le binaire, et pas d\'oracle fourni.');
    console.log('  → la clé a peut-être été rotée. Capture une vraie paire (UA, header) de TON Chrome :');
    console.log('    DevTools ▸ Network ▸ requête vers *.google.com ▸ en-têtes de requête');
    console.log('    puis : RC_ORACLE_UA="…" RC_ORACLE_XBV="…" node tools/extract_xbv_key.js');
    console.log('\n  Clés candidates trouvées :');
    keys.forEach(k => console.log('   ', k));
    process.exit(2);
  }
})();
