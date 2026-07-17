/**
 * server.mjs — API HTTP (Node pur, zéro dépendance) pour générer des tokens reCAPTCHA v3.
 *
 * Lancer :  node server.mjs           (port 3848, ou PORT=xxxx)
 *
 * Endpoints
 * ─────────
 * POST /api/captcha/tmpt      génère le cookie `tmpt` Ticketmaster (pipeline complet)
 *   body JSON :
 *   {
 *     "url":     "https://www.ticketmaster.com/event/…",  // REQUIS — son host décide où va /eps-mgr + le POST
 *     "proxy":   "http://user:pass@host:port",            // optionnel (recommandé, utilisé pour TOUT le flux)
 *     "action":  "Event",                                 // optionnel (défaut "LoginPage") → /epsf/gec/v3/<action>
 *     "sitekey": "6Lcv…",                                 // optionnel (défaut sitekey TM ; sinon sitekey alt)
 *     "isEnterprise": <ignoré>,                           // HARDCODÉ à false (mode standard api2 pour les 2 sitekeys)
 *     "hl": "fr",                                         // optionnel (langue)
 *     "executeTimes": 2                                   // optionnel (nb d'execute() jsdom ; +1 → +score)
 *   }
 *   (alias tolérés : websiteUrl → url, recaptchaSitekey → sitekey ; isEnterprise optionnel)
 *   réponse : { "status":"success", "method":"tmpt", "data": {
 *       "tmpt", "eps_sid", "token", "user_agent", "accept_lang",
 *       "sec_ch_ua", "sec_ch_ua_mobile", "sec_ch_ua_platform", "reload_status", "field16_len", "mode", "ms" } }
 *   ("token" = le VRAI token reCAPTCHA (champ 16 réel généré par l'algo Google via jsdom))
 *   ⚠️ Rejouer user_agent + sec_ch_ua* de la réponse ET le même proxy quand on utilise le tmpt.
 *
 * POST /api/captcha/token     génère le VRAI token reCAPTCHA v3 SCORÉ (champ `recaptchaToken`)
 *   body JSON :
 *   {
 *     "url":     "https://auth.ticketmaster.com/…",  // REQUIS — décide origin/referer
 *     "sitekey": "6Ldo…",                            // optionnel (défaut sitekey TM)
 *     "action":  "login",                            // optionnel (action reCAPTCHA ; défaut "login")
 *     "isEnterprise": false,                         // optionnel (enterprise.js au lieu de standard)
 *     "proxy":   "http://user:pass@host:port",       // optionnel
 *     "hl": "fr"                                     // optionnel
 *   }
 *   réponse : { "status":"success", "method":"token", "data": {
 *       "token", "user_agent", "accept_lang", "sec_ch_ua", "sec_ch_ua_mobile", "sec_ch_ua_platform",
 *       "reload_status", "field16_len", "mode", "ms" } }
 *
 * GET /api/score/demo         génère un token reCAPTCHA pour le démo Google + renvoie le score réel
 * GET /health                 { status:"ok" }
 */
import http from "node:http";
import { solve, verifyDemoScore, DEMO } from "./index.mjs";
import { solveViaJsdom } from "./api/JsdomSolver.mjs";
import { fetchTmpt, DEFAULT_SITE_KEY, ALT_SITE_KEY } from "./tmpt.mjs";

const PORT = Number(process.env.PORT) || 3848;
const VERBOSE = process.env.RECAPTCHA_VERBOSE === "1";

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1e6) { reject(new Error("body trop gros")); req.destroy(); }
    });
    req.on("end", () => {
      if (!data.trim()) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(new Error("JSON invalide")); }
    });
    req.on("error", reject);
  });
}

function originOf(u) {
  try { return new URL(u).origin; } catch { return u; }
}

