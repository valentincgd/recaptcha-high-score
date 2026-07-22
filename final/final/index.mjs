/**
 * index.mjs — Générateur de token reCAPTCHA v3 + cookie `tmpt` Ticketmaster, 100 % JS PUR.
 * AUCUN jsdom, AUCUN node:vm, AUCune exécution du script Google. Tout est reconstruit/chiffré en Node.
 * Dossier AUTONOME : ne dépend que de node-tls-client (empreinte TLS Chrome, indispensable).
 *
 *   import { solveToken, solveTmpt } from "./index.mjs";
 *   const { token } = await solveToken({ siteKey, action, origin, proxy });
 *   const { tmpt, token, headers } = await solveTmpt({ url, action, siteKey, proxy });
 *
 * Le token passe www.ticketmaster.com Event (event-page + quickpicks) sur IP résidentielle propre.
 * Facteur limitant = réputation de l'IP (pas le payload). Rejouer la requête cible avec `headers` + même proxy.
 */
import { createRequire } from "module";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { Config } from "./api/Config.js";
import { HttpClient } from "./api/HttpClient.js";
import { CallbackGenerator } from "./api/CallbackGenerator.js";
import { EnterpriseBootstrapParser } from "./api/EnterpriseBootstrapParser.js";
import { AnchorParser } from "./api/AnchorParser.js";
import { ReloadResponseParser } from "./api/ReloadResponseParser.js";
import { PureFlatReload } from "./api/vm/PureFlatReload.js";
import { CookieJar } from "./api/CookieJar.js";
import { pickFingerprint, countryFromProxy } from "./fingerprints.mjs";

const require = createRequire(import.meta.url);
const tls = require("./tlsClient.cjs");
const __dir = dirname(fileURLToPath(import.meta.url));

/** Constantes externalisées (versions, URLs Google, config des sites : sitekeys, OAuth, headers). */
export const CONST = JSON.parse(readFileSync(join(__dir, "constants.json"), "utf8"));
const GOOGLE = CONST.google.base;

/** Retourne la config d'un site connu (constants.json → sites) d'après le host de l'URL, sinon null. */
export function siteConfigFor(url) {
  let host = "";
  try { host = new URL(url).host; } catch { host = String(url || ""); }
  for (const cfg of Object.values(CONST.sites || {})) {
    if (cfg.match && new RegExp(cfg.match).test(host)) return cfg;
  }
  return null;
}

/**
 * Génère un VRAI token reCAPTCHA v3 (flat, byte-exact) — bootstrap → anchor → reload, 100 % JS pur.
 * @returns {Promise<{token, success, profileId, headers, reloadBytes}>}
 */
