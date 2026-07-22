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
import os from "node:os";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { solve, verifyDemoScore, DEMO } from "./index.mjs";
import { solveViaJsdom } from "./api/JsdomSolver.mjs";
import { getPooledToken, warmupPool, warmStatus, stopWarm } from "./api/WarmService.mjs";
import { fetchTmpt, DEFAULT_SITE_KEY, ALT_SITE_KEY } from "./tmpt.mjs";
import { solveFlat } from "./flat.mjs";

const PORT = Number(process.env.PORT) || 3848;
const VERBOSE = process.env.RECAPTCHA_VERBOSE === "1";
// Débit jsdom mesuré : ~4 tok/s/fenêtre, CPU-bound, optimum ≈ (cœurs−2) fenêtres (au-delà, le
// context-switch dégrade). poolSize par défaut = cœurs−2 → sature la machine sans la surcharger.
// Override via RC_POOL_SIZE. Fleet 500/s = ~125 cœurs (voir SCALING.md).
const DEFAULT_POOL = Number(process.env.RC_POOL_SIZE) || Math.max(3, os.cpus().length - 2);
const RCJSDOM_ROOT = process.env.RC_JSDOM_ROOT ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "vendor", "rcjsdom");
const CACHE_HL = process.env.RC_HL || "fr";

// Cache scripts/ (recaptcha__<hl>.js) rafraîchi UNE SEULE FOIS, avant tout spawn jsdom. Ensuite tous
// les process (warm + cold) tournent en RC_NO_FETCH=1 → jamais de re-download concurrent (4 spawns
// parallèles réécrivant scripts/ = fichier corrompu → "grecaptcha non prêt" / 500). Un seul hl à la fois.
let _cacheReadyP = null;
function cacheReady() {
  if (_cacheReadyP) return _cacheReadyP;
  _cacheReadyP = new Promise((resolve) => {
    const code =
      "require('./tools/fetch_scripts').fetchScripts({quiet:true})" +
      ".then(m=>{process.stdout.write('OK '+(m&&m.version||''));process.exit(0)})" +
      ".catch(e=>{process.stderr.write(String(e&&e.message||e));process.exit(1)})";
    const p = spawn(process.execPath, ["-e", code], { cwd: RCJSDOM_ROOT, env: { ...process.env, RC_HL: CACHE_HL } });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("exit", (c) => { console.log(`  cache scripts/ (hl=${CACHE_HL}) → ${c === 0 ? out.trim() : "KO " + err.slice(-120) + " (cache existant réutilisé)"}`); resolve(); });
    p.on("error", (e) => { console.log(`  cache refresh KO: ${e.message} (cache existant réutilisé)`); resolve(); });
  });
  return _cacheReadyP;
}

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

const TM_XV = DEFAULT_SITE_KEY; // 6Lcv…zndXV — tmpt/event
const TM_ZB = ALT_SITE_KEY;     // 6Ldo…c1zb — soumission de form
function isTmHost(url) {
  try { return /(^|\.)ticketmaster\.com$/i.test(new URL(url).hostname); } catch { return false; }
}
// Sitekey pour /api/captcha/token = le token de SOUMISSION de form :
//   TOUT host *.ticketmaster.com (login, auth ET www) → ZB (6Ldo). C'est la règle « ZB = les forms ».
//   host non-TM → XV par défaut (mais un site non-TM passe toujours body.sitekey).
// NB : le tmpt (/api/captcha/tmpt) utilise XV EN TOUTES CIRCONSTANCES, y compris sur auth — géré à part.
function autoSiteKey(url, explicit) {
  if (explicit) return explicit; // le caller peut toujours forcer
  return isTmHost(url) ? TM_ZB : TM_XV;
}

