'use strict';
/**
 * capture_dsc.js — capture deriveSignalCode EXACT : (value w, arg r, seed D → output t).
 * Patche le finalizer (ligne ~5180 : d=hashString(w,D)|r ; d=(d>>16^d)*C ×2 ; t=d>>16^d).
 */
const fs = require('fs');
const path = require('path');
const SD = path.join(__dirname, '..', 'scripts');
const pretty = fs.readFileSync(path.join(SD, 'recaptcha_pretty.js'), 'utf8');

const NEEDLE = 'd = (d >> 16 ^ d) * 2642172555, t = d >> 16 ^ d';
if (!pretty.includes(NEEDLE)) { console.error('needle finalizer introuvable'); process.exit(1); }
const HOOK = 'd = (d >> 16 ^ d) * 2642172555, t = (d >> 16 ^ d), (function(){try{if(typeof self!==\'undefined\'&&self.__dsc)self.__dsc(w,r,D,t);}catch(_e){}})()';
fs.writeFileSync(path.join(SD, 'recaptcha_hooked.js'), pretty.replace(NEEDLE, HOOK));
console.error('→ recaptcha_hooked.js écrit (hook dsc injecté)');

process.env.RC_SCRIPT_FILE = 'recaptcha_hooked.js';
process.env.RC_NO_FETCH = '1';
process.env.RC_TLS = process.env.RC_TLS || '0';
process.env.RC_QUIET = '1';

const caps = [];
global.__dsc = function (w, r, D, t) {
  try { caps.push({ v: String(w), r: (r | 0), D: (D | 0), t: (t | 0) }); } catch (_) {}
};

(async () => {
  const { run } = require('../field16_jsdom');
  let res;
  try { res = await run({ timeout: Number(process.env.RC_TIMEOUT) || 45000 }); }
  catch (e) { console.error('run err:', e.message); }
  console.log('\n════ CAPTURE deriveSignalCode : ' + caps.length + ' appels ════');
  console.log('field16:', res && res.field16 ? 'len=' + res.field16.length : '(aucun)');
  // vérifie que t = fmix(hashString(v, D)|r) reproduit exactement
  function hs(str, seed) { let h = seed | 0; for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0; return h; }
  function fmix(h) { h = Math.imul((h >> 16 ^ h), 2642172555) | 0; h = Math.imul((h >> 16 ^ h), 2642172555) | 0; return (h >> 16 ^ h) | 0; }
  let ok = 0, bad = 0, ex = [];
  const rset = new Set(), Dset = new Set();
  for (const c of caps) {
    rset.add(c.r); Dset.add(c.D);
    const calc = fmix((hs(c.v, c.D) | c.r) | 0);
    if (calc === c.t) ok++; else { bad++; if (ex.length < 6) ex.push(`v=${JSON.stringify(c.v).slice(0, 16)} r=${c.r} D=${c.D} attendu=${c.t} calc=${calc}`); }
  }
  console.log(`fmix(hashString(v,D)|r) : ${ok}/${ok + bad} OK`);
  console.log('r distincts:', [...rset].slice(0, 8), '| D distincts:', [...Dset].slice(0, 8));
  if (bad) { console.log('échecs:'); ex.forEach(e => console.log('  ' + e)); }
  fs.writeFileSync(path.join(SD, 'dsc_exact.json'), JSON.stringify(caps));
  try { fs.writeFileSync(path.join(SD, 'dsc_field16.json'), JSON.stringify({ field16: (res && res.field16) || '' })); } catch (_) {}
  console.log('exemples:', caps.slice(0, 4).map(c => `"${c.v.slice(0, 10)}"→${c.t}`).join(' '));
  console.log('→ scripts/dsc_exact.json');
  process.exit(0);
})();
