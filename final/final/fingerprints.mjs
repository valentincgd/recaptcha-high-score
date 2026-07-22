/**
 * fingerprints.mjs — charge fingerprints.json et en tire UN profil au hasard À CHAQUE APPEL.
 *
 * Chaque profil est 100% complet (UA, platform, langue, écran, devicePixelRatio, WebGL
 * vendor/renderer/extensionCount, title, inputIds). Un léger jitter (scroll, localStorage)
 * est ajouté pour que deux appels sur le même profil ne soient pas bit-à-bit identiques.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const ROOT = dirname(fileURLToPath(import.meta.url));

let _profiles = null;
export function loadProfiles() {
  if (!_profiles) {
    _profiles = JSON.parse(readFileSync(join(ROOT, "fingerprints.json"), "utf8")).profiles;
    if (!Array.isArray(_profiles) || _profiles.length === 0) {
      throw new Error("fingerprints.json vide ou invalide");
    }
  }
  return _profiles;
}

/** Retourne un entier aléatoire cryptographiquement fort dans [0, n). */
function randInt(n) {
  return randomBytes(4).readUInt32BE(0) % n;
}

/**
 * Tire un profil au hasard (copie profonde + jitter léger). Appel suivant = potentiellement
 * un autre profil. Passer `id` pour forcer un profil précis.
 */
export function pickFingerprint({ id = null, country = null } = {}) {
  const profiles = loadProfiles().filter((p) => p.id !== "empty");
  let pool = profiles;
  // country : sélectionne un profil dont la locale/timezone matche le PAYS DE L'IP (proxy) → cohérence
  // tz↔IP↔locale (sinon tell : navigateur US depuis IP FR). Fallback sur tout le pool si aucun match.
  if (country) {
    const c = String(country).toUpperCase();
    const matched = profiles.filter((p) => p.country === c);
    if (matched.length) pool = matched;
  }
  const base = id
    ? profiles.find((p) => p.id === id) ?? pool[randInt(pool.length)]
    : pool[randInt(pool.length)];

  const fp = JSON.parse(JSON.stringify(base)); // copie profonde
  fp.scrollY = (fp.scrollY ?? 0) + randInt(60);
  fp.localStorageLength = (fp.localStorageLength ?? 0) + randInt(6);
  return fp;
}

/** Déduit le code pays (US/FR/GB/DE/CA/JP) depuis une URL de proxy (packetstream `_country-France`, ou
 *  `-cc-fr`, etc.). Retourne null si indéterminable → laisse le pool complet. */
export function countryFromProxy(proxy) {
  if (!proxy) return null;
  const s = String(proxy).toLowerCase();
  const map = { france: "FR", "united-kingdom": "GB", unitedkingdom: "GB", germany: "DE", canada: "CA", japan: "JP", unitedstates: "US", "united-states": "US", us: "US", usa: "US" };
  for (const [k, v] of Object.entries(map)) if (s.includes(k)) return v;
  const m = s.match(/(?:country|_cc|-cc|region)[-_=]([a-z]{2})\b/);
  if (m) return m[1].toUpperCase();
  return null;
}

export function listProfileIds() {
  return loadProfiles().map((p) => p.id);
}
