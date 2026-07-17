'use strict';
/**
 * capture_cipher.js — Instrumente le VRAI cipher champ 16 (via recaptcha_instrumented.js + self.__cc)
 * et logge chaque (plaintext, keystream, inputs clé w/r/D). But : reverser le générateur keystream.
 */
process.env.RC_CIPHER_CAP = '1';
process.env.RC_MODE = process.env.RC_MODE || 'enterprise';
process.env.RC_TLS = process.env.RC_TLS || '0';   // pas besoin du pont TLS pour capturer le cipher
process.env.RC_QUIET = '1';

const caps = [];
function safe(v) {
  const t = typeof v;
  if (t === 'number' || t === 'boolean') return v;
  if (t === 'string') return v.length > 60 ? v.slice(0, 60) + '…' : v;
  if (v == null) return null;
  return `[${t}]`;
}
global.__CIPHER_CAP = caps;
global.__cc = function (d, ks, w, r, D, genSrc, dispSrc) {
  try { caps.push({ pt: String(d), ks: Array.prototype.slice.call(ks), w: safe(w), r: safe(r), D: safe(D), gen: genSrc || '', disp: dispSrc || '' }); } catch (_) {}
};
// __cc2 : hashString(input, seed) → hash. Capture les paires pour reverser deriveSignalCode.
const hashCalls = [];
global.__CC2 = hashCalls;
global.__cc2 = function (input, seed, hash, stack) {
  try { hashCalls.push({ in: String(input), seed: seed | 0, hash: hash | 0, st: String(stack || '').split('\n').slice(1, 18).map(s => s.trim().replace(/^at\s+/, '').replace(/https?:\/\/[^)]*recaptcha__[a-z]+\.js/, 'SCRIPT')).join('\n') }); } catch (_) {}
};

(async () => {
  const { run } = require('../field16_jsdom');
  console.error('→ run() en cours (capture cipher)…');
  let res;
  try { res = await run({ timeout: Number(process.env.RC_TIMEOUT) || 45000 }); }
  catch (e) { console.error('run err:', e.message); }

  console.log('\n════════ CAPTURES CIPHER : ' + caps.length + ' appels ════════');
  console.log('token:', res && res.token ? res.token.slice(0, 24) + '…' : '(aucun)', ' field16:', res && res.field16 ? 'len=' + res.field16.length : '(aucun)');
  // n'affiche que les N premiers pour lisibilité + stats inputs
  const show = caps.slice(0, 30);
  for (const c of show) {
    console.log(`pt=${JSON.stringify(c.pt).slice(0, 30).padEnd(32)} w=${String(c.w).padStart(11)} r=${String(c.r).padStart(6)} D=${String(c.D).padStart(6)}  ks=[${c.ks.slice(0, 10).join(',')}${c.ks.length > 10 ? ',…' : ''}]`);
  }
  // sauvegarde complète pour analyse
  require('fs').writeFileSync('scripts/cipher_captures.json', JSON.stringify(caps, null, 1));
  console.log(`\n✔ ${caps.length} captures → scripts/cipher_captures.json`);
  // LE générateur keystream (source de la closure A) :
  if (caps[0] && caps[0].gen) {
    console.log('\n════════ SOURCE DU GÉNÉRATEUR KEYSTREAM (A) ════════');
    console.log(caps[0].gen);
    require('fs').writeFileSync('scripts/keystream_gen.txt', caps[0].gen + '\n\n===== DISPATCH m[32] =====\n' + (caps[0].disp || ''));
    console.log('(+ dispatch m[32] → scripts/keystream_gen.txt)');
  }
  // quelles valeurs distinctes pour w/r/D ? (identifier lequel est la clé)
  const uniq = (k) => [...new Set(caps.map(c => c[k]))].slice(0, 12);
  console.log('w distincts:', uniq('w'));
  console.log('r distincts:', uniq('r'));
  console.log('D distincts:', uniq('D'));

  // ── hashString (deriveSignalCode/deriveKey) ──
  require('fs').writeFileSync('scripts/hash_calls.json', JSON.stringify(hashCalls, null, 1));
  console.log(`\n════════ hashString : ${hashCalls.length} appels → scripts/hash_calls.json ════════`);
  // seeds distincts (identifie le seed de deriveSignalCode) :
  const seeds = [...new Set(hashCalls.map(c => c.seed))];
  console.log('seeds distincts:', seeds.slice(0, 10));
  // exemples courts (probables codes 2-char → deriveKey) et longs (valeurs → deriveSignalCode) :
  const shortIn = hashCalls.filter(c => c.in.length === 2 && c.seed === 0).slice(0, 6);
  console.log('deriveKey (in 2-char, seed 0):', shortIn.map(c => `"${c.in}"→${c.hash}`).join('  '));
  const longIn = hashCalls.filter(c => c.in.length > 2).slice(0, 10);
  console.log('deriveSignalCode candidats (in→hash, seed):');
  for (const c of longIn) console.log(`   in=${JSON.stringify(c.in).slice(0, 30).padEnd(32)} seed=${c.seed} hash=${c.hash}`);
  process.exit(0);
})();
