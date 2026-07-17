'use strict';
/**
 * analyze_field16_cipher.js — Cryptanalyse du cipher champ 16 à partir des paires appariées
 * recaptcha/fingerprint/{decrypted,encrypted}_values.json.
 *
 * Format observé : chaque signal = [value, key, elapsed]. encrypted = "b" + base64url(ciphertext),
 * ciphertext = XOR(utf8(value), keystream(key)). But : retrouver keystream(key).
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'recaptcha', 'fingerprint');
const dec = JSON.parse(fs.readFileSync(path.join(DIR, 'decrypted_values.json'), 'utf8'));
const enc = JSON.parse(fs.readFileSync(path.join(DIR, 'encrypted_values.json'), 'utf8'));

function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

// Parcours parallèle : collecte les triplets feuilles [str, key, elapsed] appariés.
const pairs = [];
function walk(d, e) {
  if (Array.isArray(d) && Array.isArray(e)) {
    // triplet feuille ? [string, number, number]
    if (d.length === 3 && typeof d[0] === 'string' && typeof d[1] === 'number' && typeof e[0] === 'string') {
      pairs.push({ pt: d[0], ct: e[0], key: d[1], elapsed: d[2] });
      return;
    }
    const n = Math.max(d.length, e.length);
    for (let i = 0; i < n; i++) walk(d[i], e[i]);
  }
}
walk(dec, enc);

console.log(`paires collectées : ${pairs.length}\n`);

// Pour chaque paire 'b'-préfixée : XOR → keystream
function analyze(p) {
  if (!/^b/.test(p.ct)) return null;                 // seules les valeurs 'b...' sont XOR-chiffrées
  const ptB = Buffer.from(p.pt, 'utf8');
  const ctB = b64urlDecode(p.ct.slice(1));
  if (ctB.length !== ptB.length) return { ...p, mismatch: `len pt=${ptB.length} ct=${ctB.length}` };
  const ks = Buffer.alloc(ptB.length);
  for (let i = 0; i < ptB.length; i++) ks[i] = ptB[i] ^ ctB[i];
  return { ...p, ptB, ctB, ks };
}

const results = pairs.map(analyze).filter(Boolean);

// 1) Le cas en or : "AAAAAAAAAA" → 12 octets, keystream quasi direct
console.log('=== Keystreams complets (valeurs à octets répétés) ===');
for (const r of results) {
  if (r.mismatch) continue;
  if (/A{5,}|0{3,}/.test(r.pt) || r.pt.length <= 2) {
    console.log(`key=${String(r.key).padStart(10)} elapsed=${String(r.elapsed).padStart(4)} pt=${JSON.stringify(r.pt).slice(0,24).padEnd(26)} ks=[${Array.from(r.ks).join(',')}]`);
  }
}

// 2) keystream[0] en fonction de la clé (pour valeurs courtes) — cherche une relation
console.log('\n=== ks[0] vs key (trié par key) ===');
const short = results.filter(r => !r.mismatch).sort((a, b) => a.key - b.key);
for (const r of short) {
  console.log(`key=${String(r.key).padStart(11)}  ks0=${String(r.ks[0]).padStart(3)}  ks=[${Array.from(r.ks.slice(0,6)).join(',')}${r.ks.length>6?',…':''}]  pt=${JSON.stringify(r.pt).slice(0,20)}`);
}

// 3) mismatches (format différent)
const mm = results.filter(r => r.mismatch);
if (mm.length) { console.log('\n=== mismatches ==='); for (const r of mm) console.log(`key=${r.key} ${r.mismatch} pt=${JSON.stringify(r.pt).slice(0,20)} ct=${r.ct.slice(0,20)}`); }
