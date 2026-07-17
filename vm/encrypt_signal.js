'use strict';
/**
 * vm/encrypt_signal.js — Chiffrement d'un signal VM (champ 16 / Idx 73).
 * Port EXACT de recaptcha-vm/src/encryption/mod.rs (encrypt_signal_payload).
 *
 * Différences corrigées vs l'ancien oc_cipher.js :
 *   - next_lcg = (seed*MULT + INC) % M en arithmétique 64-bit (pas Math.imul 32-bit), signe conservé.
 *   - pas de forçage positif du keystream (Rust % garde le signe du dividende).
 *   - bias = 939 (constante d'origine).
 *   - runtime_seed = i32( (ts+939) * GOLDEN )  (troncature 32-bit).
 */
const M = 94906238, MULT = 13558035, INC = 13037;
const GOLD = 2654435761n;

// next_lcg : (seed*MULT + INC) % M. seed*MULT ≈ 1.28e15 < 2^53 → Number sûr. JS % garde le signe (comme Rust i64%).
function nextLcg(seed) { return (seed * MULT + INC) % M; }
function normalizeSeed(seed) { return ((seed % M) + M) % M; }
// (ts+939)*GOLDEN tronqué en i32 signé
function runtimeSeedFrom(ts) { return Number(BigInt.asIntN(32, BigInt((ts + 939) | 0) * GOLD)); }
function serializeSeedBE(rs) { return [(rs >> 24) & 0xff, (rs >> 16) & 0xff, (rs >> 8) & 0xff, rs & 0xff]; }
const mod256 = x => ((x % 256) + 256) % 256;

/**
 * @param {Buffer|number[]|string} plaintext  octets à chiffrer (utf8 si string)
 * @param {number} encKey     R586
 * @param {number} signalKey  clé du signal (417, 545, …)
 * @param {number} [timestamp] figé pour tests ; sinon aléatoire [0, 2^31)
 * @returns {number[]} octets chiffrés + 4 octets de seed (big-endian)
 */
function encryptSignal(plaintext, encKey, signalKey, timestamp) {
  const ts = (timestamp === undefined) ? (Math.floor(Math.random() * 0x7fffffff)) : (timestamp | 0);
  const runtimeSeed = runtimeSeedFrom(ts);
  const initialSeed = (runtimeSeed ^ (encKey ^ signalKey)) | 0;
  let data = Buffer.isBuffer(plaintext) ? Array.from(plaintext)
    : Array.isArray(plaintext) ? plaintext.slice()
      : Array.from(Buffer.from(String(plaintext), 'utf8'));
  if (data.length === 0) return serializeSeedBE(runtimeSeed);
  let seed = normalizeSeed(initialSeed);
  seed = nextLcg(seed);
  data[0] = mod256(data[0] + seed);
  for (let i = 1; i < data.length; i++) { seed = nextLcg(seed); data[i] = mod256(data[i] + seed); }
  return data.concat(serializeSeedBE(runtimeSeed));
}

function decryptSignal(bytes, encKey, signalKey) {
  if (bytes.length < 4) return '';
  const n = bytes.length - 4;
  const runtimeSeed = ((bytes[n] << 24) | (bytes[n + 1] << 16) | (bytes[n + 2] << 8) | bytes[n + 3]) | 0;
  const initialSeed = (runtimeSeed ^ (encKey ^ signalKey)) | 0;
  if (n === 0) return '';
  const out = Buffer.alloc(n);
  let seed = normalizeSeed(initialSeed);
  seed = nextLcg(seed);
  out[0] = mod256(bytes[0] - seed);
  for (let i = 1; i < n; i++) { seed = nextLcg(seed); out[i] = mod256(bytes[i] - seed); }
  return out.toString('utf8');
}

module.exports = { encryptSignal, decryptSignal, nextLcg, normalizeSeed, runtimeSeedFrom, M, MULT, INC };

if (require.main === module) {
  // Vecteur ground-truth README recaptcha-vm : encrypt("false", signalKey=123, encKey=-940896859)
  const signed = [151, 91, 101, 161, 128, -75, -180, -38, -218];
  const bytes = signed.map(b => ((b % 256) + 256) % 256);
  const pt = decryptSignal(bytes, -940896859, 123);
  console.log('vecteur README → déchiffré:', JSON.stringify(pt), pt === 'false' ? '✔ MATCH' : '✖');
  const rt = decryptSignal(encryptSignal('false', -940896859, 123, 12345), -940896859, 123);
  console.log('round-trip:', rt === 'false' ? '✔' : '✖');
}
