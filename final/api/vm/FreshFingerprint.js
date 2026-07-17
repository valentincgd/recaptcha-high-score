import { createHash } from "node:crypto";
import { FINGERPRINT_PROFILES } from "./BrowserSimulator.js";
import { isTicketmasterSiteKey } from "../TicketmasterProfile.js";

const PROFILE_IDS = Object.keys(FINGERPRINT_PROFILES);

/**
 * Profil navigateur régénéré à chaque session (pas de dump Chrome figé).
 * RECAPTCHA_FINGERPRINT_PROFILE=random|rotate|chrome_win_nvidia|…
 */
export function resolveFreshFingerprint({
  profileId = process.env.RECAPTCHA_FINGERPRINT_PROFILE,
  seed = null,
} = {}) {
  const seedStr =
    seed != null
      ? String(seed)
      : `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const h = createHash("sha256").update(seedStr).digest();

  let id = profileId ?? "random";
  if (id === "random" || id === "rotate") {
    id = PROFILE_IDS[h[0] % PROFILE_IDS.length];
  }
  const base = FINGERPRINT_PROFILES[id];
  if (!base) {
    return {
      ...FINGERPRINT_PROFILES.chrome_win_nvidia,
      id: "chrome_win_nvidia",
      _seed: seedStr.slice(0, 24),
    };
  }

  return {
    ...base,
    id: base.id ?? id,
    scrollY: (base.scrollY ?? 0) + (h[1] % 60),
    localStorageLength: (base.localStorageLength ?? 0) + (h[2] % 8),
    _seed: seedStr.slice(0, 24),
  };
}

/**
 * Une seule empreinte pour tout le flux (bootstrap, anchor, reload, simulateur).
 * Respecte RECAPTCHA_FINGERPRINT_PROFILE ou profil déjà sur cfg.fingerprint.
 */
export function bindFingerprintSession(cfg, { seed = null } = {}) {
  const existing = cfg.fingerprint;
  const profile =
    existing && typeof existing === "object" && existing.userAgent
      ? { ...existing }
      : resolveFreshFingerprint({
          profileId:
            typeof existing === "string"
              ? existing
              : process.env.RECAPTCHA_FINGERPRINT_PROFILE,
          seed: seed ?? `${cfg.siteKey}:${Date.now()}`,
        });

  cfg.fingerprint = profile;
  cfg.userAgent = profile.userAgent;
  if (isTicketmasterSiteKey(cfg.siteKey) && !cfg.preserveOrigin) {
    cfg.origin =
      profile.origin ?? cfg.origin ?? "https://auth.ticketmaster.com";
    cfg.referer =
      profile.referer ?? cfg.referer ?? "https://auth.ticketmaster.com/";
  }
  cfg._fingerprintSession = profile.id;
  return profile;
}
