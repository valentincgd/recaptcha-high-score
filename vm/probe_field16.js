'use strict';
// Sonde structurelle du vrai champ 16 accepté (scripts/last_field16.json).
const fs = require('fs');
const path = require('path');

const CUSTOM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.';
const REV = {}; for (let i = 0; i < CUSTOM.length; i++) REV[CUSTOM[i]] = i;

function customB64Decode(str) {
  const out = [];
  for (let i = 0; i < str.length; i += 4) {
    const c0 = REV[str[i]], c1 = REV[str[i + 1]], c2 = REV[str[i + 2]], c3 = REV[str[i + 3]];
    if (c0 === undefined || c1 === undefined) break;
    out.push((c0 << 2) | (c1 >> 4));
    if (c2 !== undefined && str[i + 2] !== '.') out.push(((c1 & 15) << 4) | (c2 >> 2));
    if (c3 !== undefined && str[i + 3] !== '.') out.push(((c2 & 3) << 6) | c3);
  }
  return Buffer.from(out);
}

const j = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'last_field16.json'), 'utf8'));
const f16 = j.field16;
console.log('field16 len (chars):', f16.length);
console.log('prefix 8:', JSON.stringify(f16.slice(0, 8)));

// Hypothèse A : tout est custom-b64 (y compris le "0" initial).
const rawA = customB64Decode(f16);
console.log('\n[A] custom-b64 decode complet →', rawA.length, 'octets. head hex:', rawA.subarray(0, 24).toString('hex'));

// Hypothèse B : le 1er caractère "0" est un préfixe de version, le reste est custom-b64.
const rawB = customB64Decode(f16.slice(1));
console.log('[B] skip "0" puis custom-b64 →', rawB.length, 'octets. head hex:', rawB.subarray(0, 24).toString('hex'));

// Cherche le framing de chunks 0x62 len_lo len_hi dans les deux.
function scanChunks(buf, label) {
  let p = 0, chunks = [], ok = true;
  while (p + 3 <= buf.length) {
    if (buf[p] !== 0x62) { ok = false; break; }
    const len = buf[p + 1] | (buf[p + 2] << 8);
    if (p + 3 + len > buf.length) { ok = false; break; }
    chunks.push({ off: p, len });
    p += 3 + len;
  }
  console.log(`\n[${label}] framing 0x62: ${ok && p === buf.length ? 'OUI' : 'non'} — ${chunks.length} chunks, consommé ${p}/${buf.length}`);
  if (chunks.length) console.log('  tailles chunks:', chunks.slice(0, 30).map(c => c.len).join(','), chunks.length > 30 ? '…' : '');
  return ok && p === buf.length ? chunks : null;
}
scanChunks(rawA, 'A');
scanChunks(rawB, 'B');

// Est-ce que ça finit par une graine 4 octets plausible (blob unique) ? montre la queue.
console.log('\n[A] tail hex:', rawA.subarray(rawA.length - 12).toString('hex'));
console.log('[B] tail hex:', rawB.subarray(rawB.length - 12).toString('hex'));
