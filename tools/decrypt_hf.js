'use strict';
/**
 * decrypt_hf.js — Déchiffre un token de repli reCAPTCHA « HF… » (comme le ferait le serveur Google)
 * et affiche le tableau JSON `E` qu'il encode. Sert à VÉRIFIER que le cipher/structure n'ont pas
 * changé après une rotation de recaptcha__fr.js (cf. final/UPDATING.md).
 *
 *   HF = "HF" + base64url( seed[3] ++ ( encodeURIComponent(JSON.stringify(E)) XOR key XOR seed ) )
 *   key = la site-key ; seed = 3 premiers octets du corps.
 *
 * Usage :
 *   node tools/decrypt_hf.js <token HF> [siteKey]
 *   node tools/decrypt_hf.js --file token.txt [siteKey]
 *   echo "<token>" | node tools/decrypt_hf.js - <siteKey>
 */
const fs = require('fs');

const DEFAULT_KEY = '6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV';

function decryptHF(token, key) {
  if (!token || !token.startsWith('HF')) throw new Error('pas un token HF (préfixe attendu "HF")');
  const A = Buffer.from(token.slice(2).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (A.length < 4) throw new Error('corps trop court');
  const seed = [A[0], A[1], A[2]];
  let eu = '';
  for (let f = 0; f < A.length - 3; f++) {
    eu += String.fromCharCode((A[3 + f] ^ key.charCodeAt(f % key.length) ^ seed[f % 3]) & 0xff);
  }
  const plain = decodeURIComponent(eu);
  return { seed: String.fromCharCode(...seed), plain, json: JSON.parse(plain) };
}

// Structure attendue (indices → étiquette) pour le diagnostic.
const EXPECTED = [
  'fetoken(const)', 'timestamp(ms)', 'Error: reCAPTCHA XhrError', 'pageUrl', 'version(v)',
  '0(const)', 'anchorToken', 'anchor-ms(20000)', 'execute-ms(30000)', 'null', 'action',
  'co(origin:443)', 'userAgent',
];

if (require.main === module) {
  const args = process.argv.slice(2);
  let token, key = DEFAULT_KEY;
  if (args[0] === '--file') { token = fs.readFileSync(args[1], 'utf8').trim(); if (args[2]) key = args[2]; }
  else if (args[0] === '-') { token = fs.readFileSync(0, 'utf8').trim(); if (args[1]) key = args[1]; }
  else { token = (args[0] || '').trim(); if (args[1]) key = args[1]; }
  if (!token) { console.error('usage: node tools/decrypt_hf.js <token HF> [siteKey]'); process.exit(1); }

  let r;
  try { r = decryptHF(token, key); }
  catch (e) { console.error('✖ déchiffrement KO : ' + e.message + '\n  → le cipher ou la clé ont probablement changé (voir final/UPDATING.md §B).'); process.exit(2); }

  console.log('seed :', r.seed);
  console.log('éléments :', r.json.length, r.json.length === 13 ? '(attendu 13 ✓)' : '(⚠ ATTENDU 13 — structure changée)');
  r.json.forEach((v, i) => {
    const s = typeof v === 'string' ? (v.length > 60 ? v.slice(0, 60) + `…(${v.length})` : v) : JSON.stringify(v);
    const exp = EXPECTED[i] || '??';
    console.log(`  [${i}] ${s}`.padEnd(74) + ' ⟵ ' + exp);
  });
  // check des invariants « constants »
  const bad = [];
  if (r.json[0] !== 'fetoken') bad.push('[0]≠"fetoken"');
  if (r.json[2] !== 'Error: reCAPTCHA XhrError') bad.push('[2] libellé erreur changé');
  if (r.json[9] !== null) bad.push('[9]≠null');
  console.log(bad.length ? '\n⚠ invariants cassés : ' + bad.join(', ') + ' → maj structure (UPDATING.md §B)'
                         : '\n✓ invariants OK — cipher & structure inchangés, le générateur Go reste valide.');
}

module.exports = { decryptHF };
