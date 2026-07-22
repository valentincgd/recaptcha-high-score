'use strict';
/**
 * capture_bloom.js — field16 = BLOOM FILTER (classe Ot). Capture les valeurs ajoutées (Ot.add(q)),
 * les params (bits, k), et l'output toString pour confirmer == field16.
 */
const fs = require('fs');
const path = require('path');
const SD = path.join(__dirname, '..', 'scripts');
let s = fs.readFileSync(path.join(SD, 'recaptcha_pretty.js'), 'utf8');

// hook add : capturer q (+ this.D.length une fois)
const ADD = 'Ot.prototype).add = function (q, r, w, D, d, A, x, N, C, p) {';
if (!s.includes(ADD)) { console.error('needle add introuvable'); process.exit(1); }
s = s.replace(ADD, ADD + " try{if(typeof self!=='undefined'&&self.__bloomAdd)self.__bloomAdd(q,this.D&&this.D.length);}catch(_e){}");
// hook toString : capturer la sortie (this.P + U)
const TS = 'this).P + U;';
if (!s.includes(TS)) { console.error('needle toString introuvable'); process.exit(1); }
s = s.replace(TS, "this).P + ((typeof self!=='undefined'&&self.__bloomOut&&self.__bloomOut(this.P+U, Array.prototype.slice.call(this.D), this.P, (M5&&M5.join?M5.join(''):String(M5)))),U);");
fs.writeFileSync(path.join(SD, 'recaptcha_hooked.js'), s);
console.error('→ recaptcha_hooked.js (hooks bloom injectés)');

process.env.RC_SCRIPT_FILE = 'recaptcha_hooked.js';
process.env.RC_NO_FETCH = '1'; process.env.RC_TLS = '0'; process.env.RC_QUIET = '1';

const adds = []; const outs = []; let realD = null, realP = null, realM5 = null;
global.__bloomAdd = function (q, dlen) { try { adds.push({ v: String(q), dlen }); } catch (_) {} };
global.__bloomOut = function (o, D, P, M5) { try { outs.push(String(o)); if (D) { realD = D; realP = P; realM5 = M5; } } catch (_) {} };

(async () => {
  const { run } = require('../field16_jsdom.js');
  const r = await run({ timeout: 45000 }).catch((e) => ({ err: e.message }));
  const f16 = (r && r.field16) || '';
  console.log('FIELD16 len:', f16.length, 'début:', f16.slice(0, 24));
  console.log('Ot.add appels:', adds.length, '| toString outputs:', outs.length);
  if (adds.length) console.log('bit array (this.D.length octets):', adds[0].dlen, '→', adds[0].dlen * 8, 'bits');
  const match = outs.find((o) => o === f16);
  console.log(match ? '\n✅ Ot.toString() == field16 CONFIRMÉ (bloom filter)' : '\n❌ aucun output == field16 (outputs: ' + outs.map((o) => o.length).join(',') + ')');
  // ── REPRODUCTION du bloom filter ──
  function hs(str, seed) { let h = seed | 0; for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0; return h; }
  if (realD) {
    const bits = realD.length;
    // essayer plusieurs hypothèses (seed hashString(v,0)|(v,seedvar), k=13, mod=22480 vs bits*8)
    for (const seedArg of [0]) for (const k of [13]) for (const mod of [22480, realD.length * 8]) {
      const D = new Uint8Array(realD.length);
      for (const a of adds) {
        let lcg = Math.abs(hs(a.v, seedArg)) >>> 0;
        for (let j = 0; j < k; j++) {
          lcg = (Math.imul(1664525, lcg) + 1013904223) >>> 0;
          const N = lcg % mod;
          D[N >> 3] |= 1 << (N & 7);
        }
      }
      let same = 0; for (let i = 0; i < realD.length; i++) if ((D[i] & 255) === (realD[i] & 255)) same++;
      const setReal = realD.reduce((s, b) => s + (b & 255 ? 1 : 0), 0), setMine = D.reduce((s, b) => s + (b ? 1 : 0), 0);
      console.log(`repro seedArg=${seedArg} k=${k} mod=${mod}: octets identiques ${same}/${realD.length} | bits set réel=${setReal} mien=${setMine}`);
    }
  }
  console.log('M5 alphabet:', JSON.stringify(realM5), '| P prefix:', JSON.stringify(realP));
  fs.writeFileSync(path.join(SD, 'bloom_adds.json'), JSON.stringify(adds.map((a) => a.v)));
  fs.writeFileSync(path.join(SD, 'bloom_out.json'), JSON.stringify({ field16: f16, outputs: outs, realD, realP, realM5 }));
  console.log('\n✔ → scripts/bloom_adds.json, bloom_out.json');
  process.exit(0);
})();
