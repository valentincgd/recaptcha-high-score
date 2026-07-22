/**
 * Field16Builder — assemble un champ 16 /reload COMPLET en pur Node (sans jsdom/navigateur).
 *
 * Le field16 = Field16Cipher.encrypt(JSON.stringify(tableau de 79 slots)).
 * Chaque triple = [prefix + valeurChiffrée, cléNonce, timing] où :
 *   - prefix "b" = valeur chiffrée via PerSignalCipher (XOR keystream g37) ; "C" = valeur en clair.
 *   - cléNonce = nonce transmis (string), généré librement, sert de clé au cipher par-signal.
 *   - timing = ms écoulées depuis le chargement (echelle relative).
 *
 * Repose sur field16_template.json (capture réelle décryptée) : les slots CONSTANTS (header,
 * bloc fingerprint 27-38) sont rejoués verbatim ; les slots DYNAMIQUES sont régénérés.
 *
 * Tout le crypto est byte-exact vérifié (Field16Cipher, PerSignalCipher). Voir REVERSE.md.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { Field16Cipher } from "./Field16Cipher.js";
import { encryptSignal, decryptSignal } from "./PerSignalCipher.js";

const __dir = dirname(fileURLToPath(import.meta.url));

/** RNG simple (remplaçable par un PRNG seedé pour repro). */
function rnd(n) { return Math.floor(Math.random() * n); }
function randHex(len) { let s = ""; while (s.length < len) s += rnd(16).toString(16); return s.slice(0, len); }
/** ID base36 style "Ck5m7qkez9uq1" (13 chars minuscules+chiffres). */
function randId36(len = 13) {
  const A = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = ""; for (let i = 0; i < len; i++) s += A[rnd(A.length)];
  return s;
}
/** Nonce numérique (comme 1524963543) ou petit (comme 3837). */
function randNumKey(big) { return big ? (100000000 + rnd(1900000000)) : (1500 + rnd(2400)); }
/** ID de session base36 minuscule (comme "suynk2v7shwr"). */
function randB36(len) {
  const A = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = ""; for (let i = 0; i < len; i++) s += A[rnd(A.length)];
  return s;
}
/** Détecte une valeur "C" = base64 d'un ID session base36 (10-15 chars) → renvoie sa longueur, sinon 0. */
function sessionIdLen(cVal) {
  try {
    const d = Buffer.from(cVal, "base64").toString("utf8");
    if (/^[a-z0-9]{10,15}$/.test(d)) return d.length;
  } catch (_) {}
  return 0;
}
/** userAgentData (slot 72) depuis un profil : [[brands],mobile,platform]. */
function uaDataFromProfile(profile) {
  const ua = profile?.userAgent || "";
  const m = ua.match(/Chrome\/(\d+)/);
  const major = m ? m[1] : "150";
  const plat = /Win/i.test(profile?.platform || ua) ? "Windows"
    : /Mac/i.test(profile?.platform || ua) ? "macOS"
    : /Linux/i.test(profile?.platform || ua) ? "Linux" : "Windows";
  return [[["Not;A=Brand", "8"], ["Chromium", major], ["Google Chrome", major]], 0, plat];
}

export class Field16Builder {
  /**
   * @param {object} [template]  {slots, meta} ; par défaut charge field16_template.json.
   */
  constructor(template) {
    this.tpl = template || JSON.parse(readFileSync(join(__dir, "field16_template.json"), "utf8"));
  }

  /**
   * Reconstruit un field16 à partir du template.
   * @param {object} opts
   *   opts.refreshKeys  {boolean} régénérer les nonces des triples "b" à grande clé (défaut true)
   *   opts.refreshTimings {boolean} appliquer un jitter aux timings (défaut true)
   *   opts.jitter {number} amplitude du jitter timing en ms (défaut 30)
   *   opts.DC {number} clé session pour le cipher externe (défaut Date.now())
   * @returns {string} field16
   */
  build(opts = {}) {
    // RC_F16_VERBATIM=1 : rejoue le template SANS aucune régénération (= sortie jsdom exacte). Debug.
    if (process.env.RC_F16_VERBATIM === "1") {
      return Field16Cipher.encrypt(JSON.stringify(this.tpl.slots), opts.DC ?? Date.now());
    }
    const {
      refreshKeys = true, refreshTimings = true, jitter = 30, DC = Date.now(),
      refreshSessionIds = true, // régénérer les 21 IDs de session (→ chaque token = session distincte)
      profile = null,           // profil fingerprint (fingerprints.json) → userAgentData cohérent
    } = opts;
    const slots = JSON.parse(JSON.stringify(this.tpl.slots)); // deep copy

    for (let i = 0; i < slots.length; i++) {
      const e = slots[i];
      // slot 4 : id 4-hex aléatoire (nonce)
      if (i === 4 && typeof e === "string" && /^[0-9a-f]{4}$/.test(e)) { slots[i] = randHex(4); continue; }
      // slot 64 : compteur ~ (léger jitter)
      if (i === 64 && typeof e === "number" && e > 100) { slots[i] = e + rnd(400) - 200; continue; }
      // slot 72 : userAgentData ← cohérent avec le profil
      if (profile && Array.isArray(e) && Array.isArray(e[0]) && Array.isArray(e[0][0])) {
        slots[i] = uaDataFromProfile(profile); continue;
      }

      if (Array.isArray(e) && e.length === 3 && typeof e[0] === "string") {
        const pfx = e[0][0];
        let key = e[1];
        // timing : jitter léger si non nul
        if (refreshTimings && typeof e[2] === "number" && e[2] > 0) {
          slots[i][2] = e[2] + rnd(jitter);
        }
        if (pfx === "C") {
          // valeur en clair : si c'est un ID de session (base64 d'un base36), en régénérer un frais
          if (refreshSessionIds) {
            const L = sessionIdLen(e[0].slice(1)); // enlève le préfixe "C"
            if (L) slots[i][0] = "C" + Buffer.from(randB36(L), "utf8").toString("base64");
          }
          continue;
        }
        if (pfx === "b") {
          // triple chiffré : déchiffrer avec la clé du template, re-chiffrer avec (option) une clé fraîche
          let val;
          try { val = decryptSignal(e[0], key); } catch (_) { val = null; }
          if (val == null) continue; // laisser tel quel si indéchiffrable (signal device opaque)
          const bigKey = typeof key === "number" ? key > 1e7 : (typeof key === "string" && /^\d{7,}$/.test(key));
          if (refreshKeys && bigKey) key = randNumKey(true);
          slots[i][0] = encryptSignal(val, key);
          slots[i][1] = key;
        }
      }
    }
    return Field16Cipher.encrypt(JSON.stringify(slots), DC);
  }

  /** Déchiffre un field16 en son tableau de slots (brute-force de la clé externe). */
  static decode(field16) {
    // brute-force (d+A) mod 256 via préfixe connu
    const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const bytes = Buffer.from(field16.slice(1).replace(/-/g, "+").replace(/_/g, "/"), "base64");
    const A = bytes[0], len = bytes.length - 1;
    for (let k = 0; k < 256; k++) {
      const D = Buffer.alloc(len);
      for (let i = 0; i < len; i++) D[i] = (((bytes[i + 1] - len - k * (i + A)) % 256) + 256) % 256;
      const s = D.toString("utf8");
      if (s.startsWith("[null,null")) return JSON.parse(s);
    }
    return null;
  }
}
