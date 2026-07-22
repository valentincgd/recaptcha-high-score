/**
 * Field22Bloom — génère le champ 22 du /reload reCAPTCHA (Bloom filter d'énumération d'environnement).
 * Reversé EXACT (vérifié 2810/2810 octets contre le vrai script). Voir mémoire field22-bloom-cracked.
 *
 * Algo (classe Ot du script) :
 *   - bit array = 22480 bits (2810 octets)
 *   - par valeur : seed = Math.abs(hashString(value)) ; LCG(mult=1664525, incr=1013904223, mod=2^32) ;
 *     13 hachages → bit N = lcg % 22480 → set.
 *   - sortie = "B" + base64(bit array, alphabet standard +/, SANS padding).
 */
const BITS = 22480;
const BYTES = 2810; // 22480 / 8
const HASHES = 13;
const LCG_MULT = 1664525;
const LCG_INCR = 1013904223;
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const PREFIX = "B";

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return h;
}

function base64NoPad(bytes) {
  let out = "", i = 0;
  const n = bytes.length, tail = n % 3, end = n - tail;
  for (; i < end; i += 3) {
    const w = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(w >> 18) & 63] + B64[(w >> 12) & 63] + B64[(w >> 6) & 63] + B64[w & 63];
  }
  if (tail === 1) { const w = bytes[i]; out += B64[(w & 252) >> 2] + B64[(w & 3) << 4]; }
  else if (tail === 2) { const w = (bytes[i] << 8) | bytes[i + 1]; out += B64[(w & 64512) >> 10] + B64[(w & 1008) >> 4] + B64[(w & 15) << 2]; }
  return out;
}

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __d22 = dirname(fileURLToPath(import.meta.url));
let _globals = null;
function globals() { if (!_globals) _globals = JSON.parse(readFileSync(join(__d22, "field22_globals.json"), "utf8")); return _globals; }

export class Field22Bloom {
  /** @param {string[]} values  liste ordonnée des noms d'énumération d'environnement (~319). */
  static build(values) {
    const D = new Uint8Array(BYTES);
    for (const v of values) {
      let lcg = Math.abs(hashString(String(v))) >>> 0;
      for (let k = 0; k < HASHES; k++) {
        lcg = (Math.imul(LCG_MULT, lcg) + LCG_INCR) >>> 0;
        const N = lcg % BITS;
        D[N >> 3] |= 1 << (N & 7);
      }
    }
    return PREFIX + base64NoPad(D);
  }

  /**
   * Bloom COHÉRENT avec la session : globals statiques (310, browser-consistants) + valeurs
   * session-spécifiques du SessionState (widget id, g-recaptcha-response-<counter>, t1-t6, be).
   * @param {SessionState} session
   */
  static buildCoherent(session) {
    const sess = session && typeof session.field22SessionValues === "function" ? session.field22SessionValues() : [];
    return Field22Bloom.build([...globals(), ...sess]);
  }
}
