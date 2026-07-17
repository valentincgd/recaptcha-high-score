/**
 * index.mjs — Générateur de token reCAPTCHA v3 en Node PUR (zéro dépendance, sans navigateur).
 *
 * VOIE B : on ne fait pas tourner la VM reCAPTCHA ; on réplique ses sorties. Toutes les valeurs du
 * fingerprint viennent de fingerprints.json (5 profils complets, tirés au hasard à chaque appel).
 * Pipeline validé : score 0.9 sur le démo officiel Google (= vrai navigateur).
 *
 * N'importe QUE le chemin pur (VmPureReloadBuilder) → aucune dépendance npm (ni jsdom, ni canvas).
 *
 *   import { solve } from "./index.mjs";
 *   const { token } = await solve({ siteKey, action, origin, referer });
 */
import { Config } from "./api/Config.js";
import { HttpClient } from "./api/HttpClient.js";
import { CallbackGenerator } from "./api/CallbackGenerator.js";
import { EnterpriseBootstrapParser } from "./api/EnterpriseBootstrapParser.js";
import { AnchorParser } from "./api/AnchorParser.js";
import { ReloadResponseParser } from "./api/ReloadResponseParser.js";
import { VmPureReloadBuilder } from "./api/vm/VmPureReloadBuilder.js";
import { pickFingerprint, listProfileIds } from "./fingerprints.mjs";

const GOOGLE = "https://www.google.com";

function reloadHeaders(base, anchorUrl) {
  return {
    ...base,
    accept: "*/*",
    "content-type": "application/x-protobuffer",
    origin: GOOGLE,
    referer: anchorUrl,
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    priority: "u=1, i",
  };
}

function anchorHeaders(base, referer) {
  return {
    ...base,
    referer,
    accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "sec-fetch-dest": "iframe",
    "sec-fetch-mode": "navigate",
    "upgrade-insecure-requests": "1",
  };
}

/**
 * Génère un token.
 * @param {object} o
 * @param {string} o.siteKey    clé publique du site
 * @param {string} o.action     action reCAPTCHA (ex: "login", "examples/v3scores")
 * @param {string} o.origin     origine du site (ex: "https://exemple.com")
 * @param {string} [o.referer]  referer (défaut: origin + "/")
 * @param {string} [o.mode]     "api2" (v3, défaut) | "enterprise"
 * @param {string} [o.fingerprintId]  forcer un profil précis (sinon random)
 * @param {boolean} [o.verbose] logs détaillés
 * @returns {Promise<{token:string|null, success:boolean, profileId:string, fingerprint:object, reloadBytes:number, mode:string, hint?:string}>}
 */
