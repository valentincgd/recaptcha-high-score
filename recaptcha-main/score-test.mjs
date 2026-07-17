/**
 * score-test.mjs — Génère un token Voie B pour le démo officiel reCAPTCHA v3 et MESURE son score réel.
 * Oracle : https://recaptcha-demo.appspot.com/recaptcha-v3-verify.php (renvoie {score}).
 * Un vrai navigateur y score 0.9. On mesure ce que vaut la Voie B pure-JS.
 */
import { Config } from "./api/Config.js";
import { RecaptchaEnterprise } from "./api/RecaptchaEnterprise.js";

const TARGET = {
  siteKey: "6LdKlZEpAAAAAAOQjzC2v_d36tWxCl6dWsozdSy9",
  action: "examples/v3scores",
  origin: "https://recaptcha-demo.appspot.com",
  referer: "https://recaptcha-demo.appspot.com/recaptcha-v3-request-scores.php",
  mode: "api2",
};

// Profil aligné sur le vrai navigateur de la capture (Chrome 150, Windows).
const PROFILE = {
  id: "custom-demo",
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
  platform: "Win32",
  language: "fr-FR",
  languages: ["fr-FR", "fr"],
  width: 1920,
  height: 1080,
  devicePixelRatio: 1,
  webgl: {
    vendor: "Google Inc. (NVIDIA)",
    renderer:
      "ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)",
    extensionCount: 47,
  },
  title: "reCAPTCHA demo: Simple page",
  scrollY: 0,
  localStorageLength: 1,
  inputIds: [],
};

async function verify(token) {
  const url =
    `https://recaptcha-demo.appspot.com/recaptcha-v3-verify.php` +
    `?action=${encodeURIComponent(TARGET.action)}&token=${encodeURIComponent(token)}`;
  const r = await fetch(url, {
    headers: {
      accept: "*/*",
      "accept-language": "fr-FR,fr;q=0.9",
      referer: TARGET.referer,
      "user-agent": PROFILE.userAgent,
    },
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function main() {
  const cfg = new Config({
    siteKey: TARGET.siteKey,
    action: TARGET.action,
    origin: TARGET.origin,
    referer: TARGET.referer,
    mode: TARGET.mode,
    preserveOrigin: true,
  });
  cfg.fingerprint = PROFILE;
  cfg.userAgent = PROFILE.userAgent;

  const client = new RecaptchaEnterprise(cfg);
  const res = await client.getToken();
  console.log("\n=== TOKEN VOIE B ===");
  console.log("success:", res.success, "| token:", res.token?.slice(0, 50) + "…");
  if (!res.success) { console.log("hint:", res.hint, res.error); return; }

  const v = await verify(res.token);
  console.log("\n=== SCORE RÉEL (oracle démo) ===");
  console.log(JSON.stringify(v.body, null, 2));
  const score = v.body?.score;
  console.log(
    score != null
      ? `\n>>> SCORE VOIE B = ${score}  (vrai navigateur = 0.9)`
      : `\n>>> pas de score — ${JSON.stringify(v.body)}`,
  );
}
main().catch((e) => { console.error("ÉCHEC:", e?.message || e); process.exit(1); });
