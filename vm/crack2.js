'use strict';
// Brute-force décisif du vrai champ 16 : protobuf (champs top-level <=130, profondeur 200) + magies gzip/zlib.
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

const PROBE = 260, NEEDFIELDS = 6, MAXFIELD = 130;
function ks(s0, len) { let s = s0; const b = new Uint8Array(len); for (let i = 0; i < len; i++) { s = (s * MULT + INC) % M; b[i] = mod256(cipher[i] - s); } return b; }
// Préfixe valide : au moins NEEDFIELDS champs top-level (field<=MAXFIELD) parsés proprement dans PROBE octets.
function validProto(b) {
  let p = 0, count = 0;
  while (count < NEEDFIELDS) {
    let tag = 0, sh = 0, tb; do { if (p >= b.length) return false; tb = b[p++]; tag |= (tb & 0x7f) << sh; sh += 7; } while (tb & 0x80 && sh < 35);
    const field = tag >>> 3, wire = tag & 7;
    if (field < 1 || field > MAXFIELD) return false;
    if (wire === 0) { let vb; do { if (p >= b.length) return false; vb = b[p++]; } while (vb & 0x80); }
    else if (wire === 2) { let len = 0, s2 = 0, lb; do { if (p >= b.length) return false; lb = b[p++]; len |= (lb & 0x7f) << s2; s2 += 7; } while (lb & 0x80 && s2 < 35); if (len > n) return false; p += len; }
    else if (wire === 1) p += 8;
    else if (wire === 5) p += 4;
    else return false;
    count++;
  }
  return true;
}
// Parse COMPLET jusqu'à la fin exacte n.
function fullParse(b) {
  let p = 0; const fields = [];
  while (p < b.length) {
    let tag = 0, sh = 0, tb; do { if (p >= b.length) return null; tb = b[p++]; tag |= (tb & 0x7f) << sh; sh += 7; } while (tb & 0x80 && sh < 35);
    const field = tag >>> 3, wire = tag & 7; if (field < 1 || field > MAXFIELD) return null;
    if (wire === 0) { let vb, st = p; do { if (p >= b.length) return null; vb = b[p++]; } while (vb & 0x80); fields.push({ field, wire }); }
    else if (wire === 2) { let len = 0, s2 = 0, lb; do { if (p >= b.length) return null; lb = b[p++]; len |= (lb & 0x7f) << s2; s2 += 7; } while (lb & 0x80 && s2 < 35); if (p + len > b.length) return null; fields.push({ field, wire, len }); p += len; }
    else if (wire === 1) { p += 8; fields.push({ field, wire }); }
    else if (wire === 5) { p += 4; fields.push({ field, wire }); }
    else return null;
  }
  return fields;
}

const proto = [], gzip = [], zlib = [];
for (let s0 = 0; s0 < M; s0++) {
  let s = s0;
  s = (s * MULT + INC) % M; const b0 = mod256(cipher[0] - s);
  s = (s * MULT + INC) % M; const b1 = mod256(cipher[1] - s);
  if (b0 === 0x1f && b1 === 0x8b) { gzip.push(s0); continue; }
  if (b0 === 0x78 && (b1 === 0x01 || b1 === 0x9c || b1 === 0xda)) { zlib.push(s0); continue; }
  // filtre protobuf : b0 = tag valide (field<=MAXFIELD, wire ok)
  const wire0 = b0 & 7; if (wire0 !== 0 && wire0 !== 2 && wire0 !== 5 && wire0 !== 1) continue;
  if (b0 >= 0x80) continue; // exige tag 1 octet (field<=15) pour élaguer ; sinon trop de bruit
  const f0 = b0 >> 3; if (f0 < 1) continue;
  if (validProto(ks(s0, PROBE))) proto.push(s0);
}
console.log('gzip:', gzip.length, 'zlib:', zlib.length, 'proto-prefix(', NEEDFIELDS, 'champs):', proto.length);
// Score chaque survivant par PROFONDEUR de parse protobuf (tolère padding en queue).
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
let best = null;
for (const s0 of proto) {
  const b = Buffer.from(ks(s0, n));
  const d = parseDepth(b, 2100);
  if (!best || d.bytes > best.d.bytes) best = { s0, b, d };
}
if (best) {
  console.log(`\nMEILLEUR: s0=${best.s0} parse ${best.d.bytes}/${n} octets, ${best.d.count} champs top-level`);
  const covered = best.d.bytes / n;
  fs.writeFileSync(path.join(__dirname, 'field16_plain.bin'), best.b);
  console.log('  couverture', (covered * 100).toFixed(1) + '%  → écrit vm/field16_plain.bin');
  console.log('  head hex:', best.b.subarray(0, 48).toString('hex'));
  console.log('  tail hex:', best.b.subarray(n - 40).toString('hex'));
  if (covered > 0.85) console.log('  ✔ PROBABLE SOLUTION (couverture élevée, padding final toléré)');
  else console.log('  ⚠ couverture faible — pas concluant');
} else console.log('aucun survivant');
