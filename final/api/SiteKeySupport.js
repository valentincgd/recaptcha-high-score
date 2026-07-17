import { isTicketmasterSiteKey } from "./TicketmasterProfile.js";

/**
 * SiteKey hors Ticketmaster : origin (domaine enregistré Google) obligatoire.
 */
export function validateExternalSiteRequest(opts) {
  if (!opts?.siteKey || isTicketmasterSiteKey(opts.siteKey)) {
    return { ok: true };
  }
  const origin = String(opts.origin ?? "").trim();
  if (!origin) {
    return {
      ok: false,
      error:
        "origin requis pour cette siteKey (URL du site où la clé est enregistrée, ex. https://example.com)",
      example: {
        siteKey: opts.siteKey,
        origin: "https://example.com",
        referer: "https://example.com/page",
        enterprise: false,
        mode: "api2",
        action: "submit",
      },
    };
  }
  try {
    new URL(origin);
  } catch {
    return { ok: false, error: "origin invalide (URL https:// complète attendue)" };
  }
  return { ok: true };
}

export function normalizeExternalOrigin(opts) {
  if (isTicketmasterSiteKey(opts.siteKey)) return opts;
  const origin = String(opts.origin).trim().replace(/\/$/, "");
  opts.origin = origin;
  if (!opts.referer?.trim()) {
    opts.referer = `${origin}/`;
  }
  return opts;
}

/** Score qualité reload (tous sites). */
export function computeReloadQualityScore(reloadBytes, pipeline) {
  const bytes = reloadBytes ?? 0;
  const minMedium = pipeline === "dynamic-jsdom" ? 8000 : 2000;
  if (bytes >= 12000) return "high";
  if (bytes >= minMedium) return "medium";
  return "low";
}

export function isReloadAcceptable({ success, reloadBytes, pipeline, score }) {
  if (!success) return false;
  return score === "high" || score === "medium";
}
