import { Config } from "./api/Config.js";
import { TM_ALT_SITE_KEY } from "./config.mjs";
import { fingerprintToResponseData } from "./fingerprintPool.mjs";

const ALLOWED_SITE_KEYS = new Set([
  TM_ALT_SITE_KEY,
  "6LdoaXQrAAAAADQviABd-eByJu6kPL8awKDyc1zb",
]);

export function normalizeSolveBody(body) {
  const url = body.url ?? body.pageUrl;
  const siteKey = String(body.sitekey ?? body.siteKey ?? TM_ALT_SITE_KEY).trim();
  let action = String(body.action ?? "LoginPage").trim();
  if (
    siteKey === TM_ALT_SITE_KEY &&
    /^pageview$/i.test(action)
  ) {
    action = "LoginPage";
  }
  const proxy = body.proxy ? String(body.proxy).trim() : null;
  const title = body.title ? String(body.title).trim() : null;
  const ent = Config.parseEnterpriseFlag(body.enterprise);
  const enterprise = ent !== false;

  if (!url) {
    return { ok: false, error: "url requis" };
  }
  if (!proxy) {
    return { ok: false, error: "proxy requis — toutes les requêtes Google passent par le proxy" };
  }
  if (!ALLOWED_SITE_KEYS.has(siteKey)) {
    return {
      ok: false,
      error: `sitekey non supportée (TM: ${[...ALLOWED_SITE_KEYS].join(", ")})`,
    };
  }
  if (!action) {
    return { ok: false, error: "action requis" };
  }

  return {
    ok: true,
    params: {
      url,
      siteKey,
      action,
      proxy,
      title,
      enterprise,
      mode: enterprise ? "enterprise" : "api2",
      quiet: body.quiet !== false,
      method: body.method ?? "A",
    },
  };
}

/** Format Dispurphone : status, method, data { token, user_agent, sec_*, accept_lang } */
export function formatCaptchaSolveResponse(result, durationMs, input) {
  const method = input.method ?? "A";
  const fp = result.fingerprintProfile ?? result.fingerprint ?? {};

  if (!result.success || !result.token) {
    return {
      status: "error",
      method,
      error: result.reloadError ?? result.hint ?? "échec génération token",
      durationMs,
      pipeline: result.pipeline ?? "error",
    };
  }

  return {
    status: "success",
    method,
    data: fingerprintToResponseData(fp, result.token),
    durationMs,
    pipeline: result.pipeline,
    reloadBytes: result.reloadBytes,
    reloadQuality: result.reloadQuality ?? null,
    tokenUsable: result.tokenUsable ?? null,
    fingerprintId: fp.id,
  };
}