export async function solveToken({ siteKey, action = "Event", origin, referer, proxy = null, fingerprintId = null, hl = "fr", enterprise = false, delayMs = 0, title = "", pageUrl = null }) {
  // RC_RELOAD_DELAY : délai (ms) anchor→reload pour matcher l'exec-time genuine (~5s challenge) — test timing.
  if (!delayMs && process.env.RC_RELOAD_DELAY) delayMs = Number(process.env.RC_RELOAD_DELAY) || 0;
  if (!siteKey) throw new Error("siteKey requis");
  if (!origin) throw new Error("origin requis");

  // Hook de VÉRIFICATION uniquement (env-gated RC_USE_JSDOM=1) : minter le token via la référence jsdom
  // du dossier parent au lieu du flat pur, pour ISOLER field16-content vs réputation IP/anchor sur le
  // replay www. La prod reste 100 % pure : import dynamique, jamais chargé sans le flag.
  if (process.env.RC_USE_JSDOM === "1") {
    const { solveViaJsdom } = await import("../api/JsdomSolver.mjs");
    const j = await solveViaJsdom({ siteKey, action, origin, pageUrl: referer ?? (origin.replace(/\/$/, "") + "/"), proxy: proxy || undefined, hl, mode: enterprise ? "enterprise" : "api2" });
    return { token: j.token ?? null, success: !!j.token, profileId: "jsdom", reloadBytes: 0, reloadStatus: j.reloadStatus ?? (j.token ? 200 : 0), headers: j.clientHints };
  }
  // Profil device DIVERS par token (anti-fleet) + COHÉRENT avec le pays de l'IP proxy (tz/locale suivent l'IP).
  const fingerprint = pickFingerprint({ id: fingerprintId, country: countryFromProxy(proxy) });
  // hl (langue reCAPTCHA) = DÉRIVÉ du profil (fingerprint.hl ou racine de la langue) → cohérent avec
  // accept-language/field16. Le param `hl` ne sert que de dernier fallback.
  const fpHl = fingerprint.hl || (fingerprint.language || "").split("-")[0].toLowerCase() || hl;
  const cfg = new Config({ siteKey, action, origin, referer: referer ?? origin.replace(/\/$/, "") + "/", mode: enterprise ? "enterprise" : "api2", preserveOrigin: true, hl: fpHl });
  cfg.fingerprint = fingerprint;
  cfg.userAgent = fingerprint.userAgent;
  const base = cfg.googleHeaders(); // base["accept-language"] = acceptLanguage DU PROFIL
  // accept-language des requêtes reCAPTCHA (anchor/reload) = celle du profil (plus de "en" hardcodé).
  const acceptLang = base["accept-language"] || fingerprint.acceptLanguage || "en-US,en;q=0.9";
  const apiPath = enterprise ? "enterprise.js" : "api.js";

  // Cookie _GRECAPTCHA = réputation cross-site reCAPTCHA v3. Par défaut aucun (visiteur neuf).
  // RC_GRECAPTCHA=<val> permet d'injecter un cookie de réputation chaud (TEST score).
  const gCk = () => (process.env.RC_GRECAPTCHA ? { _GRECAPTCHA: process.env.RC_GRECAPTCHA } : undefined);

  tls.setProxy(proxy || undefined);
  // Empreinte TLS = le profil `tls` DU FINGERPRINT (correspondant à l'UA : Chrome 150 → ALPS 17613,
  // X25519MLKEM768). Si le profil n'a pas d'objet `tls`, fallback sur son `tlsClientId` (built-in),
  // sinon défaut Chrome 150. RC_TLS_ID force un identifiant (test). PLUS de hardcode global.
  await tls.ensureSession(proxy || undefined, process.env.RC_TLS_ID || fingerprint.tls || fingerprint.tlsClientId || undefined);
  const gtext = async (url, headers, cookies, headerOrder) => (await tls.tlsFetch(url, { headers, cookies, headerOrder })).text();
  // Ordre des headers Chrome pour l'anchor GET (navigation iframe cross-site) — SCORÉ par Google.
  const anchorOrder = ["sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-platform", "upgrade-insecure-requests", "user-agent", "accept", "sec-fetch-storage-access", "sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest", "referer", "accept-encoding", "accept-language", "priority"];

  // Retry transitoire : les proxies résidentiels renvoient parfois une réponse tronquée/vide
  // (le status peut être 200 mais le corps incomplet) → le parse échoue. On re-fetch jusqu'à 4×.
  const withRetry = async (fetchFn, parseFn, ok, label) => {
    let last;
    for (let attempt = 0; attempt < 4; attempt++) {
      const parsed = parseFn(await fetchFn());
      if (ok(parsed)) return parsed;
      last = parsed;
    }
    throw new Error(label);
  };

  // 1) Bootstrap → version
  const bootstrap = await withRetry(
    () => gtext(`${GOOGLE}/recaptcha/${apiPath}?render=${siteKey}`, base, gCk()),
    (t) => EnterpriseBootstrapParser.parse(t),
    (b) => !!b.version,
    "bootstrap : version introuvable",
  );

  // 2) Anchor → token + DC (AnchorParser.findDC extrait le BON timestamp = clé cipher field16)
  const anchorHeaders = {
    "sec-ch-ua": base["sec-ch-ua"], "sec-ch-ua-mobile": base["sec-ch-ua-mobile"], "sec-ch-ua-platform": base["sec-ch-ua-platform"],
    "upgrade-insecure-requests": "1", "user-agent": base["user-agent"], accept: "*/*",
    "sec-fetch-storage-access": "none", "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "iframe",
    referer: cfg.referer, "accept-encoding": "gzip, deflate, br, zstd", "accept-language": acceptLang, priority: "u=0, i",
  };
  let anchorUrl;
  let anchor;
  // TEST : RC_OVERRIDE_ANCHOR_HTML = HTML d'un anchor GENUINE (capturé du navigateur) → isole si le gate
  // restant est la réputation de l'anchor (exécuté vs fetché). anchorUrl reste le nôtre pour le referer reload.
  if (process.env.RC_OVERRIDE_ANCHOR_HTML) {
    const { readFileSync } = await import("fs");
    anchor = AnchorParser.parse(readFileSync(process.env.RC_OVERRIDE_ANCHOR_HTML, "utf8"));
    anchorUrl = cfg.buildAnchorUrl({ apiBase: bootstrap.apiBase, version: bootstrap.version, cb: CallbackGenerator.generate() });
    if (!anchor.anchorToken) throw new Error("anchor override sans anchorToken");
  } else {
    anchor = await withRetry(
      () => { anchorUrl = cfg.buildAnchorUrl({ apiBase: bootstrap.apiBase, version: bootstrap.version, cb: CallbackGenerator.generate() }); return gtext(anchorUrl, anchorHeaders, gCk(), anchorOrder); },
      (t) => AnchorParser.parse(t),
      (a) => !!a.anchorToken,
      "recaptcha-token introuvable dans l'anchor",
    );
  }

  // 3) Reload body FLAT byte-exact (field16 chiffré avec le DC de l'anchor, field20/22/5 cohérents)
  const originHost = new URL(cfg.referer).host;
  const built = PureFlatReload.build({
    version: bootstrap.version, anchorToken: anchor.anchorToken, siteKey, action: cfg.action,
    originHost, referer: cfg.referer, pageUrl: pageUrl || cfg.referer, title, profile: fingerprint, encryptionKey: anchor.encryptionKey,
    anchor, // objet anchor complet (configBytecode) → extraction encKey slot73 botguard
  });

  if (process.env.RC_DUMP_CLEAN_RELOAD) { try { const { writeFileSync } = await import("fs"); writeFileSync(process.env.RC_DUMP_CLEAN_RELOAD, built.body); } catch (_) {} }
  if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));

  // 4) POST /reload → token. ⭐ L'ORDRE DES HEADERS (reloadOrder) est SCORÉ par Google : un ordre non-Chrome
  // sur le reload = token de score plus bas → tm-bl www bloque (prouvé : même field16, seul l'ordre change le
  // verdict quickpicks 403↔200). On force l'ordre exact d'un fetch Chrome (client-hints groupés, sec-fetch, priority en dernier).
  const reloadHeaders = {
    "content-type": "application/x-protobuffer",
    "sec-ch-ua": base["sec-ch-ua"], "sec-ch-ua-mobile": base["sec-ch-ua-mobile"], "sec-ch-ua-platform": base["sec-ch-ua-platform"],
    "user-agent": base["user-agent"], accept: "*/*", "accept-encoding": "gzip, deflate, br, zstd", "accept-language": acceptLang,
    origin: GOOGLE, "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty",
    referer: anchorUrl, priority: "u=1, i",
  };
  const reloadOrder = ["content-type", "sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-platform", "user-agent", "accept", "accept-encoding", "accept-language", "origin", "sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest", "referer", "priority"];
  const resp = await tls.tlsFetch(`${bootstrap.apiBase}reload?k=${siteKey}`, { method: "POST", headers: reloadHeaders, headerOrder: reloadOrder, body: built.body, cookies: gCk() });
  const parsed = ReloadResponseParser.parse(resp.buffer().toString("utf8"));

  const ch = cfg.clientHints();
  return {
    token: parsed.token ?? null,
    success: !!parsed.token,
    profileId: fingerprint.id,
    reloadBytes: built.reloadBytes,
    reloadStatus: parsed.token ? 200 : resp.status,
    headers: {
      user_agent: fingerprint.userAgent,
      accept_lang: ch.acceptLanguage,
      sec_ch_ua: ch.secChUa,
      sec_ch_ua_mobile: ch.mobile,
      sec_ch_ua_platform: ch.platform,
    },
  };
}

