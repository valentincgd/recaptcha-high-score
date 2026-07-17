/**
 * oc_cipher.js — Chiffrement des signaux VM reCAPTCHA (champ `oc` / fingerprint Idx 73)
 *
 * ⚠️ USAGE ÉDUCATIF / RECHERCHE. Reconstruit par déobfuscation directe de
 *    recaptcha-vm/output/disassembled.txt (routine 0x0091b9 → 0x009493).
 *
 * ⚠️ CE N'EST PAS le cipher du CHAMP 16 (fingerprint principal) :
 *    - champ 16  : XOR par octet, PAS de seed ajouté, clés = deriveKey(31*c0+c1)  → JS, non capturé
 *    - oc/Idx 73 : ADDITIF + LCG + seed 4 octets ajouté, clés = clés VM (417,545,727…) → CE fichier
 *
 * Vérifie la structure de recaptcha-vm/src/encryption/mod.rs (identique).
 */

'use strict';

// Constantes lues dans le bytecode déobfusqué :
const M     = 94906238;    // R1454  (modulo LCG)
const MULT  = 13558035;    // R1846  (multiplicateur LCG)
const INC   = 13037;       // R1213  (incrément LCG)
const GOLD  = 2654435761;  // golden ratio (dérivation du nonce runtime)

// LCG : X[n+1] = (MULT*X[n] + INC) % M   (arithmétique 32-bit signée comme la VM)
function nextLcg(state) {
  // Math.imul pour rester en 32-bit signé comme le fait la VM
  return (((Math.imul(state, MULT) + INC) % M) + M) % M;
}

/**
 * Chiffre un signal VM.
 * @param {string} plaintext  valeur sérialisée (ex. '"Mozilla/5.0..."')
 * @param {number} encKey     clé de chiffrement (registre R586, ex. -940896859)
 * @param {number} signalKey  clé du signal (ex. 417, 545, 727…)
 * @param {number} [timestamp] Math.trunc(performance.now()) — injectable pour tests déterministes
 * @param {number} [bias=632] constante ajoutée au timestamp (632 ou 939 selon le signal)
 * @returns {number[]} octets chiffrés (data chiffrée + 4 octets de seed en big-endian)
 */
function encryptOcSignal(plaintext, encKey, signalKey, timestamp, bias = 632) {
  const ts = (timestamp === undefined) ? Math.trunc(performance.now()) : timestamp;
  const runtimeSeed = Math.imul((ts + bias) | 0, GOLD) | 0;      // (ts+bias)*GOLD
  const initState   = (encKey ^ signalKey) ^ runtimeSeed;       // state = (encKey^sigKey)^nonce

  const data = Array.from(Buffer.from(plaintext, 'utf8'));
  let state = (((initState % M) + M) % M);
  for (let i = 0; i < data.length; i++) {
    state = nextLcg(state);
    data[i] = (data[i] + state) % 256;                          // chiffrement ADDITIF
  }

  // append runtimeSeed sur 4 octets big-endian
  let seed = runtimeSeed >>> 0;
  const out = data.concat([0, 0, 0, 0]);
  for (let k = 0; k < 4; k++) {
    out[out.length - 1 - k] = seed % 256;
    seed = Math.floor(seed / 256);
  }
  return out;
}

/**
 * Déchiffre (le serveur fait pareil) : récupère le nonce dans les 4 derniers octets,
 * reconstruit l'état et inverse l'addition.
 */
function decryptOcSignal(bytes, encKey, signalKey) {
  const n = bytes.length - 4;
  const runtimeSeed =
    ((bytes[n] << 24) | (bytes[n + 1] << 16) | (bytes[n + 2] << 8) | bytes[n + 3]) | 0;
  const initState = (encKey ^ signalKey) ^ runtimeSeed;
  let state = (((initState % M) + M) % M);
  const out = [];
  for (let i = 0; i < n; i++) {
    state = nextLcg(state);
    out.push(((bytes[i] - state) % 256 + 256) % 256);
  }
  return Buffer.from(out).toString('utf8');
}

if (require.main === module) {
  const encKey = -940896859;   // R586
  const signalKey = 417;       // User-Agent (Key 417)
  const ts = 12345;            // timestamp figé pour test déterministe
  const ct = encryptOcSignal('"false"', encKey, signalKey, ts);
  console.log('chiffré :', ct);
  console.log('déchiffré:', decryptOcSignal(ct, encKey, signalKey));
  console.log('\nNB: ceci est le cipher oc/Idx73, PAS le champ 16 (voir en-tête).');
}

module.exports = { encryptOcSignal, decryptOcSignal, nextLcg, M, MULT, INC, GOLD };
