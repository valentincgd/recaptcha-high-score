'use strict';
const H = require('../scripts/hash_calls.json');
const HC = '0123456789abcdefghijklmnopqrstuvwxyz';
const isCode = s => s.length === 2 && HC.includes(s[0]) && HC.includes(s[1]);

const codes = [...new Set(H.filter(c => c.seed === 0 && isCode(c.in)).map(c => c.in))];
const hashes = [...new Set(H.filter(c => c.seed === 0 && c.in.length > 2).map(c => c.hash))];
console.log(`codes distincts: ${codes.length}   value-hashes distincts: ${hashes.length}`);

const u = h => h >>> 0;
const b36 = n => HC[Math.floor(n / 36) % 36] + HC[((n % 36) + 36) % 36];
// encodages candidats : hash -> string 2 chars
const ENC = {
  'mod1296→b36':        h => b36(((h % 1296) + 1296) % 1296),
  'u_mod1296→b36':      h => b36(u(h) % 1296),
  'last2(u.toString36)': h => { const s = u(h).toString(36); return s.slice(-2).padStart(2, '0'); },
  'first2(u.toString36)': h => { const s = u(h).toString(36); return s.slice(0, 2).padStart(2, '0'); },
  'last2(abs.toString36)': h => { const s = Math.abs(h).toString(36); return s.slice(-2).padStart(2, '0'); },
  '(u%36,u>>5%36)':     h => HC[u(h) % 36] + HC[(u(h) >>> 5) % 36],
  '(u>>5%36,u%36)':     h => HC[(u(h) >>> 5) % 36] + HC[u(h) % 36],
  'and2047→b36':        h => { const n = u(h) & 2047; return n < 1296 ? b36(n) : null; },
  'shortJavaHashMod':   h => b36(((h % 1296) + 1296) % 1296),  // dup ctrl
};
const hashSet = hashes;
for (const [name, fn] of Object.entries(ENC)) {
  let matched = 0; const hit = {};
  for (const code of codes) {
    for (const h of hashSet) { let e; try { e = fn(h); } catch (_) { e = null; } if (e === code) { matched++; hit[code] = h; break; } }
  }
  console.log(`  ${String(matched).padStart(2)}/${codes.length}  ${name}`);
}