// ─── Auto-warm : au 1er appel d'une config (sitekey|mode|hl), boote TOUT le pool en parallèle en
// arrière-plan (fire-and-forget). Les fenêtres suivantes du round-robin sont déjà chaudes → seul le
// tout premier token paie un boot, pas les 2-3 suivants. Le proxy est appliqué par requête (hors clé).
const _warmedCombos = new Set();
function autoWarm({ siteKey, origin, pageUrl, mode, hl, poolSize }) {
  const k = `${siteKey}|${mode}|${hl}`;
  if (_warmedCombos.has(k)) return;
  _warmedCombos.add(k);
  Promise.resolve(warmupPool({ siteKey, origin, pageUrl, mode, hl, poolSize })).then(
    (st) => { if (VERBOSE) console.error("[warm] pool prêt", k, "→", (st || []).filter(w => w.ready).length, "fenêtres"); },
    (e) => { _warmedCombos.delete(k); if (VERBOSE) console.error("[warm] warmup KO", e?.message || e); },
  );
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
  // Warm pool ACTIVÉ par défaut (bootstrap jsdom amorti → ~400 ms/token vs ~9–13 s cold).
  // warm:false → cold spawn par token (nécessaire si le proxy tourne à chaque token).
  const warm = b.warm !== false && b.warm !== "false";
  const poolSize = b.poolSize ? Number(b.poolSize) : DEFAULT_POOL;
  // pure = field16 VOIE B PURE ancienne (approx) — conservé pour compat.
  const pure = b.pure === true || b.pure === "true";
  // HYBRIDE (sélection auto par cible) :
  //  - www.ticketmaster.com (event-page / quickpicks, protégés par tm-bl) EXIGENT un field16
  //    d'exécution genuine → jsdom (warm pool). Le flat/replay y est bloqué (403). Voir mémoire
  //    www-tm-needs-fresh-field16 : à IP égale, jsdom=200, flat=403.
  //  - tout le reste (auth.ticketmaster.com, démo, autres) → flat pur byte-exact (rapide, ~0,5-1 s).
  //  Override explicite : body.flat=true/false force le choix.
  const wwwHost = (() => { try { return new URL(url).hostname.toLowerCase() === "www.ticketmaster.com"; } catch { return false; } })();
  const flatDefault = !wwwHost; // flat partout SAUF www TM
  const flat = (b.flat === undefined ? flatDefault : (b.flat !== false && b.flat !== "false")) && !pure;

  if (!url) return send(res, 400, { status: "error", method: "tmpt", error: "url requis" });
  if (siteKey !== DEFAULT_SITE_KEY && siteKey !== ALT_SITE_KEY)
    return send(res, 400, { status: "error", method: "tmpt", error: "sitekey non supportée" });

  if (!pure && !flat) {
    await cacheReady(); // fetch du cache scripts/ 1× avant tout spawn jsdom (évite la corruption concurrente)
    if (warm) autoWarm({ siteKey, origin: originOf(url), pageUrl: url, mode: "standard", hl, poolSize }); // boote le pool en fond
  }
  try {
    const delayMs = b.delayMs != null ? Number(b.delayMs) : null;
    const data = await fetchTmpt({ url, action, siteKey, isEnterprise, proxy, hl, executeTimes, warm, poolSize, pure, flat, delayMs, verbose: VERBOSE });
    // data = { tmpt, eps_sid, token, user_agent, accept_lang, sec_ch_ua, sec_ch_ua_mobile, sec_ch_ua_platform, profileId, mode, ms }
    return send(res, 200, { status: "success", method: "tmpt", data });
  } catch (e) {
    return send(res, 500, { status: "error", method: "tmpt", error: String(e?.message || e) });
  }
}

