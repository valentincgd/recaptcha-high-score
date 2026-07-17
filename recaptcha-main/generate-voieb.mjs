/**
 * generate-voieb.mjs — Générateur de token reCAPTCHA v3 par VOIE B (pur JS, sans chrome/jsdom).
 *
 * Voie B = on n'exécute PAS la VM ; on RÉPLIQUE ses sorties. Toutes les valeurs du fingerprint
 * sont ci-dessous, MODIFIABLES : elles sont chiffrées (LCG) puis assemblées en champ 16/5/20,
 * et postées sur /reload. Le module produit un token live (HTTP 200).
 *
 * Lancer :  node generate-voieb.mjs
 *
 * ⚠️ Le score reste plafonné ~0.3 (la confiance est côté serveur, cf. mémoire score-root-cause).
 *    L'intérêt de la Voie B = coût/scale (pas de navigateur), pas le score.
 */
import { Config } from "./api/Config.js";
import { RecaptchaEnterprise } from "./api/RecaptchaEnterprise.js";

// ─────────────────────────────────────────────────────────────────────────────
// 1) CIBLE — sitekey / action / domaine
// ─────────────────────────────────────────────────────────────────────────────
const TARGET = {
  siteKey: "6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV", // Ticketmaster "Event"
  action: "Event",
  // ⚠️ la sitekey TM "Event" est enregistrée sur auth.ticketmaster.com (co inclut :443).
  origin: "https://auth.ticketmaster.com",
  referer: "https://auth.ticketmaster.com/",
  mode: "api2", // Ticketmaster = api2 (pas enterprise)
};

// ─────────────────────────────────────────────────────────────────────────────
// 2) PROFIL NAVIGATEUR — TOUTES CES VALEURS SONT LIBRES / MODIFIABLES.
//    C'est le cœur de la Voie B : tu décides exactement ce que "voit" reCAPTCHA.
//    Garde la COHÉRENCE (UA ↔ platform ↔ webgl ↔ écran) sinon c'est détectable.
// ─────────────────────────────────────────────────────────────────────────────
const PROFILE = {
  id: "custom",
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
  platform: "Win32",
  language: "en-US",
  languages: ["en-US", "en"],
  width: 2560, // largeur écran
  height: 1440, // hauteur écran
  devicePixelRatio: 1,
  webgl: {
    vendor: "Google Inc. (AMD)",
    renderer:
      "ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)",
    extensionCount: 45,
  },
  title: "Tickets | Ticketmaster",
  scrollY: 0,
  localStorageLength: 4,
  inputIds: ["email", "password"],
};

// ─────────────────────────────────────────────────────────────────────────────
// 3) EXÉCUTION
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const cfg = new Config({
    siteKey: TARGET.siteKey,
    action: TARGET.action,
    origin: TARGET.origin,
    referer: TARGET.referer,
    mode: TARGET.mode,
    preserveOrigin: true, // ne pas écraser origin/referer avec le défaut TM
  });
  cfg.fingerprint = PROFILE; // ← injection du profil custom (Voie B)
  cfg.userAgent = PROFILE.userAgent;

  const client = new RecaptchaEnterprise(cfg);
  const res = await client.getToken();

  console.log("\n=== RÉSULTAT VOIE B ===");
  console.log("valeurs injectées :", {
    userAgent: PROFILE.userAgent,
    écran: `${PROFILE.width}x${PROFILE.height}`,
    webgl: PROFILE.webgl.renderer,
    platform: PROFILE.platform,
  });
  console.log("success   :", res.success);
  console.log("mode      :", res.mode);
  console.log("pipeline  :", res.pipeline);
  console.log("token     :", res.token ? res.token.slice(0, 60) + "…" : null);
  console.log("longueur  :", res.token?.length ?? 0, "chars");
  if (!res.success) console.log("hint      :", res.hint, res.error);
  return res;
}

main().catch((e) => {
  console.error("ÉCHEC:", e?.message || e);
  process.exit(1);
});
