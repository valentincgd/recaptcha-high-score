/**
 * flat.mjs — Générateur de token reCAPTCHA v3 100 % pur Node, FLAT (12 champs byte-exact),
 * PILOTÉ PAR UN PROFIL fingerprints.json de bout en bout.
 *
 * Le profil pilote TOUT ce qui est réellement discriminant côté détection :
 *   - User-Agent + sec-ch-ua + sec-ch-ua-platform + Accept-Language sur TOUTES les requêtes
 *     (bootstrap, anchor, reload) → cohérence parfaite.
 *   - userAgentData dans le champ 16 (slot 72) ← même profil.
 *   - host de la page dans la télémétrie (champ 20).
 * (Le field16 ne porte pas d'empreinte device discriminante — cf. mémoire ; ce qui compte est
 *  la cohérence headers + la correction byte-exacte des champs, toutes deux assurées ici.)
 *
 *   import { solveFlat } from "./flat.mjs";
 *   const { token, score } = await solveFlat({ ...DEMO });          // profil aléatoire
 *   const { token } = await solveFlat({ ...cfg, fingerprintId: "win11_nvidia_rtx3060" });
 */
import { createRequire } from "module";
import { Config } from "./api/Config.js";
import { HttpClient } from "./api/HttpClient.js";
import { CallbackGenerator } from "./api/CallbackGenerator.js";
import { EnterpriseBootstrapParser } from "./api/EnterpriseBootstrapParser.js";
import { AnchorParser } from "./api/AnchorParser.js";
import { ReloadResponseParser } from "./api/ReloadResponseParser.js";
import { PureFlatReload } from "./api/vm/PureFlatReload.js";
import { CookieJar } from "./api/CookieJar.js";
import { pickFingerprint } from "./fingerprints.mjs";

const GOOGLE = "https://www.google.com";

/**
 * @param {object} o
 * @param {string} o.siteKey, o.action, o.origin
 * @param {string} [o.referer]
 * @param {string} [o.mode="api2"]  "api2" | "enterprise"
 * @param {string} [o.proxy]
 * @param {string} [o.fingerprintId]  forcer un profil (sinon aléatoire)
 * @param {boolean} [o.verbose]
 * @returns {Promise<{token, success, profileId, fingerprint, clientHints, reloadBytes, mode, hint?}>}
 */
