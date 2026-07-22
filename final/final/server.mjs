/**
 * server.mjs — API HTTP du générateur de token reCAPTCHA v3 (100 % JS pur, sans navigateur).
 *
 *   POST /token   body: { websiteUrl, recaptchaSitekey, proxy?, action?, isEnterprise? }
 *                 → { status, version, solveMethod, data: { gResponseToken, header {...} } }
 *   POST /tmpt    body: idem /token  → { ..., data: { tmpt, epsSid, gResponseToken, header } }
 *   GET  /health  → { status: "ok", version }
 *
 * Toutes les constantes/IDs sont dans constants.json — aucun hardcode dans le code.
 * Config serveur : PORT (défaut 3000).
 */
import http from "http";
import { solveToken, solveTmpt, CONST } from "./index.mjs";

const PORT = Number(process.env.PORT) || 3000;
const originOf = (url) => { try { return new URL(url).origin; } catch { return String(url || ""); } };

function send(res, code, obj) {
  const buf = Buffer.from(JSON.stringify(obj, null, 2));
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "content-length": buf.length });
  res.end(buf);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => { chunks.push(c); if (Buffer.concat(chunks).length > 1e6) reject(new Error("body trop gros")); });
    req.on("end", () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); } catch (e) { reject(new Error("JSON invalide")); } });
    req.on("error", reject);
  });
}

/** POST /token — génère un token reCAPTCHA v3 pour n'importe quel site. */
async function handleToken(b) {
  if (!b.websiteUrl || !b.recaptchaSitekey) throw new Error("websiteUrl et recaptchaSitekey requis");
  const r = await solveToken({
    siteKey: b.recaptchaSitekey,
    action: b.action || "verify",
    origin: originOf(b.websiteUrl),
    referer: b.pageUrl || b.websiteUrl,
    pageUrl: b.pageUrl || b.websiteUrl,
    title: b.pageTitle || "",
    proxy: b.proxy || null,
    enterprise: b.isEnterprise === true,
    fingerprintId: b.fingerprintId || null,
  });
  if (!r.token) throw new Error("génération du token échouée");
  return {
    status: "success",
    version: CONST.version,
    solveMethod: CONST.solveMethod,
    data: {
      gResponseToken: r.token,
      header: {
        userAgent: r.headers.user_agent,
        secChUa: r.headers.sec_ch_ua,
        secChUaPlatform: r.headers.sec_ch_ua_platform,
        secChUaMobile: r.headers.sec_ch_ua_mobile,
        acceptLang: r.headers.accept_lang,
      },
    },
  };
}

/** POST /tmpt — token reCAPTCHA + cookie `tmpt` Ticketmaster (token → /eps-mgr → /epsf/gec). */
async function handleTmpt(b) {
  if (!b.websiteUrl || !b.recaptchaSitekey) throw new Error("websiteUrl et recaptchaSitekey requis");
  const r = await solveTmpt({
    url: b.websiteUrl,
    action: b.action || "Event",
    siteKey: b.recaptchaSitekey,
    title: b.pageTitle || "",
    enterprise: b.isEnterprise === true,
    proxy: b.proxy || null,
    fingerprintId: b.fingerprintId || null,
  });
  return {
    status: "success",
    version: CONST.version,
    solveMethod: CONST.solveMethod,
    data: {
      tmpt: r.tmpt,
      epsSid: r.eps_sid,
      gResponseToken: r.token,
      header: {
        userAgent: r.headers.user_agent,
        secChUa: r.headers.sec_ch_ua,
        secChUaPlatform: r.headers.sec_ch_ua_platform,
        secChUaMobile: r.headers.sec_ch_ua_mobile,
        acceptLang: r.headers.accept_lang,
      },
    },
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { status: "ok", version: CONST.version });
  if (req.method !== "POST") return send(res, 404, { status: "error", error: "not found" });
  let body;
  try { body = await readJson(req); } catch (e) { return send(res, 400, { status: "error", version: CONST.version, error: e.message }); }
  try {
    if (url.pathname === "/token") return send(res, 200, await handleToken(body));
    if (url.pathname === "/tmpt") return send(res, 200, await handleTmpt(body));
    return send(res, 404, { status: "error", error: "route inconnue (POST /token | /tmpt)" });
  } catch (e) {
    return send(res, 500, { status: "error", version: CONST.version, error: String(e?.message || e) });
  }
});

server.listen(PORT, () => {
  console.log(`API reCAPTCHA — http://127.0.0.1:${PORT}`);
  console.log(`  POST /token   { websiteUrl, recaptchaSitekey, proxy?, action?, isEnterprise? }`);
  console.log(`  POST /tmpt    (idem, + cookie tmpt)`);
  console.log(`  GET  /health`);
});
