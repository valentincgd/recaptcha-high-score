/**
 * API HTTP — tokens reCAPTCHA (Ticketmaster via POST /api/token/tm).
 *
 *   npm start
 *   curl -X POST http://127.0.0.1:3847/api/token/tm -H "Content-Type: application/json" \
 *     -d '{"siteKey":"6LdoaXQrAAAAADQviABd-eByJu6kPL8awKDyc1zb","enterprise":true,"action":"login"}'
 *
 *   POST /api/token/tm     — Ticketmaster (origin TM par défaut)
 *   POST /api/token        — toute siteKey v2/Enterprise + origin du site enregistré
 *
 *   Exemple autre site :
 *   {"siteKey":"…","enterprise":false,"mode":"api2","action":"submit",
 *    "origin":"https://example.com","referer":"https://example.com/page"}
 */

import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { RecaptchaEnterprise } from "./api/RecaptchaEnterprise.js";
import { Config } from "./api/Config.js";
import {
  buildTokenRequestOptions,
  formatTicketmasterApiResponse,
  formatTokenApiResponse,
  applyTmNativePipelineEnv,
  validateExternalSiteRequest,
} from "./api/TicketmasterProfile.js";

if (process.env.RECAPTCHA_CHROME_CAPTURE == null) {
  process.env.RECAPTCHA_CHROME_CAPTURE = "0";
}
if (process.env.RECAPTCHA_AUTO_DUMP == null) {
  process.env.RECAPTCHA_AUTO_DUMP = "1";
}
import { VmDumper } from "./api/vm/VmDumper.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.RECAPTCHA_API_PORT || 3847);
const API_KEY = process.env.RECAPTCHA_API_KEY || "";

const TOKEN_FIELDS = [
  "siteKey",
  "origin",
  "referer",
  "action",
  "enterprise",
  "mode",
  "hl",
  "size",
  "anchorMs",
  "executeMs",
  "userAgent",
  "quiet",
  "verbose",
  "loginUrl",
  "loginEmail",
  "loginPassword",
  "skipReload",
  "useCookies",
  "variant",
  "tmVariant",
  "fingerprint",
  "fingerprintProfile",
  "chromeCapture",
  "autoDump",
];

function json(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Api-Key",
  });
  res.end(payload);
}

function checkApiKey(req) {
  if (!API_KEY) return true;
  const header = req.headers["x-api-key"];
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  return header === API_KEY || url.searchParams.get("apiKey") === API_KEY;
}