export async function solveFlat({
  siteKey, action, origin, referer, title = null,
  mode = "api2", proxy = null, fingerprintId = null, verbose = false, delayMs = null,
  prime = null, primeAction = null,
}) {
  if (!siteKey) throw new Error("siteKey requis");
  if (!origin) throw new Error("origin requis");

  const fingerprint = pickFingerprint({ id: fingerprintId });
  if (title != null) fingerprint.title = String(title);
  const log = verbose ? (...a) => console.error("[flat]", ...a) : () => {};

  const cfg = new Config({
    siteKey, action: action ?? "submit", origin,
    referer: referer ?? origin.replace(/\/$/, "") + "/",
    mode, preserveOrigin: true,
  });
  cfg.fingerprint = fingerprint;
  cfg.userAgent = fingerprint.userAgent; // → headers cohérents (UA + client-hints dérivés)

  const base = cfg.googleHeaders(); // porte déjà UA + sec-ch-ua + accept-language du profil

  // Cookie _GRECAPTCHA VIEILLI (réputation) : comme un vrai cookie-store de navigateur, on présente à
  // Google un _GRECAPTCHA persisté qui vieillit entre les runs. Un jar vide = « confiance 0 » = score bas
  // (c'est ce qui distinguait jsdom, qui charge scripts/cookie_jar.json, de flat qui partait à zéro).
  // Source : RC_GRECAPTCHA (valeur brute "_GRECAPTCHA=…" ou juste la valeur) sinon jar cookie_jar.json.
  let gcookieVal = null;
  try {
    const raw = process.env.RC_GRECAPTCHA;
    if (raw) { gcookieVal = raw.replace(/^_GRECAPTCHA=/, ""); }
    else if (process.env.RC_FLAT_COOKIE_JAR !== "0") {
      const { readFileSync } = await import("fs");
      const jarPath = process.env.RC_COOKIE_JAR || new URL("./vendor/rcjsdom/scripts/cookie_jar.json", import.meta.url);
      const jar = JSON.parse(readFileSync(jarPath, "utf8"));
      const c = (jar.cookies || []).find((x) => x.key === "_GRECAPTCHA" && /google\.com$/.test(x.domain || ""));
      if (c) gcookieVal = c.value;
    }
  } catch (_) {}
  // Cookies {name:value} mergés dans le jar node-tls-client (mergeCookies) → FORCE le _GRECAPTCHA vieilli
  // (au lieu du frais posé par Google). C'EST le facteur décisif : contrôle prouvé jsdom sans cookie=403,
  // avec cookie vieilli=200. À présenter sur anchor + reload (l'anchor est où le score est évalué).
  const gCk = () => (useTls && gcookieVal ? { _GRECAPTCHA: gcookieVal } : undefined);
  const apiPath = mode === "enterprise" ? "enterprise.js" : "api.js";
  const jar = new CookieJar(); // jar partagé bootstrap→anchor→reload (transporte _GRECAPTCHA, comme un navigateur)

  // Chrome-TLS (RC_FLAT_TLS=1) : router bootstrap/anchor/reload par node-tls-client chrome_150 (le MÊME
  // client que jsdom) au lieu du TLS Node natif. Constaté : le TLS Node est détecté dès l'ANCHOR (token
  // 1977o vs 1828o en Chrome → anchor flaggé) → propage un score bas. gfetch* bascule selon le flag.
  const useTls = process.env.RC_FLAT_TLS === "1";
  let tlsBridge = null;
  if (useTls) {
    tlsBridge = createRequire(import.meta.url)("./vendor/rcjsdom/tools/tls_bridge.js");
    tlsBridge.setProxy(proxy || undefined);
    await tlsBridge.ensureSession(proxy || undefined, "chrome_150");
  }
  const gfetchText = async (url, headers, cookies) =>
    useTls ? (await tlsBridge.tlsFetch(url, { headers, cookies })).text() : HttpClient.fetchText(url, headers, jar, proxy);
  const gfetchBuf = async (url, opts) =>
    useTls ? (await tlsBridge.tlsFetch(url, opts)).buffer() : HttpClient.fetchBuffer(url, opts, jar, proxy);

  // 1) Bootstrap (version). RC_FLAT_NO_BOOTSTRAP=1 : sauter le GET api.js (jsdom ne le fait pas pendant
  // le run — script en cache) et utiliser une version fixe (RC_FLAT_VERSION). Test : le GET api.js de flat
  // pollue-t-il la session/réputation de l'anchor ?
  let bootstrap;
  if (process.env.RC_FLAT_NO_BOOTSTRAP === "1") {
    bootstrap = { version: process.env.RC_FLAT_VERSION || "A7KpaEASfhDcK0nXxgQEyyYv", apiBase: `${GOOGLE}/recaptcha/${mode === "enterprise" ? "enterprise" : "api2"}/` };
  } else {
    bootstrap = EnterpriseBootstrapParser.parse(
      await gfetchText(`${GOOGLE}/recaptcha/${apiPath}?render=${siteKey}`, base, gCk()),
    );
  }
  if (!bootstrap.version) throw new Error("bootstrap : version introuvable");
  log("bootstrap", bootstrap.version);

  // 2) Anchor (anchorToken)
  const cb = CallbackGenerator.generate();
  const anchorUrl = cfg.buildAnchorUrl({ apiBase: bootstrap.apiBase, version: bootstrap.version, cb });
  const anchorHtml = await gfetchText(
    anchorUrl,
    // Headers anchor alignés EXACTEMENT sur jsdom (capturé) : accept:*/*, priority:u=0,i, accept-language:en.
    { ...base, "accept-language": useTls ? "en" : base["accept-language"], referer: cfg.referer, accept: "*/*", "sec-fetch-storage-access": "none", "sec-fetch-site": "cross-site", "sec-fetch-dest": "iframe", "sec-fetch-mode": "navigate", "upgrade-insecure-requests": "1", priority: "u=0, i" },
    gCk(),
  );
  if (process.env.RC_DUMP_FLAT_ANCHOR) { try { const { writeFileSync } = await import("fs"); writeFileSync(process.env.RC_DUMP_FLAT_ANCHOR, anchorHtml); } catch (_) {} }
  // RC_OVERRIDE_ANCHOR_HTML : test d'isolation — utiliser le token+DC anchor GENUINE de jsdom au lieu
  // de celui fetché par flat, pour savoir si le token anchor est le discriminant.
  let anchor;
  if (process.env.RC_OVERRIDE_ANCHOR_HTML) {
    const { readFileSync } = await import("fs");
    anchor = AnchorParser.parse(readFileSync(process.env.RC_OVERRIDE_ANCHOR_HTML, "utf8"));
    log("anchor", "OVERRIDE (jsdom genuine)");
  } else {
    anchor = AnchorParser.parse(anchorHtml);
  }
  if (!anchor.anchorToken) {
    if (/Invalid domain for site key/i.test(anchorHtml)) throw new Error("domaine refusé pour cette siteKey");
    throw new Error("recaptcha-token introuvable dans l'anchor");
  }
  log("anchor", `token=${anchor.anchorToken.length} profil=${fingerprint.id}`);

  // 2b) Ressources de session qu'un vrai navigateur charge et que flat sautait (jsdom les fait) :
  // le VRAI script recaptcha__<hl>.js + styles depuis gstatic, + le webworker. Séquence de requêtes
  // que Google peut corréler. RC_FLAT_RES=1 pour activer.
  if (useTls && process.env.RC_FLAT_RES === "1") {
    const gs = "https://www.gstatic.com/recaptcha/releases/" + bootstrap.version;
    const hl = cfg.hl || "en";
    for (const [u, dest] of [
      [`${gs}/recaptcha__${hl}.js`, "script"],
      [`${gs}/styles__ltr.css`, "style"],
    ]) {
      try { await gfetchText(u, { ...base, referer: anchorUrl, accept: "*/*", "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors", "sec-fetch-dest": dest }); } catch (_) {}
    }
    try {
      await gfetchText(
        `${GOOGLE}/recaptcha/${mode === "enterprise" ? "enterprise" : "api2"}/webworker.js?hl=${hl}&v=${bootstrap.version}`,
        { ...base, referer: anchorUrl, accept: "*/*", "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors", "sec-fetch-dest": "worker" },
      );
    } catch (_) {}
  }

  // 3) Reload body FLAT byte-exact, piloté par le profil
  const originHost = new URL(cfg.referer).host;
  // Contexte SIGN-IN (ZB 6Ldo ou action login) → field16 aligné genuine browser (fixes leaks jsdom :
  // [52]/[49]/[35]/[39]/[45]/[50], cf REVERSE_FIELD16_AUDIT.md). Event garde le spec jsdom (il passe).
  const signin = /^6Ldo/i.test(siteKey) || /login|signin|sign-in/i.test(String(cfg.action || ""));
  const built = PureFlatReload.build({
    version: bootstrap.version,
    anchorToken: anchor.anchorToken,
    siteKey, action: cfg.action,
    originHost, referer: cfg.referer,
    profile: fingerprint,
    encryptionKey: anchor.encryptionKey, // lie le field16 à la session (DC = clé anchor)
    signin,
  });
  log("reload", `${built.reloadBytes}o field5=${built.field5}`);
  if (process.env.RC_DUMP_FLAT_RELOAD) { try { const { writeFileSync } = await import("fs"); writeFileSync(process.env.RC_DUMP_FLAT_RELOAD, built.body); } catch (_) {} }

  // Délai anchor→reload optionnel (RC_FLAT_DELAY_MS) : un vrai navigateur met ~qq secondes ;
  // www.ticketmaster.com peut flaguer un reload trop rapide. Test d'humanisation temporelle.
  const effDelayMs = delayMs != null ? Number(delayMs) : Number(process.env.RC_FLAT_DELAY_MS || 0);
  if (effDelayMs > 0) await new Promise((r) => setTimeout(r, effDelayMs));

  // 4) POST /reload → token
  // ORDRE des headers = fingerprint HTTP/2 (Akamai/TM). Le vrai Chrome/jsdom envoie content-type EN
  // PREMIER, puis referer, user-agent, accept-language, accept, [cookie _GRECAPTCHA], sec-ch-ua, …
  // (capturé jsdom_reqhdrs.json). Un ordre différent → flaggé. Le cookie _GRECAPTCHA (quand présent)
  // se place ENTRE accept et sec-ch-ua (position exacte observée chez jsdom).
  const reloadUrl = `${bootstrap.apiBase}reload?k=${siteKey}`;
  const mkHeaders = (cookie) => {
    if (useTls) {
      const h = {};
      h["content-type"] = "application/x-protobuffer";
      h["referer"] = anchorUrl;
      h["user-agent"] = base["user-agent"];
      h["accept-language"] = "en"; // jsdom émet "en" sur le reload (navigator.language) — cohérence
      h["accept"] = "*/*";
      if (cookie) h["cookie"] = cookie; // _GRECAPTCHA obtenu du reload#1 (comme jsdom le renvoie sur le 2e)
      h["sec-ch-ua"] = base["sec-ch-ua"];
      h["sec-ch-ua-mobile"] = base["sec-ch-ua-mobile"];
      h["sec-ch-ua-platform"] = base["sec-ch-ua-platform"];
      h["sec-fetch-storage-access"] = "none";
      h["sec-fetch-site"] = "same-origin";
      h["sec-fetch-mode"] = "cors";
      h["sec-fetch-dest"] = "empty";
      h["origin"] = GOOGLE;
      h["priority"] = "u=1, i";
      return h;
    }
    const h = {
      ...base, accept: "*/*", "content-type": "application/x-protobuffer",
      origin: GOOGLE, referer: anchorUrl,
      "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", "sec-fetch-site": "same-origin", priority: "u=1, i",
    };
    if (cookie) h["cookie"] = cookie;
    return h;
  };
  const buildPayload = (field7 = null, token69 = null) => PureFlatReload.build({
    version: bootstrap.version, anchorToken: anchor.anchorToken, siteKey, action: cfg.action,
    originHost, referer: cfg.referer, profile: fingerprint, encryptionKey: anchor.encryptionKey,
    field7, signin, token69,
  });
  const sendReload = async (payload, cookie) => {
    if (useTls) {
      // cookies: gCk() force le _GRECAPTCHA vieilli dans le jar node-tls-client (mergeCookies) → il est
      // envoyé sur le reload, sans être écrasé par le cookie frais que Google poserait. mkHeaders(null) :
      // pas de header cookie manuel (node-tls-client le construit depuis le jar).
      const r = await tlsBridge.tlsFetch(reloadUrl, { method: "POST", headers: mkHeaders(cookie), body: payload.body, cookies: gCk() });
      const sc = r.headers["set-cookie"] || r.headers["Set-Cookie"] || null;
      return { buf: r.buffer(), setCookie: sc };
    }
    const buf = await gfetchBuf(reloadUrl, { method: "POST", headers: mkHeaders(cookie), body: payload.body });
    return { buf, setCookie: null };
  };
  const extractGrecaptcha = (sc) => {
    if (!sc) return null;
    for (const c of (Array.isArray(sc) ? sc : [sc])) { const m = /(_GRECAPTCHA=[^;]+)/.exec(String(c)); if (m) return m[1]; }
    return null;
  };

  // PRIMING du champ 7 (usagePatternToken) — DÉCOUVERTE : le champ 7 (05A…) n'est PAS calculé côté
  // client, c'est une signature SERVEUR (réponse /reload idx 8) d'un reload ANTÉRIEUR de la même session,
  // ré-émise en écho. BotGuard retiré 2026-04-01 → rien à "cracker". Le genuine fait une CHAÎNE :
  //   reload#1 (LoginPage, SANS f7) → resp idx8=tokenA → reload#2 (pageView, f7=tokenA) → resp idx8=tokenB
  //   → reload#3 (login, f7=tokenB, 554o) = le token soumis.
  // Le usagePatternToken est en sessionStorage sur google.com → PARTAGÉ entre sitekeys (même _GRECAPTCHA).
  // Ici on amorce : 1+ reloads pour récolter idx8, puis le reload final le porte en champ 7.
  // Activé par param `prime` (nb d'amorçages) ou RC_FLAT_PRIME. cookie _GRECAPTCHA porté d'un reload à l'autre.
  const primeCount = prime != null ? Number(prime) : Number(process.env.RC_FLAT_PRIME || 0);
  // Récolte des tokens serveur échotés de la réponse /reload : idx8=usagePatternToken (champ 7),
  // idx12=humanVerificationToken (field16 slot 69, 09A). Non calculables → round-trip HTTP.
  const harvest = (buf) => {
    const out = { f7: null, t69: null };
    try {
      const p = ReloadResponseParser.parse(buf.toString("utf8"));
      if (Array.isArray(p.raw)) {
        if (typeof p.raw[8] === "string" && /^05A[A-Za-z0-9_-]{20,}/.test(p.raw[8])) out.f7 = p.raw[8];
        if (typeof p.raw[12] === "string" && /^09A[A-Za-z0-9_-]{20,}/.test(p.raw[12])) out.t69 = p.raw[12];
      }
    } catch (_) {}
    return out;
  };
  let field7 = null, token69 = null, primeCookie = null;
  for (let i = 0; i < primeCount; i++) {
    const pBuilt = buildPayload(field7, token69); // amorçage i : porte f7+t69 accumulés (null au 1er, comme genuine)
    const pr = await sendReload(pBuilt, primeCookie);
    primeCookie = extractGrecaptcha(pr.setCookie) || primeCookie;
    const got = harvest(pr.buf);
    log(`prime#${i + 1}`, `${pBuilt.reloadBytes}o f7in=${field7 ? field7.length : 0} → idx8=${got.f7 ? got.f7.length + "o" : "ABSENT"} idx12=${got.t69 ? got.t69.length + "o" : "ABSENT"}`);
    if (got.f7) field7 = got.f7;
    if (got.t69) token69 = got.t69;
    const gap = Number(process.env.RC_FLAT_RELOAD_GAP_MS || 300);
    if (gap > 0) await new Promise((r) => setTimeout(r, gap));
  }

  // RELOAD UNIQUE par défaut : la capture de la séquence réseau jsdom (RC_LOG_REQS) montre que jsdom
  // ne fait qu'UN reload par execute() (anchor → styles.css → reload). Le _GRECAPTCHA vu chez jsdom
  // venait de la PERSISTANCE de session node-tls-client entre runs (artefact), pas du genuine.
  // Double-reload disponible via RC_FLAT_DOUBLE_RELOAD=1 (test) mais OFF par défaut (matche genuine).
  const doubleReload = useTls && process.env.RC_FLAT_DOUBLE_RELOAD === "1";
  const finalBuilt = (field7 || token69) ? buildPayload(field7, token69) : built; // reload final : porte champ7 + slot69 récoltés
  if (field7 || token69) log("reload-final", `f7=${field7 ? field7.length : 0}o slot69=${token69 ? token69.length : 0}o (${finalBuilt.reloadBytes}o)`);
  let respBuf;
  if (doubleReload) {
    const r1 = await sendReload(finalBuilt, primeCookie);
    const gcookie = extractGrecaptcha(r1.setCookie) || primeCookie;
    log("reload#1", `${finalBuilt.reloadBytes}o _GRECAPTCHA=${gcookie ? "obtenu" : "absent"}`);
    const gap = Number(process.env.RC_FLAT_RELOAD_GAP_MS || 400);
    if (gap > 0) await new Promise((r) => setTimeout(r, gap));
    const built2 = buildPayload(field7, token69);
    const r2 = await sendReload(built2, gcookie);
    log("reload#2", `${built2.reloadBytes}o cookie=${gcookie ? "envoyé" : "non"}`);
    respBuf = r2.buf;
  } else {
    // reload unique (genuine) — le _GRECAPTCHA vieilli est injecté via le jar (cookies: gCk()), pas en header
    respBuf = (await sendReload(finalBuilt, primeCookie)).buf;
  }
  const parsed = ReloadResponseParser.parse(respBuf.toString("utf8"));

  const ch = cfg.clientHints();
  return {
    token: parsed.token ?? null,
    success: !!parsed.token,
    profileId: fingerprint.id,
    fingerprint,
    clientHints: {
      user_agent: fingerprint.userAgent,
      accept_lang: ch.acceptLanguage,
      sec_ch_ua: ch.secChUa,
      sec_ch_ua_mobile: ch.mobile,
      sec_ch_ua_platform: ch.platform,
    },
    reloadBytes: built.reloadBytes,
    mode,
    hint: parsed.token ? undefined : "rresp null — vérifier siteKey/mode/origin.",
  };
}
