/**
 * API finale — compatible POST /api/captcha/solve (Dispurphone / RestSharp)
 *
 *   cd final && npm install && npm start
 */

import "./bootstrap.mjs";
import http from "node:http";
import { FINAL_PORT, TM_ALT_SITE_KEY } from "./config.mjs";
import { generateTmAltToken } from "./TmAltTokenService.mjs";
import {
  normalizeSolveBody,
  formatCaptchaSolveResponse,
} from "./solveRequest.mjs";

if (process.env.RECAPTCHA_CHROME_CAPTURE == null) {
  process.env.RECAPTCHA_CHROME_CAPTURE = "0";
}
if (process.env.RECAPTCHA_JSDOM_BROWSER == null) {
  process.env.RECAPTCHA_JSDOM_BROWSER = "0";
}

function json(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
  });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

async function handleSolve(req, res) {
  const started = Date.now();
  let body = {};
  try {
    if (req.method === "POST") body = await readBody(req);
    else {
      const q = new URL(req.url, `http://127.0.0.1:${FINAL_PORT}`).searchParams;
      body = Object.fromEntries(q.entries());
    }
  } catch {
    json(res, 400, { status: "error", method: "A", error: "JSON invalide" });
    return;
  }

  const norm = normalizeSolveBody(body);
  if (!norm.ok) {
    json(res, 400, {
      status: "error",
      method: body.method ?? "A",
      error: norm.error,
    });
    return;
  }

  const { params } = norm;
  try {
    const result = await generateTmAltToken(params);
    const payload = formatCaptchaSolveResponse(
      result,
      Date.now() - started,
      params,
    );
    json(res, payload.status === "success" ? 200 : 502, payload);
  } catch (err) {
    json(res, 500, {
      status: "error",
      method: body.method ?? "A",
      error: err.message,
      durationMs: Date.now() - started,
    });
  }
}

const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, `http://127.0.0.1:${FINAL_PORT}`).pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept",
    });
    res.end();
    return;
  }

  if (path === "/health" && req.method === "GET") {
    json(res, 200, {
      ok: true,
      defaultSiteKey: TM_ALT_SITE_KEY,
      routes: ["POST /api/captcha/solve", "POST /api/token"],
    });
    return;
  }

  if (
    (path === "/api/captcha/solve" || path === "/api/token") &&
    (req.method === "POST" || req.method === "GET")
  ) {
    await handleSolve(req, res);
    return;
  }

  json(res, 404, {
    error: "Route inconnue",
    routes: ["POST /api/captcha/solve", "POST /api/token", "GET /health"],
    example: {
      url: "https://www.ticketmaster.fr",
      sitekey: TM_ALT_SITE_KEY,
      action: "FREvent",
      enterprise: true,
      title: "Ticketmaster Sign In",
      proxy: "http://user:pass@host:port (obligatoire)"
    },
  });
});

server.listen(FINAL_PORT, () => {
  console.log(`[final] http://127.0.0.1:${FINAL_PORT}`);
  console.log(`[final] POST /api/captcha/solve  (url, sitekey, action, enterprise, proxy, title)`);
});