/* ─────────────────── Ticketmaster : eps-mgr + epsf → cookie tmpt ─────────────────── */

function resolveDomain(pageUrl, action) {
  action = (action || "").trim() || "Event";
  let origin, hostname, referer;
  try { const u = new URL(pageUrl); origin = `${u.protocol}//${u.host}`; hostname = u.hostname; referer = pageUrl; }
  catch { hostname = "www.ticketmaster.com"; origin = "https://" + hostname; referer = origin + "/"; }
  return { origin, hostname, referer, action, epsPath: "/epsf/gec/v3/" + action };
}

/**
 * Génère le cookie `tmpt` Ticketmaster à partir du token reCAPTCHA (100 % JS pur).
 * @returns {Promise<{tmpt, eps_sid, token, headers, ms}>}
 */
export async function solveTmpt({ url, action = "Event", siteKey, proxy = null, hl = "fr", enterprise = false, fingerprintId = null, title = "" }) {
  if (!url) throw new Error("url requis");
  const t0 = Date.now();
  const dom = resolveDomain(url, action);
  const r = await solveToken({ siteKey, action: dom.action, origin: dom.origin, referer: dom.referer, pageUrl: dom.referer, title, proxy, hl, enterprise, fingerprintId });
  if (!r.token) throw new Error("token reCAPTCHA null (reload " + r.reloadStatus + ")");
  const h = r.headers;

  // Flux eps (eps-mgr → epsf) via TLS natif : parfois flaky sur proxy résidentiel. On retente jusqu'à 3×.
  let tmpt, epsSid;
  for (let attempt = 0; attempt < 3 && !tmpt; attempt++) {
    const jar = new CookieJar();
    // GET /eps-mgr → eps_sid (non-2xx toléré : le cookie est posé dans le jar avant le throw)
    try {
      await HttpClient.fetchText(dom.origin + "/eps-mgr", {
        accept: "*/*", "accept-language": h.accept_lang, referer: dom.referer,
        "sec-ch-ua": h.sec_ch_ua, "sec-ch-ua-mobile": h.sec_ch_ua_mobile, "sec-ch-ua-platform": h.sec_ch_ua_platform,
        "sec-fetch-dest": "script", "sec-fetch-mode": "no-cors", "sec-fetch-site": "same-origin",
        "upgrade-insecure-requests": "1", "user-agent": h.user_agent,
      }, jar, proxy);
    } catch { /* eps_sid déjà dans le jar */ }

    // POST /epsf/gec/v3/<action> { hostname, key, token } → cookie tmpt
    try {
      await HttpClient.fetchBuffer(dom.origin + dom.epsPath, {
        method: "POST",
        headers: {
          accept: "*/*", "accept-language": h.accept_lang, "content-type": "application/json",
          origin: dom.origin, referer: dom.origin + "/",
          "sec-ch-ua": h.sec_ch_ua, "sec-ch-ua-mobile": h.sec_ch_ua_mobile, "sec-ch-ua-platform": h.sec_ch_ua_platform,
          "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", "sec-fetch-site": "same-origin", "user-agent": h.user_agent,
        },
        body: JSON.stringify({ hostname: dom.hostname, key: siteKey, token: r.token }),
      }, jar, proxy);
    } catch { /* tmpt déjà dans le jar */ }
    tmpt = jar.get("tmpt"); epsSid = jar.get("eps_sid");
  }
  if (!tmpt) throw new Error("tmpt absent (POST " + dom.epsPath + ")");

  return { tmpt, eps_sid: epsSid, token: r.token, headers: h, profileId: r.profileId, ms: Date.now() - t0 };
}