async function handleToken(req, res) {
  const b = await readJson(req);

  const url = b.url || b.websiteUrl;
  // Auto : auth.ticketmaster.com → ZB (6Ldo, form submit) ; sinon XV. Overridable via body.sitekey.
  const siteKey = autoSiteKey(url, b.sitekey || b.recaptchaSitekey || b.siteKey);
  const action = (b.action || "login").trim();
  const proxy = b.proxy || null;
  const hl = b.hl || "fr";
  const isEnterprise = b.isEnterprise === true || b.isEnterprise === "true";
  const executeTimes = b.executeTimes ? Number(b.executeTimes) : undefined;
  // Warm pool ACTIVÉ par défaut : le bootstrap jsdom (~require+download+build ≈ 6 s à sec, 9–13 s via
  // proxy) est amorti une fois par fenêtre → ~400 ms/token ensuite. warm:false → cold spawn par token
  // (à utiliser si le proxy change à chaque token : le warm fige (sitekey, mode, proxy) par fenêtre).
  const warm = b.warm !== false && b.warm !== "false";
  const poolSize = b.poolSize ? Number(b.poolSize) : DEFAULT_POOL;
  const flat = b.flat !== false && b.flat !== "false"; // DÉFAUT : flat.mjs byte-exact, zéro jsdom

  if (!url) return send(res, 400, { status: "error", method: "token", error: "url requis" });

  const origin = originOf(url);
  const mode = isEnterprise ? "enterprise" : "standard";
  const t0 = Date.now();

  // VOIE FLAT byte-exact (zéro jsdom) — défaut. Génère le token reCAPTCHA v3 en pur Node.
  if (flat) {
    try {
      // PRIMING du champ 7 (usagePatternToken) : pour le SIGN-IN (ZB 6Ldo / action login), amorcer la
      // chaîne /reload pour récolter+écho le token serveur (cf. botguard-crack-todo). Le champ 7 riche
      // augmente le score sur les endpoints à forte scrutation. Défaut 2 pour login/ZB, sinon 0 (event).
      // Overridable via body.prime.
      const isSignin = /^6Ldo/i.test(siteKey) || /login|signin|sign-in/i.test(action);
      const prime = b.prime != null ? Number(b.prime) : (isSignin ? 2 : 0);
      const fr = await solveFlat({ siteKey, action, origin, referer: origin + "/", mode: isEnterprise ? "enterprise" : "api2", proxy, prime });
      if (fr.token) {
        return send(res, 200, {
          status: "success", method: "token",
          data: {
            token: fr.token, sitekey: siteKey, profileId: fr.profileId, source: "flat", prime,
            user_agent: fr.clientHints.user_agent, accept_lang: fr.clientHints.accept_lang,
            sec_ch_ua: fr.clientHints.sec_ch_ua, sec_ch_ua_mobile: fr.clientHints.sec_ch_ua_mobile,
            sec_ch_ua_platform: fr.clientHints.sec_ch_ua_platform, ms: Date.now() - t0,
          },
        });
      }
    } catch (e) { if (VERBOSE) console.error("[token] flat KO → fallback jsdom:", e?.message || e); }
  }

  await cacheReady(); // fetch du cache scripts/ 1× avant tout spawn (évite la corruption concurrente)
  // VRAI token reCAPTCHA v3 : champ 16 généré par l'algo réel (jsdom), /reload HTTP 200 — PAS de "HF…".
  try {
    let r = null;
    let source = "cold";
    if (warm) {
      autoWarm({ siteKey, origin, pageUrl: url, mode, hl, poolSize }); // boote le pool en arrière-plan (1x/config)
      try {
        r = await getPooledToken({ siteKey, action, origin, pageUrl: url, proxy, hl, mode, poolSize });
        source = "warm";
      } catch (e) {
        if (VERBOSE) console.error("[token] warm KO → fallback cold:", e?.message || e);
        r = null;
      }
    }
    if (!r || !r.token) {
      source = "cold";
      r = await solveViaJsdom({
        siteKey,
        action,
        origin,
        pageUrl: url, // page exacte vue par la VM (auth.ticketmaster.com/as/authorization.oauth2?…)
        proxy,
        hl,
        mode,
        executeTimes,
        verbose: VERBOSE,
      });
    }
    if (!r.token) return send(res, 502, { status: "error", method: "token", error: "token null (jsdom)" });

    return send(res, 200, {
      status: "success",
      method: "token",
      data: {
        token: r.token, // token à placer dans "recaptchaToken"
        sitekey: siteKey, // ZB (6Ldo) pour auth/login, XV (6Lcv) sinon
        reload_status: r.reloadStatus,
        field16_len: r.field16Len,
        mode,
        source, // "warm" (rapide) | "cold" (fallback)
        profile_id: r.profileId || null,
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
    if (req.method === "GET" && url.pathname === "/api/warm/status") return send(res, 200, { status: "ok", windows: warmStatus() });
    if (req.method === "POST" && url.pathname === "/api/warm/stop") { stopWarm(); return send(res, 200, { status: "ok", stopped: true }); }
    if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { status: "ok", warm: warmStatus().length });
    return send(res, 404, { status: "error", error: "route inconnue" });
  } catch (e) {
    return send(res, 500, { status: "error", error: String(e?.message || e) });
  }
});

server.listen(PORT, () => {
  console.log(`API reCAPTCHA v3 (Voie B) — http://127.0.0.1:${PORT}`);
  console.log(`  POST /api/captcha/tmpt   POST /api/captcha/token   GET /api/score/demo`);
  console.log(`  GET /api/warm/status   POST /api/warm/stop   GET /health`);
  console.log(`  warm pool: ON par défaut (warm:false pour cold spawn). 1er token = boot ~5 s, puis ~400 ms.`);
});

// Arrêt propre : tue les fenêtres jsdom chaudes (process enfants) avant de sortir.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => { try { stopWarm(); } catch {} process.exit(0); });
}
