'use strict';
// 1) Confirme le format field16 = "0" + customB64(bytes) par ré-encodage.
// 2) Brute-force la graine normalisée s0 ∈ [0,MOD) (≈95M) pour déchiffrer le blob et prouver
//    que le plaintext est le tableau JSON fingerprint (donc chiffrement = EncryptSignal signalKey=73).
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
function customB64Encode(buf) {
  let out = '';
  for (let i = 0; i < buf.length; i += 3) {
    const b0 = buf[i], b1 = i + 1 < buf.length ? buf[i + 1] : 0, b2 = i + 2 < buf.length ? buf[i + 2] : 0;
    out += CUSTOM[b0 >> 2] + CUSTOM[((b0 & 3) << 4) | (b1 >> 4)];
    if (i + 1 < buf.length) out += CUSTOM[((b1 & 15) << 2) | (b2 >> 6)];
    if (i + 2 < buf.length) out += CUSTOM[b2 & 63];
  }
  return out;
}
const nextLcg = s => (s * MULT + INC) % M;
const mod256 = x => ((x % 256) + 256) % 256;

const j = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'last_field16.json'), 'utf8'));
const f16 = j.field16;
const body = f16.slice(1);                 // on retire le préfixe "0"
const raw = customB64Decode(body);
const reenc = customB64Encode(raw);
console.log('format "0"+customB64 : ré-encodage == original ?', reenc === body ? '✔ OUI' : '✖ (diff)');
if (reenc !== body) {
  // localise la 1re divergence
  for (let i = 0; i < Math.max(reenc.length, body.length); i++) if (reenc[i] !== body[i]) { console.log('  1re diff @', i, JSON.stringify(body.slice(i, i + 8)), 'vs', JSON.stringify(reenc.slice(i, i + 8))); break; }
}
console.log('blob:', raw.length, 'octets. cipher =', raw.length - 4, ', seed(4o) =', raw.subarray(raw.length - 4).toString('hex'));
const n = raw.length - 4;
const cipher = raw.subarray(0, n);

// Brute-force s0 : filtre "N premiers octets tous ASCII imprimables" (JSON => printable).
const PROBE = 24;
const isPrint = b => (b >= 0x20 && b <= 0x7e) || (b >= 0x09 && b <= 0x0d);
console.log('\nbrute-force s0 ∈ [0,', M, ') filtre', PROBE, 'octets imprimables ...');
let found = [];
for (let s0 = 0; s0 < M; s0++) {
  let s = s0, ok = true;
  for (let i = 0; i < PROBE; i++) { s = (s * MULT + INC) % M; if (!isPrint(mod256(cipher[i] - s))) { ok = false; break; } }
  if (ok) found.push(s0);
}
console.log('candidats s0 (', PROBE, 'octets imprimables):', found.length);
for (const s0 of found) {
  let s = s0; const out = Buffer.alloc(n);
  for (let i = 0; i < n; i++) { s = (s * MULT + INC) % M; out[i] = mod256(cipher[i] - s); }
  const str = out.toString('utf8');
  const printable = out.every(b => b >= 9 && b < 127);
  let parsed = null; try { parsed = JSON.parse(str); } catch { }
  console.log(`  s0=${s0} allPrintable=${printable} json=${parsed ? 'VALIDE(len ' + parsed.length + ')' : 'non'} head=${JSON.stringify(str.slice(0, 70))}`);
  if (parsed) { fs.writeFileSync(path.join(__dirname, 'field16_plain.json'), JSON.stringify(parsed, null, 1)); console.log('    → écrit vm/field16_plain.json'); break; }
}