export async function solve({
  siteKey,
  action,
  origin,
  referer,
  title = null,
  mode = "api2",
  proxy = null,
  fingerprintId = null,
  verbose = false,
}) {
  if (!siteKey) throw new Error("siteKey requis");
  if (!origin) throw new Error("origin requis (ex: https://exemple.com)");

  const fingerprint = pickFingerprint({ id: fingerprintId });
  if (title != null) fingerprint.title = String(title); // titre de page fourni par l'appelant
  const log = verbose ? (...a) => console.error("[voieb]", ...a) : () => {};

  const cfg = new Config({
    siteKey,
    action: action ?? "submit",
    origin,
    referer: referer ?? origin.replace(/\/$/, "") + "/",
    mode,
    preserveOrigin: true,
  });
  cfg.fingerprint = fingerprint;
  cfg.userAgent = fingerprint.userAgent;

  const base = cfg.googleHeaders();
  const enterprise = mode === "enterprise";
  const apiPath = enterprise ? "enterprise.js" : "api.js";

  // 1) Bootstrap — récupère version + apiBase (live → s'adapte aux mises à jour du script)
  const bootstrapJs = await HttpClient.fetchText(
    `${GOOGLE}/recaptcha/${apiPath}?render=${siteKey}`,
    base,
    null,
    proxy,
  );
  const bootstrap = EnterpriseBootstrapParser.parse(bootstrapJs);
  if (!bootstrap.version) throw new Error("bootstrap : version introuvable");
  log("bootstrap", bootstrap.version, bootstrap.apiBase);

  // 2) Anchor — token + clé de chiffrement + config bytecode (live)
  const cb = CallbackGenerator.generate();
  const anchorUrl = cfg.buildAnchorUrl({ apiBase: bootstrap.apiBase, version: bootstrap.version, cb });
  const anchorHtml = await HttpClient.fetchText(anchorUrl, anchorHeaders(base, cfg.referer), null, proxy);
  const anchor = AnchorParser.parse(anchorHtml);
  if (!anchor.anchorToken) {
    if (/Invalid domain for site key/i.test(anchorHtml))
      throw new Error("domaine refusé pour cette siteKey (origin/referer doivent correspondre au site enregistré)");
    throw new Error("recaptcha-token introuvable dans l'anchor");
  }
  log("anchor", `token=${anchor.anchorToken.length} clé=${anchor.encryptionKey}`);

  // 3) Reload body (VOIE B pure — champs 16/22/… générés à la volée depuis le fingerprint)
  const built = VmPureReloadBuilder.build({
    version: bootstrap.version,
    anchorToken: anchor.anchorToken,
    siteKey,
    action: cfg.action,
    encryptionKey: anchor.encryptionKey,
    anchor,
    configBytecode: anchor.configBytecode,
    vmBytecodeKeys: anchor.config?.vmBytecodeKeys,
    userAgent: cfg.userAgent,
    referer: cfg.referer,
    origin: cfg.origin,
    fingerprint,
    anchorMs: cfg.anchorMs,
    executeMs: cfg.executeMs,
    autoDump: false,
    onLog: verbose ? (s, d) => log("build", s, d) : null,
  });
  log("reload body", `${built.reloadBytes}o`);

  // 4) POST /reload → token
  const respBuf = await HttpClient.fetchBuffer(
    `${bootstrap.apiBase}reload?k=${siteKey}`,
    { method: "POST", headers: reloadHeaders(base, anchorUrl), body: built.body },
    null,
    proxy,
  );
  const parsed = ReloadResponseParser.parse(respBuf.toString("utf8"));

  // Client-hints cohérents avec le fingerprint — à REJOUER tels quels sur la requête cible.
  const ch = cfg.clientHints();
  const clientHints = {
    user_agent: fingerprint.userAgent,
    accept_lang: ch.acceptLanguage,
    sec_ch_ua: ch.secChUa,
    sec_ch_ua_mobile: ch.mobile,
    sec_ch_ua_platform: ch.platform,
  };

  return {
    token: parsed.token ?? null,
    success: !!parsed.token,
    profileId: fingerprint.id,
    fingerprint,
    clientHints,
    reloadBytes: built.reloadBytes,
    mode,
    hint: parsed.token ? undefined : "rresp null — vérifier siteKey/mode/origin (anchor live).",
  };
}

/**
 * Vérifie le score d'un token via l'oracle du DÉMO officiel Google.
 * Ne fonctionne que pour la sitekey du démo (recaptcha-demo.appspot.com).
 * @returns {Promise<{score:number|null, success:boolean, raw:object}>}
 */
export async function verifyDemoScore(token, action = "examples/v3scores") {
  const url =
    "https://recaptcha-demo.appspot.com/recaptcha-v3-verify.php" +
    `?action=${encodeURIComponent(action)}&token=${encodeURIComponent(token)}`;
  const r = await fetch(url, { headers: { accept: "*/*" } });
  const raw = await r.json().catch(() => ({}));
  return { score: raw?.score ?? null, success: !!raw?.success, raw };
}

export { pickFingerprint, listProfileIds };

// Sitekey/action/origin/title du démo officiel (pratique pour tester le score).
export const DEMO = {
  siteKey: "6LdKlZEpAAAAAAOQjzC2v_d36tWxCl6dWsozdSy9",
  action: "examples/v3scores",
  origin: "https://recaptcha-demo.appspot.com",
  referer: "https://recaptcha-demo.appspot.com/recaptcha-v3-request-scores.php",
  title: "reCAPTCHA demo - Request scores",
};

/**
 * Génère un token pour le démo officiel ET mesure son score en un appel.
 * @returns {Promise<{token:string|null, success:boolean, score:number|null, profileId:string, raw:object}>}
 */
export async function solveAndScoreDemo({ fingerprintId = null, verbose = false } = {}) {
  const res = await solve({ ...DEMO, fingerprintId, verbose });
  if (!res.token) return { token: null, success: false, score: null, profileId: res.profileId, raw: { hint: res.hint } };
  const v = await verifyDemoScore(res.token, DEMO.action);
  return { token: res.token, success: v.success, score: v.score, profileId: res.profileId, raw: v.raw };
}
