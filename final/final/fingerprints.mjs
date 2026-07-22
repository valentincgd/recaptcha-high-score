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
export function pickFingerprint({ id = null } = {}) {
  const profiles = loadProfiles();
  const base = id
    ? profiles.find((p) => p.id === id) ?? profiles[randInt(profiles.length)]
    : profiles[randInt(profiles.length)];

  const fp = JSON.parse(JSON.stringify(base)); // copie profonde
  fp.scrollY = (fp.scrollY ?? 0) + randInt(60);
  fp.localStorageLength = (fp.localStorageLength ?? 0) + randInt(6);
  return fp;
}

export function listProfileIds() {
  return loadProfiles().map((p) => p.id);
}
