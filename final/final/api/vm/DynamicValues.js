/**
 * DynamicValues — valeurs field16 dépendantes de la VERSION du script reCAPTCHA (calculées au runtime
 * par la VM : hash de son propre code + feature-detection), donc IMPOSSIBLES à extraire statiquement.
 * Le harvester (`spec_harvester.py`, nodriver, boucle 20 min) capture une référence genuine, déchiffre
 * son field16, extrait ces valeurs et les écrit dans `dynamic_spec.json`. Ce module les charge (avec
 * cache + reload à chaud toutes les N s) et fournit un FALLBACK figé si le cache est absent/périmé.
 *
 *   [31] bitfield features navigateur   (par version script + Chrome)
 *   [65] hash d'intégrité "sha384-…"    (par version script)
 *   [29] hash SHA-256 de grecaptcha.execute — PAR SITEKEY + version
 */
import { readFileSync, statSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = process.env.RC_DYNSPEC_FILE || join(__dir, "..", "..", "dynamic_spec.json");

// FALLBACK figé (dernière version connue A7KpaEAS…) si le harvester n'a pas encore tourné.
const FALLBACK = {
  version: "A7KpaEASfhDcK0nXxgQEyyYv",
  bitfield31: "BAAAAAAABA",
  sri65: "sha384-pCt",
  executeHash29: {
    "6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV": "202a957a", // XV (tmpt/event)
    "6LdoaXQrAAAAADQviABd-eByJu6kPL8awKDyc1zb": "e2b68587", // ZB (login)
  },
};

let _cache = null;
let _mtime = 0;
let _lastCheck = 0;

/** Recharge dynamic_spec.json à chaud (au plus une fois / 5 s), fallback figé si absent. */
function load() {
  const now = Date.now();
  if (_cache && now - _lastCheck < 5000) return _cache;
  _lastCheck = now;
  try {
    const st = statSync(CACHE_PATH);
    if (st.mtimeMs !== _mtime) {
      _cache = JSON.parse(readFileSync(CACHE_PATH, "utf8"));
      _mtime = st.mtimeMs;
    }
  } catch (_) {
    if (!_cache) _cache = FALLBACK;
  }
  return _cache || FALLBACK;
}

export const DynamicValues = {
  /** Bitfield features [31] pour la version courante. */
  bitfield31() { return load().bitfield31 || FALLBACK.bitfield31; },
  /** Hash d'intégrité [65] "sha384-…" pour la version courante. */
  sri65() { return load().sri65 || FALLBACK.sri65; },
  /** Hash execute [29] pour une sitekey donnée (fallback : 1re valeur connue). */
  executeHash29(siteKey) {
    const m = load().executeHash29 || FALLBACK.executeHash29;
    return m[siteKey] || FALLBACK.executeHash29[siteKey] || Object.values(m)[0] || FALLBACK.executeHash29["6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV"];
  },
  /** Version du script pour laquelle ces valeurs ont été capturées. */
  version() { return load().version || FALLBACK.version; },
  /** Âge (ms) de la dernière capture harvester (Infinity si jamais capturé). */
  ageMs() { const c = load(); return c.capturedAt ? Date.now() - c.capturedAt : Infinity; },
};
