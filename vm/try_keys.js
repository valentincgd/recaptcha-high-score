'use strict';
// Déchiffrement DIRECT du vrai champ 16 avec des clés candidates connues (pas de brute-force).
const fs = require('fs'), path = require('path');
const { decryptSignal } = require('./encrypt_signal.js');
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
const j = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'last_field16.json'), 'utf8'));
const raw = customB64Decode(j.field16.slice(1));
console.log('blob', raw.length, 'octets, seed', raw.subarray(raw.length - 4).toString('hex'));

const keys = [-357264688, 357264688, -1819868614, -940896859, -1194504381, 1777669303203 | 0];
const sigKeys = [73, 18, 31, 0];
function score(buf) { let pr = 0; for (const b of buf) if ((b >= 0x20 && b < 0x7f) || (b >= 9 && b <= 13)) pr++; return pr / buf.length; }
for (const k of keys) for (const sk of sigKeys) {
  const bytes = Array.from(raw);
  const out = decryptSignal(bytes, k, sk);
  const b = Buffer.from(out, 'utf8');
  const sc = score(Buffer.from(out, 'latin1'));
  if (sc > 0.5) console.log(`encKey=${k} sigKey=${sk} printable=${(sc * 100).toFixed(0)}% head=${JSON.stringify(out.slice(0, 60))}`);
}
console.log('(seules les combos >50% imprimable sont affichées)');
