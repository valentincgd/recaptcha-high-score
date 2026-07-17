'use strict';
// Brute-force s0 en exigeant que le déchiffré soit un PROTOBUF binaire valide.
const fs = require('fs'), path = require('path');
const M = 94906238, MULT = 13558035, INC = 13037;
const CUSTOM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.';
const REV = {}; for (let i = 0; i < CUSTOM.length; i++) REV[CUSTOM[i]] = i;
function customB64Decode(str) {
  const out = [];
  for (let i = 0; i < str.length; i += 4) {
    const c0 = REV[str[i]], c1 = REV[str[i + 1]], c2 = REV[str[i + 2]], c3 = REV[str[i + 3]];
    if (c0 === undefined || c1 === undefined) break;
    out.push((c0 << 2) | (c1 >> 4));
    if (c2 !== undefined) out.push(((c1 & 15) << 4) | (c2 >> 2));
    if (c3 !== undefined) out.push(((c2 & 3) << 6) | c3);
  }
  return Buffer.from(out);
}
const mod256 = x => ((x % 256) + 256) % 256;

const j = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'last_field16.json'), 'utf8'));
const raw = customB64Decode(j.field16.slice(1));
const n = raw.length - 4;
const cipher = raw.subarray(0, n);

// Valide un préfixe protobuf sur les PROBE premiers octets déchiffrés (générés à la volée via keystream).
// Retourne true si on parse des champs valides couvrant >=MINCOV octets sans anomalie.
const PROBE = 272, MINCOV = 256;
function validPrefix(s0) {
  // génère PROBE octets
  let s = s0; const b = new Uint8Array(PROBE);
  for (let i = 0; i < PROBE; i++) { s = (s * MULT + INC) % M; b[i] = mod256(cipher[i] - s); }
  let p = 0;
  while (p < MINCOV) {
    // lire tag (varint, max 5 octets)
    let tag = 0, shift = 0, q = p, tb;
    do { if (q >= PROBE) return false; tb = b[q++]; tag |= (tb & 0x7f) << shift; shift += 7; } while (tb & 0x80 && shift < 35);
    const field = tag >>> 3, wire = tag & 7;
    if (field < 1 || field > 2200) return false;
    if (wire === 0) { let sh = 0, vb; do { if (q >= PROBE) return true; vb = b[q++]; sh += 7; } while (vb & 0x80 && sh < 70); p = q; }
    else if (wire === 2) { let len = 0, sh = 0, lb; do { if (q >= PROBE) return true; lb = b[q++]; len |= (lb & 0x7f) << sh; sh += 7; } while (lb & 0x80 && sh < 35); if (len > n) return false; p = q + len; }
    else if (wire === 1) p = q + 8;
    else if (wire === 5) p = q + 4;
    else return false;  // wire 3/4/6/7 improbable ici
  }
  return true;
}

console.log('brute-force protobuf, s0 ∈ [0,', M, ') ...');
const hits = [];
for (let s0 = 0; s0 < M; s0++) if (validPrefix(s0)) hits.push(s0);
console.log('candidats préfixe-protobuf:', hits.length);

// Full-parse des survivants
function fullParse(buf) {
  let p = 0, fields = [];
  while (p < buf.length) {
    let tag = 0, shift = 0, tb; do { if (p >= buf.length) return null; tb = buf[p++]; tag |= (tb & 0x7f) << shift; shift += 7; } while (tb & 0x80 && shift < 35);
    const field = tag >>> 3, wire = tag & 7; if (field < 1) return null;
    if (wire === 0) { let vb; do { if (p >= buf.length) return null; vb = buf[p++]; } while (vb & 0x80); fields.push({ field, wire }); }
    else if (wire === 2) { let len = 0, sh = 0, lb; do { if (p >= buf.length) return null; lb = buf[p++]; len |= (lb & 0x7f) << sh; sh += 7; } while (lb & 0x80); if (p + len > buf.length) return null; fields.push({ field, wire, len }); p += len; }
    else if (wire === 1) { p += 8; fields.push({ field, wire }); }
    else if (wire === 5) { p += 4; fields.push({ field, wire }); }
    else return null;
  }
  return fields;
}
for (const s0 of hits.slice(0, 20)) {
  let s = s0; const out = Buffer.alloc(n);
  for (let i = 0; i < n; i++) { s = (s * MULT + INC) % M; out[i] = mod256(cipher[i] - s); }
  const parsed = fullParse(out);
  console.log(`  s0=${s0} fullParse=${parsed ? 'OK (' + parsed.length + ' champs)' : 'NON'}`);
  if (parsed) {
    console.log('    champs:', parsed.slice(0, 20).map(f => `${f.field}/${f.wire}${f.len !== undefined ? '(' + f.len + ')' : ''}`).join(' '));
    fs.writeFileSync(path.join(__dirname, 'field16_plain.bin'), out);
    console.log('    → écrit vm/field16_plain.bin (', out.length, 'o). head hex:', out.subarray(0, 32).toString('hex'));
    break;
  }
}