function pickTokenOptions(source) {
  const opts = {};
  for (const key of TOKEN_FIELDS) {
    if (source[key] === undefined || source[key] === "") continue;

    if (key === "fingerprint" || key === "fingerprintProfile") {
      const raw = source.fingerprint ?? source.fingerprintProfile;
      if (typeof raw === "object" && raw !== null) {
        opts.fingerprint = raw;
      } else if (typeof raw === "string" && raw.trim()) {
        opts.fingerprint = raw.trim();
      }
      continue;
    }

    if (key === "enterprise") {
      const ent = Config.parseEnterpriseFlag(source[key]);
      if (ent !== undefined) {
        opts.enterprise = ent;
        if (source.mode === undefined || source.mode === "") {
          opts.mode = ent ? "enterprise" : "api2";
        }
      }
      continue;
    }

    if (key === "mode") {
      const m = String(source[key]).toLowerCase();
      if (m === "api2" || m === "enterprise") {
        opts.mode = m;
        opts.enterprise = m === "enterprise";
      }
      continue;
    }

    if (
      key === "skipReload" ||
      key === "useCookies" ||
      key === "quiet" ||
      key === "verbose" ||
      key === "chromeCapture" ||
      key === "autoDump"
    ) {
      opts[key] =
        source[key] === true ||
        source[key] === "1" ||
        source[key] === "true";
      if (key === "quiet" || key === "verbose") {
        if (source[key] === false || source[key] === "0" || source[key] === "false") {
          opts[key] = false;
        }
      }
    } else if (key !== "mode") {
      opts[key] = String(source[key]);
    }
  }

  if (source.mode !== undefined && source.mode !== "" && opts.enterprise === undefined) {
    opts.mode = String(source.mode);
  }

  return opts;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function formatGenericResponse(result, durationMs) {
  return formatTokenApiResponse(result, durationMs);
}

async function readRequestTokenOpts(req, queryOpts, { tmDefaults = false } = {}) {
  let bodyOpts = {};
  if (req.method === "POST") {
    bodyOpts = await readJsonBody(req);
  }
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  return buildTokenRequestOptions(
    {
      ...pickTokenOptions(Object.fromEntries(url.searchParams)),
      ...pickTokenOptions(bodyOpts),
      ...queryOpts,
    },
    { tmDefaults },
  );
}

async function handleTicketmasterToken(req, res, queryOpts) {
  if (!checkApiKey(req)) {
    json(res, 401, { error: "Clé API invalide (header X-Api-Key ou ?apiKey=)" });
    return;
  }

  let opts;
  try {
    opts = await readRequestTokenOpts(req, queryOpts, { tmDefaults: true });
  } catch {
    json(res, 400, { error: "Corps JSON invalide" });
    return;
  }

  const started = Date.now();
  const restoreEnv = applyTmNativePipelineEnv(opts);
  try {
    const result = await new RecaptchaEnterprise(opts).getToken();
    const payload = formatTicketmasterApiResponse(result, Date.now() - started);
    const tmReject =
      result.success &&
      (result.validForTicketmaster === false || result.tokenUsable === false);
    const status = tmReject
      ? 422
      : result.success
        ? 200
        : result.ticketmasterScore === "low"
          ? 422
          : 502;
    json(res, status, payload);
  } catch (err) {
    json(res, 500, {
      success: false,
      error: err.message,
      durationMs: Date.now() - started,
    });
  } finally {
    restoreEnv();
  }
}

async function handleToken(req, res, queryOpts) {
  if (!checkApiKey(req)) {
    json(res, 401, { error: "Clé API invalide (header X-Api-Key ou ?apiKey=)" });
    return;
  }

  let opts;
  try {
    opts = await readRequestTokenOpts(req, queryOpts, { tmDefaults: false });
  } catch {
    json(res, 400, { error: "Corps JSON invalide" });
    return;
  }

  if (!opts.siteKey) {
    json(res, 400, {
      error: "siteKey requis dans le body ou la query",
      example: {
        siteKey: "6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV",
        enterprise: false,
        mode: "api2",
        action: "LoginPage",
        origin: "https://auth.ticketmaster.com",
        referer: "https://auth.ticketmaster.com/",
      },
    });
    return;
  }

  const validation = validateExternalSiteRequest(opts);
  if (!validation.ok) {
    json(res, 400, { error: validation.error, example: validation.example });
    return;
  }

  const started = Date.now();
  const restoreEnv = applyTmNativePipelineEnv(opts);
  try {
    const result = await new RecaptchaEnterprise(opts).getToken();
    const payload = formatGenericResponse(result, Date.now() - started);
    const status = result.success
      ? 200
      : result.tokenUsable === false || result.reloadQuality === "low"
        ? 422
        : 502;
    json(res, status, payload);
  } catch (err) {
    json(res, 500, {
      success: false,
      error: err.message,
      durationMs: Date.now() - started,
    });
  } finally {
    restoreEnv();
  }
}

function serveStatic(res, filePath, contentType) {
  if (!existsSync(filePath)) {
    json(res, 404, { error: "Not found" });
    return;
  }
  const body = readFileSync(filePath);
  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": body.length,
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Api-Key",
    });
    res.end();
    return;
  }

  if (path === "/health" && req.method === "GET") {
    json(res, 200, { ok: true, port: PORT, auth: !!API_KEY });
    return;
  }

  if (path === "/api/token/tm" && (req.method === "GET" || req.method === "POST")) {
    await handleTicketmasterToken(req, res, pickTokenOptions(Object.fromEntries(url.searchParams)));
    return;
  }

  if (path === "/api/token" && (req.method === "GET" || req.method === "POST")) {
    await handleToken(req, res, pickTokenOptions(Object.fromEntries(url.searchParams)));
    return;
  }

  if (path === "/api/vm/dump" && (req.method === "GET" || req.method === "POST")) {
    if (!checkApiKey(req)) {
      json(res, 401, { error: "Clé API invalide" });
      return;
    }
    const q = Object.fromEntries(url.searchParams);
    const siteKey =
      q.siteKey ?? "6LdoaXQrAAAAADQviABd-eByJu6kPL8awKDyc1zb";
    try {
      const { dump, report, paths } = await VmDumper.dumpAndAnalyze({ siteKey });
      json(res, 200, { dump: report, paths, full: dump });
    } catch (err) {
      json(res, 500, { error: err.message });
    }
    return;
  }

  if ((path === "/" || path === "/index.html") && req.method === "GET") {
    serveStatic(res, join(__dirname, "public", "index.html"), "text/html; charset=utf-8");
    return;
  }

  json(res, 404, {
    error: "Route inconnue",
    routes: [
      "GET /health",
      "POST /api/token — body: { siteKey, enterprise, mode, action }",
      "POST /api/token/tm — alias TM (origin TM par défaut)",
      "GET|POST /api/vm/dump",
    ],
    bodyExample: {
      siteKey: "6LdoaXQrAAAAADQviABd-eByJu6kPL8awKDyc1zb",
      enterprise: false,
      mode: "api2",
      action: "login",
    },
  });
});

server.listen(PORT, () => {
  console.log(`reCAPTCHA API → http://127.0.0.1:${PORT}`);
  console.log(`  POST /api/token       siteKey + enterprise (true|false) dans le body`);
  console.log(`  POST /api/token/tm    TM natif (profil frais, chromeCapture=off)`);
  if (
    process.env.RECAPTCHA_TLS_INSECURE === "1" ||
    process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0"
  ) {
    console.warn(
      "  TLS                   RECAPTCHA_TLS_INSECURE=1 — vérification certificats désactivée",
    );
  }
  if (API_KEY) console.log("  Auth                  X-Api-Key activée");
});