async function handleTmpt(req, res) {
  const b = await readJson(req);

  // Accepte l'alias { url, sitekey } (test_tmpt.py) ET { websiteUrl, recaptchaSitekey }.
  const url = b.url || b.websiteUrl;
  const siteKey = b.sitekey || b.recaptchaSitekey || b.siteKey || DEFAULT_SITE_KEY;
  const action = (b.action || "LoginPage").trim();
  // TM tmpt = mode STANDARD (api2) HARDCODÉ pour les 2 sitekeys (l'enterprise n'apporte rien,
  // cf. fetchTmpt + mémoire). Le champ isEnterprise du body est ignoré.
  const isEnterprise = false;
  const proxy = b.proxy || null;
  const hl = b.hl || "fr";
  const executeTimes = b.executeTimes ? Number(b.executeTimes) : undefined;
  const warm = b.warm === true || b.warm === "true";
  const poolSize = b.poolSize ? Number(b.poolSize) : undefined;

  if (!url) return send(res, 400, { status: "error", method: "tmpt", error: "url requis" });
  if (siteKey !== DEFAULT_SITE_KEY && siteKey !== ALT_SITE_KEY)
    return send(res, 400, { status: "error", method: "tmpt", error: "sitekey non supportée" });

  try {
    const data = await fetchTmpt({ url, action, siteKey, isEnterprise, proxy, hl, executeTimes, warm, poolSize, verbose: VERBOSE });
    // data = { tmpt, eps_sid, token, user_agent, accept_lang, sec_ch_ua, sec_ch_ua_mobile, sec_ch_ua_platform, profileId, mode, ms }
    return send(res, 200, { status: "success", method: "tmpt", data });
  } catch (e) {
    return send(res, 500, { status: "error", method: "tmpt", error: String(e?.message || e) });
  }
}

async function handleToken(req, res) {
  const b = await readJson(req);

  const url = b.url || b.websiteUrl;
  const siteKey = b.sitekey || b.recaptchaSitekey || b.siteKey || DEFAULT_SITE_KEY;
  const action = (b.action || "login").trim();
  const proxy = b.proxy || null;
  const hl = b.hl || "fr";
  const isEnterprise = b.isEnterprise === true || b.isEnterprise === "true";
  const executeTimes = b.executeTimes ? Number(b.executeTimes) : undefined;

  if (!url) return send(res, 400, { status: "error", method: "token", error: "url requis" });

  // VRAI token reCAPTCHA v3 : champ 16 généré par l'algo réel (jsdom), /reload HTTP 200 — PAS de "HF…".
  const origin = originOf(url);
  const t0 = Date.now();
  try {
    const r = await solveViaJsdom({
      siteKey,
      action,
      origin,
      pageUrl: url, // page exacte vue par la VM (auth.ticketmaster.com/as/authorization.oauth2?…)
      proxy,
      hl,
      mode: isEnterprise ? "enterprise" : "standard",
      executeTimes,
      verbose: VERBOSE,
    });
    if (!r.token) return send(res, 502, { status: "error", method: "token", error: "token null (jsdom)" });

    return send(res, 200, {
      status: "success",
      method: "token",
      data: {
        token: r.token, // token à placer dans "recaptchaToken"
        reload_status: r.reloadStatus,
        field16_len: r.field16Len,
        mode: isEnterprise ? "enterprise" : "standard",
        ms: Date.now() - t0,
        ...r.clientHints, // user_agent, accept_lang, sec_ch_ua, sec_ch_ua_mobile, sec_ch_ua_platform
      },
    });
  } catch (e) {
    return send(res, 500, { status: "error", method: "token", error: String(e?.message || e) });
  }
}

async function handleScoreDemo(req, res) {
  try {
    const r = await solve({ ...DEMO });
    if (!r.token) return send(res, 502, { status: "error", error: r.hint || "token null" });
    const v = await verifyDemoScore(r.token, DEMO.action);
    return send(res, 200, {
      status: "success",
      data: { score: v.score, success: v.success, profileId: r.profileId, token: r.token, raw: v.raw },
    });
  } catch (e) {
    return send(res, 500, { status: "error", error: String(e?.message || e) });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (req.method === "POST" && url.pathname === "/api/captcha/tmpt") return handleTmpt(req, res);
    if (req.method === "POST" && url.pathname === "/api/captcha/token") return handleToken(req, res);
    if (req.method === "GET" && url.pathname === "/api/score/demo") return handleScoreDemo(req, res);
    if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { status: "ok" });
    return send(res, 404, { status: "error", error: "route inconnue" });
  } catch (e) {
    return send(res, 500, { status: "error", error: String(e?.message || e) });
  }
});

server.listen(PORT, () => {
  console.log(`API reCAPTCHA v3 (Voie B) — http://127.0.0.1:${PORT}`);
  console.log(`  POST /api/captcha/tmpt   POST /api/captcha/token   GET /api/score/demo   GET /health`);
});
