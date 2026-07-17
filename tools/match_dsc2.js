'use strict';
const H = require('../scripts/hash_calls.json');
const HC = '0123456789abcdefghijklmnopqrstuvwxyz';
const isCode = s => s.length === 2 && HC.includes(s[0]) && HC.includes(s[1]);
const codes = [...new Set(H.filter(c => c.seed === 0 && isCode(c.in)).map(c => c.in))];
const hashes = [...new Set(H.filter(c => c.seed === 0 && c.in.length > 2).map(c => c.hash))];
const u = h => h >>> 0;
const b36 = n => HC[Math.floor(((n % 1296) + 1296) % 1296 / 36)] + HC[(((n % 36) + 36) % 36)];

const ENC = {};
// extraction 2 nibbles/bytes à divers décalages
for (const a of [0, 4, 5, 6, 7, 8, 10, 12, 16, 20, 24]) for (const b of [0, 4, 5, 6, 8, 10, 16, 24]) {
  if (a === b) continue;
  ENC[`slice36_${a}_${b}`] = h => HC[(u(h) >>> a) % 36] + HC[(u(h) >>> b) % 36];
}
// mixers puis mod1296
ENC['xorshift_mod'] = h => { let x = u(h); x ^= x >>> 16; return b36(x); };
ENC['mul_gold_mod'] = h => b36(Math.imul(u(h), 2654435761) >>> 0);
ENC['mul_gold_hi'] = h => { const v = Math.imul(u(h), 2654435761) >>> 0; return b36(v >>> 20); };
for (const p of [31, 37, 131, 1000003, 2654435761]) ENC[`mul${p}_mod`] = h => b36(Math.imul(u(h), p) >>> 0);
// toString36 windows
for (const off of [0, 1, 2, 3, -2, -3]) ENC[`ts36_${off}`] = h => { const s = u(h).toString(36).padStart(4, '0'); return off < 0 ? s.slice(off - 1, off + 1 || undefined) : s.slice(off, off + 2); };

let best = { n: 0 };
for (const [name, fn] of Object.entries(ENC)) {
  let matched = 0;
  for (const code of codes) { for (const h of hashes) { let e; try { e = fn(h); } catch (_) { } if (e === code) { matched++; break; } } }
  if (matched > best.n) best = { n: matched, name };
}
console.log(`codes=${codes.length} hashes=${hashes.length}  baseline chance≈${(codes.length * hashes.length / 1296 / codes.length * codes.length).toFixed(0) / codes.length | 0}`);
console.log(`chance attendue ≈ ${Math.round(codes.length * (1 - Math.pow(1 - 1 / 1296, hashes.length)))}/${codes.length}`);
console.log(`MEILLEUR : ${best.n}/${codes.length}  (${best.name})`);
// top 5
const all = Object.entries(ENC).map(([name, fn]) => { let m = 0; for (const code of codes) for (const h of hashes) { try { if (fn(h) === code) { m++; break; } } catch (_) { } } return { name, m }; }).sort((a, b) => b.m - a.m);
for (const r of all.slice(0, 6)) console.log(`   ${r.m}/${codes.length}  ${r.name}`);
