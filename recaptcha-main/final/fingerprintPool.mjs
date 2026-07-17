import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes } from "node:crypto";

const FINAL_ROOT = dirname(fileURLToPath(import.meta.url));
let catalog = null;

export function loadFingerprintCatalog() {
  if (!catalog) {
    const raw = readFileSync(join(FINAL_ROOT, "fingerprints.json"), "utf8");
    catalog = JSON.parse(raw).profiles;
  }
  return catalog;
}

/**
 * Profil aléatoire déterministe par seed + jitter léger (scroll, storage).
 */
export function pickFingerprint(seed = null) {
  const profiles = loadFingerprintCatalog();
  const seedStr =
    seed != null ? String(seed) : randomBytes(16).toString("hex");
  const h = createHash("sha256").update(seedStr).digest();
  const idx = h.readUInt32BE(0) % profiles.length;
  const base = { ...profiles[idx] };
  base.scrollY = (base.scrollY ?? 0) + (h[1] % 80);
  base.localStorageLength = (base.localStorageLength ?? 0) + (h[2] % 12);
  base._seed = seedStr.slice(0, 32);
  return base;
}

export function fingerprintToResponseData(fp, token) {
  return {
    accept_lang: fp.acceptLang,
    sec_ch_ua: fp.secChUa,
    sec_ch_ua_mobile: fp.secChUaMobile,
    sec_ch_ua_platform: fp.secChUaPlatform,
    token,
    user_agent: fp.userAgent,
  };
}