/**
 * solveLogin — login Ticketmaster COMPLET, 100 % REQUEST (SANS navigateur). Génère les DEUX tokens
 * reCAPTCHA flat (XV LoginPage → cookie tmpt ; ZB login → corps sign-in), établit la session OAuth
 * (GET authorize 2× : le 2e, avec le tmpt, pose `ma.paramsToken` qui encode le scope), puis POST
 * /json/sign-in avec tous les cookies auth.ticketmaster.
 *
 * Le token ZB porte un score assez haut pour passer l'anti-bot (signInSimple) grâce au field16 signin
 * (exec-time humain ~10 s, compteurs de frappe cohérents, etc.) — cf. api/vm/Field16Collector.js.
 * Un sign-in ACCEPTÉ renvoie HTTP 200 + une étape post-login (add-passkey ou vérification d'identité
 * Persona selon la réputation device) ; ce N'EST PAS un blocage anti-bot.
 *
 * @param {{email:string, password:string, proxy?:string, hl?:string, fingerprintId?:string}} o
 * @returns {Promise<{status:number, ok:boolean, blocked:boolean, body:any, tmpt:string, tokens:{xv:string,zb:string}}>}
 *   ok=true si l'anti-bot est passé (pas de "Operation Not Allowed"/block).
 */
export async function solveLogin({ email, password, proxy = null, hl = "fr", fingerprintId = null, site = "ticketmaster" }) {
  if (!email || !password) throw new Error("email + password requis");
  const cfg = CONST.sites[site];
  if (!cfg || !cfg.oauth) throw new Error("site sans config login: " + site);
  const AUTH = cfg.authOrigin;
  const AUTH_HOST = new URL(AUTH).host;
  const o = cfg.oauth;
  const AUTH_URL = AUTH + o.path + "?" + new URLSearchParams({
    client_id: o.clientId, response_type: o.responseType, scope: o.scope, redirect_uri: o.redirectUri,
    visualPresets: o.visualPresets, lang: o.lang, placementId: o.placementId, hideLeftPanel: o.hideLeftPanel,
    integratorId: o.integratorId, intSiteToken: o.intSiteToken, disableAutoOptIn: o.disableAutoOptIn,
  }).toString().replace(/\+/g, "%20");
  const XV = cfg.sitekeys.tmpt;   // sitekey du tmpt (LoginPage)
  const ZB = cfg.sitekeys.login;  // sitekey du corps sign-in (login)
  const jar = new CookieJar();    // session partagée sur tout le flux
  const swallow = (p) => p.catch(() => {}); // non-2xx toléré : les Set-Cookie sont stockés avant le throw

  // 1) Token XV LoginPage (→ tmpt) — fournit aussi les client-hints cohérents (UA/sec-ch-ua)
  const xv = await solveToken({ siteKey: XV, action: "LoginPage", origin: AUTH, referer: AUTH_URL, proxy, hl, enterprise: true, fingerprintId });
  if (!xv.token) throw new Error("token XV LoginPage null");
  const h = xv.headers;
  const ch = { "sec-ch-ua": h.sec_ch_ua, "sec-ch-ua-mobile": h.sec_ch_ua_mobile, "sec-ch-ua-platform": h.sec_ch_ua_platform };
  const nav = { "user-agent": h.user_agent, "accept-language": h.accept_lang, accept: "text/html,application/xhtml+xml", ...ch, "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", "sec-fetch-site": "none", "upgrade-insecure-requests": "1" };

  // 2) GET authorize (bootstrap session) + GET eps-mgr (→ eps_sid)
  await swallow(HttpClient.fetchText(AUTH_URL, nav, jar, proxy));
  await swallow(HttpClient.fetchText(AUTH + cfg.epsMgrPath, { "user-agent": h.user_agent, "accept-language": h.accept_lang, accept: "*/*", referer: AUTH_URL, ...ch, "sec-fetch-dest": "script", "sec-fetch-mode": "no-cors", "sec-fetch-site": "same-origin" }, jar, proxy));

  // 3) POST epsf/gec/v3/LoginPage { hostname, key, token } → cookie tmpt
  await swallow(HttpClient.fetchBuffer(AUTH + cfg.epsPath + "LoginPage", { method: "POST", headers: { "user-agent": h.user_agent, "accept-language": h.accept_lang, accept: "*/*", "content-type": "application/json", origin: AUTH, referer: AUTH + "/", ...ch, "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", "sec-fetch-site": "same-origin" }, body: JSON.stringify({ hostname: AUTH_HOST, key: XV, token: xv.token }) }, jar, proxy));
  if (!jar.get("tmpt")) throw new Error("tmpt absent (POST " + cfg.epsPath + "LoginPage)");

  // 3b) GET authorize À NOUVEAU (avec le tmpt) → pose ma.paramsToken (scope) + ma.SID/ma.GSID/…
  await swallow(HttpClient.fetchText(AUTH_URL, nav, jar, proxy));

  // 4) Token ZB login (corps du sign-in)
  const zb = await solveToken({ siteKey: ZB, action: "login", origin: AUTH, referer: AUTH_URL, proxy, hl, enterprise: false, fingerprintId });
  if (!zb.token) throw new Error("token ZB login null");

  // 5) POST /json/sign-in avec tous les cookies auth
  const r = await HttpClient.fetchRaw(AUTH + cfg.signInPath, { method: "POST", headers: { "user-agent": h.user_agent, "accept-language": h.accept_lang, accept: "*/*", "content-type": "application/json", origin: AUTH, referer: AUTH_URL, ...ch, "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", "sec-fetch-site": "same-origin", ...cfg.signInHeaders }, body: JSON.stringify({ email, password, recaptchaToken: zb.token, externalUserToken: null }) }, jar, proxy);
  let body; try { body = JSON.parse(r.text); } catch { body = r.text; }
  const blocked = /Operation Not Allowed/i.test(r.text) || /"response"\s*:\s*"block"/.test(r.text);
  return { status: r.status, ok: !blocked, blocked, body, tmpt: jar.get("tmpt"), tokens: { xv: xv.token, zb: zb.token } };
}

// CLI : node index.mjs [url] [proxy]   |   node index.mjs login <email> <password> [proxy]
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith(process.argv[1]?.replace(/\\/g, "/"))) {
  if (process.argv[2] === "login") {
    const [, , , email, password, proxy] = process.argv;
    solveLogin({ email, password, proxy: proxy || null })
      .then((r) => { console.log(JSON.stringify({ status: r.status, ok: r.ok, blocked: r.blocked, body: r.body }, null, 2)); process.exit(r.ok ? 0 : 1); })
      .catch((e) => { console.error("ERREUR:", e.message); process.exit(1); });
  } else {
    const url = process.argv[2] || "https://www.ticketmaster.com/";
    const proxy = process.argv[3] || null;
    solveTmpt({ url, action: "Event", siteKey: CONST.sites.ticketmaster.sitekeys.tmpt, proxy })
      .then((r) => { console.log(JSON.stringify({ ok: true, tmpt: r.tmpt, eps_sid: r.eps_sid, token: r.token.slice(0, 40) + "…", ms: r.ms, headers: r.headers }, null, 2)); process.exit(0); })
      .catch((e) => { console.error("ERREUR:", e.message); process.exit(1); });
  }
}
