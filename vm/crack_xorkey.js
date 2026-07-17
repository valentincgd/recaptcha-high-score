'use strict';
// Crack la dérivation de clé XOR par signal collecteur, depuis le corpus apparié.
const fs = require('fs'), path = require('path');
const MULT = 4391, INC = 277, MOD = 32779, OUTMOD = 255;
function keystream(key, n) { let s = key % MOD; if (s < 0) s += MOD; const o = new Uint8Array(n); for (let i = 0; i < n; i++) { s = (MULT * s + INC) % MOD; o[i] = s % OUTMOD; } return o; }
// base64url decode (alphabet standard url -_)
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(str, 'base64');
}
const dec = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'recaptcha', 'fingerprint', 'decrypted_values.json'), 'utf8'));
const enc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'recaptcha', 'fingerprint', 'encrypted_values.json'), 'utf8'));

// Récupère les paires top-level [value, signalKey, elapsed]
function collectPairs(dArr, eArr) {
  const pairs = [];
  for (let i = 0; i < dArr.length; i++) {
    const d = dArr[i], e = eArr[i];
    if (Array.isArray(d) && d.length === 3 && typeof d[0] === 'string' && typeof d[1] === 'number'
      && Array.isArray(e) && typeof e[0] === 'string') {
      if (e[0].startsWith('b')) pairs.push({ value: d[0], signalKey: d[1], elapsed: d[2], enc: e[0] });
    }
  }
  return pairs;
}
const pairs = collectPairs(dec, enc);
console.log('paires collecteur "b":', pairs.length);

function crackKey(pt, ctBytes) {
  const pb = Buffer.from(pt, 'utf8');
  const n = Math.min(pb.length, ctBytes.length);
  // keystream cible = pt XOR ct
  const target = new Uint8Array(n); for (let i = 0; i < n; i++) target[i] = pb[i] ^ ctBytes[i];
  const found = [];
  for (let key = 0; key < MOD; key++) {
    const ks = keystream(key, n); let ok = true;
    for (let i = 0; i < n; i++) if (ks[i] !== target[i]) { ok = false; break; }
    if (ok) found.push(key);
  }
  return found;
}

const rows = [];
for (const p of pairs) {
  const ct = b64urlDecode(p.enc.slice(1));
  if (ct.length < p.value.length) { rows.push({ ...p, keys: 'LENMISMATCH ct=' + ct.length + ' pt=' + p.value.length }); continue; }
  const keys = crackKey(p.value, ct);
  rows.push({ ...p, ctLen: ct.length, keys });
}
for (const r of rows) {
  const kk = Array.isArray(r.keys) ? r.keys.join(',') : r.keys;
  console.log(`key(s)=[${kk}]  signalKey=${r.signalKey} elapsed=${r.elapsed} value=${JSON.stringify(String(r.value).slice(0, 30))}`);
}
// Analyse : relation key ↔ (signalKey, elapsed)
console.log('\n--- recherche relation ---');
for (const r of rows) {
  if (!Array.isArray(r.keys) || r.keys.length === 0) continue;
  const k = r.keys[0];
  console.log(`k=${k}  signalKey%MOD=${((r.signalKey % MOD) + MOD) % MOD}  (sk+elapsed)%MOD=${((r.signalKey + r.elapsed) % MOD)}  (sk^elapsed)%MOD=${((r.signalKey ^ r.elapsed) % MOD)}  elapsed=${r.elapsed}`);
}
