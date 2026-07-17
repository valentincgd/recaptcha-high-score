/**
 * tmpt.mjs — Génère le cookie `tmpt` de Ticketmaster en Node PUR (zéro dépendance).
 *
 * Pipeline :
 *   solveViaJsdom() → VRAI token reCAPTCHA v3 : le champ 16 est produit par l'ALGO de Google
 *                     lui-même (recaptcha__fr.js exécuté dans jsdom) → /reload HTTP 200 accepté.
 *   GET  /eps-mgr              → cookie eps_sid
 *   POST /epsf/gec/v3/<action> { hostname, key, token, eps_sid } → cookie tmpt
 *
 * ⚠️  Plus de token "HF…" ni de champ 16 approximé (VmPureReloadBuilder). Le champ 16 est
 *     EXACT car généré par le vrai script (deriveSignalCode + cipher vivent dans du bytecode
 *     dynamique, non réimplémentables — cf. result.md §9/§10). jsdom = browserless (pas de Chromium).
 *
 * Rejouer sur la requête cible : user_agent + sec_ch_ua* renvoyés ET le même proxy.
 */
import { solveViaJsdom } from "./api/JsdomSolver.mjs";
import { getPooledToken } from "./api/WarmService.mjs";
import { HttpClient } from "./api/HttpClient.js";
import { CookieJar } from "./api/CookieJar.js";

export const DEFAULT_SITE_KEY = "6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV";
export const ALT_SITE_KEY = "6LdoaXQrAAAAADQviABd-eByJu6kPL8awKDyc1zb";

/* ─────────────────────────── Résolution du domaine (Go: ResolveDomain) ─────────────────────────── */

function resolveDomain(pageUrl, action) {
  action = (action || "").trim() || "LoginPage";
  let origin, hostname, referer;
  try {
    const u = new URL(pageUrl);
    origin = `${u.protocol}//${u.host}`;
    hostname = u.hostname;
    referer = pageUrl;
  } catch {
    hostname = "www.ticketmaster.com";
    origin = "https://" + hostname;
    referer = origin + "/";
  }
  return { origin, hostname, referer, action, epsPath: "/epsf/gec/v3/" + action };
}

/* ─────────────────────────── Ticketmaster: eps-mgr + epsf (Go: tmpt/fetch.go) ─────────────────────────── */

async function fetchEpsMgr({ origin, referer, hints, jar, proxy }) {
  const url = origin + "/eps-mgr";
  try {
    await HttpClient.fetchText(
      url,
      {
        accept: "*/*",
        "accept-language": hints.accept_lang,
        referer,
        "sec-ch-ua": hints.sec_ch_ua,
        "sec-ch-ua-mobile": hints.sec_ch_ua_mobile,
        "sec-ch-ua-platform": hints.sec_ch_ua_platform,
        "sec-fetch-dest": "script",
        "sec-fetch-mode": "no-cors",
        "sec-fetch-site": "same-origin",
        "sec-gpc": "1",
        "upgrade-insecure-requests": "1",
        "user-agent": hints.user_agent,
      },
      jar,
      proxy,
    );
  } catch {
    /* non-2xx toléré : le cookie eps_sid est stocké dans le jar avant le throw */
  }
  const epsSid = jar.get("eps_sid");
  if (!epsSid) throw new Error("eps_sid absent (GET /eps-mgr)");
  return epsSid;
}

async function postEpsf({ origin, epsPath, hostname, siteKey, token, epsSid, hints, jar, proxy }) {
  const url = origin + epsPath;
  // Corps IDENTIQUE au vrai client (eps-gec.js setGecCookiesV3) : { hostname, key, token }.
  // L'eps_sid part en COOKIE (jar), PAS dans le corps ("credentials: include" côté navigateur).
  void epsSid;
  const body = JSON.stringify({ hostname, key: siteKey, token });
  try {
    await HttpClient.fetchBuffer(
      url,
      {
        method: "POST",
        headers: {
          accept: "*/*",
          "accept-language": hints.accept_lang,
          "content-type": "application/json",
          origin,
          referer: origin + "/",
          "sec-ch-ua": hints.sec_ch_ua,
          "sec-ch-ua-mobile": hints.sec_ch_ua_mobile,
          "sec-ch-ua-platform": hints.sec_ch_ua_platform,
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
          "user-agent": hints.user_agent,
        },
        body,
      },
      jar,
      proxy,
    );
  } catch {
    /* non-2xx toléré : le cookie tmpt est stocké dans le jar avant le throw */
  }
  const tmpt = jar.get("tmpt");
  if (!tmpt) throw new Error("tmpt absent (POST " + epsPath + ")");
  return tmpt;
}

