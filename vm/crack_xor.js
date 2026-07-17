'use strict';
// Le VRAI cipher champ 16 = XOR (field16_cipher.js). Seulement 32779 clés. Brute-force → plaintext protobuf.
const fs = require('fs'), path = require('path');
const MULT = 4391, INC = 277, MOD = 32779, OUTMOD = 255;
const CUSTOM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.';
const REV = {}; for (let i = 0; i < CUSTOM.length; i++) REV[CUSTOM[i]] = i;
function b64urlDecode(str) {
  const o = [];
  for (let i = 0; i < str.length; i += 4) {
    const a = REV[str[i]], b = REV[str[i + 1]], c = REV[str[i + 2]], d = REV[str[i + 3]];
    if (a === undefined || b === undefined) break;
    o.push((a << 2) | (b >> 4));
    if (c !== undefined && str[i + 2] !== '.') o.push(((b & 15) << 4) | (c >> 2));
    if (d !== undefined && str[i + 3] !== '.') o.push(((c & 3) << 6) | d);
  }
  return Buffer.from(o);
}
function keystream(key, n) { let s = key | 0; const out = new Uint8Array(n); for (let i = 0; i < n; i++) { s = (MULT * s + INC) % MOD; out[i] = s % OUTMOD; } return out; }

// parse protobuf en profondeur (tolère padding), retourne octets consommés + nb champs
function parseDepth(b, maxfield) {
  let p = 0, count = 0;
  while (p < b.length) {
    const start = p;
    let tag = 0, sh = 0, tb; do { if (p >= b.length) break; tb = b[p++]; tag |= (tb & 0x7f) << sh; sh += 7; } while (tb & 0x80 && sh < 35);
    const field = tag >>> 3, wire = tag & 7;
    if (field < 1 || field > maxfield) return { bytes: start, count };
    if (wire === 0) { let vb; do { if (p >= b.length) return { bytes: start, count }; vb = b[p++]; } while (vb & 0x80); }
    else if (wire === 2) { let len = 0, s2 = 0, lb; do { if (p >= b.length) return { bytes: start, count }; lb = b[p++]; len |= (lb & 0x7f) << s2; s2 += 7; } while (lb & 0x80 && s2 < 35); if (p + len > b.length) return { bytes: start, count }; p += len; }
    else if (wire === 1) { if (p + 8 > b.length) return { bytes: start, count }; p += 8; }
    else if (wire === 5) { if (p + 4 > b.length) return { bytes: start, count }; p += 4; }
    else return { bytes: start, count };
    count++;
  }
  return { bytes: p, count };
}

const j = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'last_field16.json'), 'utf8'));
const raw = b64urlDecode(j.field16.slice(1));  // XOR : pas de seed à retirer, longueur = plaintext
const n = raw.length;
console.log('ciphertext', n, 'octets. brute-force XOR key ∈ [0,', MOD, ')');

let best = null;
for (let key = 0; key < MOD; key++) {
  const ks = keystream(key, n);
  const b = Buffer.alloc(n);
  for (let i = 0; i < n; i++) b[i] = raw[i] ^ ks[i];
  const d = parseDepth(b, 2100);
  if (!best || d.bytes > best.d.bytes) best = { key, b, d };
}
console.log(`MEILLEUR key=${best.key} : parse ${best.d.bytes}/${n} (${(100 * best.d.bytes / n).toFixed(1)}%), ${best.d.count} champs`);
fs.writeFileSync(path.join(__dirname, 'field16_plain.bin'), best.b);
console.log('head hex:', best.b.subarray(0, 48).toString('hex'));
console.log('tail hex:', best.b.subarray(n - 24).toString('hex'));
// aperçu texte des zones imprimables
const s = best.b.toString('latin1');
const strs = s.match(/[\x20-\x7e]{5,}/g) || [];
console.log('chaînes imprimables (5+):', strs.slice(0, 30).map(x => JSON.stringify(x)).join(' '));
