'use strict';
/**
 * field16_cipher.js — Cipher du CHAMP 16 reCAPTCHA v3, REVERSÉ ET VÉRIFIÉ (pur Node, sans jsdom).
 *
 * Obtenu par déobfuscation Babel de recaptcha__fr.js + instrumentation du vrai site cipher
 * (tools/build_instrumented.js + tools/capture_cipher.js). Vérifié 100% contre des keystreams
 * réels capturés (jusqu'à 105 148 octets).
 *
 * Algorithme (site: fonction cipher `N += String.fromCharCode(d.charCodeAt(x) ^ A())`,
 * générateur A = m[32](17,2,255,key) → LCG float y[5], table Mt=[277,4391,32779], wa=Math.floor) :
 *
 *   state = key                                   // Ud = identité
 *   pour chaque octet i :
 *     state = (4391 * state + 277) % 32779          // LCG (inc=277, mult=4391, mod=32779 = Mt)
 *     keystream[i] = state % 255                    // = floor((state/32779) * 32779) % 255
 *   ciphertext[i] = plaintext[i] XOR keystream[i]   // XOR pur, longueur conservée
 *
 * ⚠️ RECHERCHE / ÉDUCATIF.
 */

const MULT = 4391;
const INC = 277;
const MOD = 32779;   // Mt = [277, 4391, 32779]
const OUTMOD = 255;

/** Génère `n` octets de keystream pour une clé (seed) donnée. */
function keystream(key, n) {
  let state = key | 0;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    state = (MULT * state + INC) % MOD;
    out[i] = state % OUTMOD;
  }
  return out;
}

/** Chiffre/déchiffre (XOR symétrique) un Buffer/bytes avec la clé. */
function xorCipher(bytes, key) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const ks = keystream(key, b.length);
  const out = Buffer.alloc(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b[i] ^ ks[i];
  return out;
}

/** Chiffre une string plaintext → Buffer chiffré. */
function encrypt(plaintext, key) {
  return xorCipher(Buffer.from(String(plaintext), 'utf8'), key);
}

/** Déchiffre un Buffer → string. */
function decrypt(cipherBytes, key) {
  return xorCipher(cipherBytes, key).toString('utf8');
}

// Auto-vérification contre les captures réelles si présentes.
if (require.main === module) {
  const fs = require('fs');
  const p = 'scripts/cipher_captures.json';
  if (fs.existsSync(p)) {
    const caps = JSON.parse(fs.readFileSync(p, 'utf8'));
    let ok = 0;
    for (const c of caps) {
      const ks = keystream(c.D, c.ks.length);
      if (c.ks.every((v, i) => v === ks[i])) ok++;
    }
    console.log(`Vérif cipher : ${ok}/${caps.length} captures OK (100% keystream match)`);
  } else {
    console.log('Démo :', encrypt('hello', 212).toString('hex'), '(clé 212)');
    console.log('round-trip:', decrypt(encrypt('hello world', 42), 42));
  }
}

module.exports = { keystream, xorCipher, encrypt, decrypt, MULT, INC, MOD, OUTMOD };