/* ─────────────────────────── API publique ─────────────────────────── */

/**
 * Génère un cookie `tmpt` Ticketmaster complet, à partir du VRAI token reCAPTCHA scoré.
 * @param {object} o
 * @param {string} o.url        page Ticketmaster (son host décide où va /eps-mgr et le POST, + origin/referer reCAPTCHA)
 * @param {string} [o.action]   suffixe du path epsf ET action reCAPTCHA (défaut "LoginPage" ; ex "Event")
 * @param {string} [o.siteKey]  sitekey publique (défaut = sitekey TM)
 * @param {boolean} [o.isEnterprise]  enterprise.js au lieu d'api2 (défaut false)
 * @param {string} [o.proxy]    proxy http(s) pour TOUTES les requêtes sortantes
 * @param {string} [o.fingerprintId]
 * @param {boolean} [o.verbose]
 * @returns {Promise<{tmpt, eps_sid, token, user_agent, accept_lang, sec_ch_ua, sec_ch_ua_mobile, sec_ch_ua_platform, profileId, mode, ms}>}
 */
export async function fetchTmpt({
  url,
  action = "LoginPage",
  siteKey = DEFAULT_SITE_KEY,
  isEnterprise = false, // ignoré — voir override ci-dessous
  proxy = null,
  hl = "fr",
  executeTimes, // nb d'execute() jsdom (défaut générateur = 2 ; +1 → +score, +lent)
  warm = false, // true → pool de fenêtres CHAUDES à empreinte tournante (~1,4 s/token vs ~9–13 s)
  poolSize = 3, // nb de profils/fenêtres du pool (empreintes distinctes en rotation)
  verbose = false,
}) {
  if (!url) throw new Error("url requis");
  // HARDCODE mode STANDARD (api2) pour les DEUX sitekeys (6Lcv www + 6Ldo auth). Constaté 2026-07 :
  // le mode enterprise n'apporte AUCUN gain (même verdict tmpt à IP fixe) et le standard est au moins
  // aussi tolérant au proxy ; les deux marchent en direct (replay 200). Voir mémoire field16-jsdom-solution.
  isEnterprise = false;
  const log = verbose ? (...a) => console.error("[tmpt]", ...a) : () => {};
  const t0 = Date.now();

  const dom = resolveDomain(url, action);
  log("solve", `url=${url} post=${dom.origin}${dom.epsPath} warm=${warm}`);

  // 1) VRAI token reCAPTCHA v3 : champ 16 généré par l'algo réel (jsdom), /reload HTTP 200.
  //    warm=true → pool chaud (empreinte tournante, rapide) ; sinon spawn frais par token.
  const solveOpts = {
    siteKey, action: dom.action, origin: dom.origin, pageUrl: url,
    proxy, hl, mode: isEnterprise ? "enterprise" : "standard",
  };
  const r = warm
    ? await getPooledToken({ ...solveOpts, poolSize })
    : await solveViaJsdom({ ...solveOpts, executeTimes, verbose });
  if (!r.token) throw new Error("token reCAPTCHA null (jsdom)");
  log("token", `${r.token.length}o (reload HTTP ${r.reloadStatus}, champ16=${r.field16Len}${r.profileId ? ", profil " + r.profileId : ""})`);

  // Client-hints cohérents avec le token (à rejouer sur la requête cible ET les étapes TM).
  const hints = { ...r.clientHints }; // { user_agent, accept_lang, sec_ch_ua, sec_ch_ua_mobile, sec_ch_ua_platform }

  // 2) GET /eps-mgr → eps_sid
  const jar = new CookieJar();
  const epsSid = await fetchEpsMgr({ origin: dom.origin, referer: dom.referer, hints, jar, proxy });
  log("eps-mgr", `eps_sid=${epsSid.length}`);

  // 3) POST /epsf/gec/v3/<action> { token } → cookie tmpt
  const tmpt = await postEpsf({
    origin: dom.origin,
    epsPath: dom.epsPath,
    hostname: dom.hostname,
    siteKey,
    token: r.token,
    epsSid,
    hints,
    jar,
    proxy,
  });
  log("tmpt", `${tmpt.length}o`);

  return {
    tmpt,
    eps_sid: epsSid,
    token: r.token, // le token reCAPTCHA (champ 16 réel) utilisé pour obtenir le tmpt
    ...hints,
    reload_status: r.reloadStatus,
    field16_len: r.field16Len,
    profile_id: r.profileId || null,
    mode: isEnterprise ? "enterprise" : "standard",
    ms: Date.now() - t0,
  };
}
