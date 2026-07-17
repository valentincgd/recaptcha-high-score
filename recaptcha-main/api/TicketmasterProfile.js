import { Config } from "./Config.js";
import {
  normalizeExternalOrigin,
  validateExternalSiteRequest,
} from "./SiteKeySupport.js";

export { validateExternalSiteRequest, normalizeExternalOrigin };

export const TM_SITE_KEYS = {
  primary: "6LdoaXQrAAAAADQviABd-eByJu6kPL8awKDyc1zb",
  alternate: "6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV",
};

export function isTicketmasterSiteKey(siteKey) {
  return Object.values(TM_SITE_KEYS).includes(siteKey);
}

/**
 * Options token — reload toujours généré dynamiquement (pas de reload.bin).
 */
export function buildTokenRequestOptions(overrides = {}, { tmDefaults = false } = {}) {
  const variant = overrides.variant ?? overrides.tmVariant;
  const useAlt = variant === "alt" || variant === "alternate";

  const ent = Config.parseEnterpriseFlag(overrides.enterprise);
  let mode = overrides.mode;
  if (!mode && ent === true) mode = "enterprise";
  if (!mode && ent === false) mode = "api2";

  const opts = {
    autoCapture: false,
    quiet: false,
    verbose: true,
    logResult: true,
    ...overrides,
  };
  if (overrides.quiet === true) opts.verbose = false;

  delete opts.reloadStrategy;

  if (!opts.reloadTemplatePath && process.env.RECAPTCHA_RELOAD_TEMPLATE) {
    opts.reloadTemplatePath = process.env.RECAPTCHA_RELOAD_TEMPLATE;
  }
  delete opts.alignWithTemplate;
  delete opts.blockTemplateMismatch;
  delete opts.autoCapture;

  if (!opts.siteKey) {
    opts.siteKey = useAlt
      ? TM_SITE_KEYS.alternate
      : tmDefaults
        ? TM_SITE_KEYS.primary
        : Config.DEFAULTS.siteKey;
  }

  if (!opts.action) {
    opts.action = useAlt
      ? "LoginPage"
      : tmDefaults
        ? "login"
        : Config.DEFAULTS.action;
  }

  if (ent === false) {
    opts.enterprise = false;
    if (!opts.mode) opts.mode = "api2";
  } else if (ent === true) {
    opts.enterprise = true;
    if (!opts.mode) opts.mode = "enterprise";
  } else if (mode === "api2" || mode === "enterprise") {
    opts.enterprise = mode === "enterprise";
    opts.mode = mode;
  }

  if (ent === undefined && mode) opts.mode = mode;

  delete opts.jsdom;
  delete opts.jsdomBrowser;

  if (tmDefaults || isTicketmasterSiteKey(opts.siteKey)) {
    if (!opts.origin) opts.origin = Config.DEFAULTS.origin;
    if (!opts.referer) opts.referer = Config.DEFAULTS.referer;
  } else {
    normalizeExternalOrigin(opts);
  }

  if (opts.chromeCapture !== true) opts.chromeCapture = false;
  if (opts.autoDump === undefined) opts.autoDump = true;

  delete opts.variant;
  delete opts.tmVariant;

  return opts;
}

export function formatTokenApiResponse(result, durationMs) {
  const tm = isTicketmasterSiteKey(result.siteKey);
  const base = {
    success: result.success,
    token: result.token,
    siteKey: result.siteKey,
    action: result.action ?? null,
    mode: result.mode,
    enterprise: result.enterprise,
    origin: result.origin ?? null,
    pipeline: result.pipeline ?? null,
    secondarySource: result.secondarySource ?? null,
    fingerprintSession: result.fingerprintSession ?? null,
    profileId: result.profileId ?? null,
    fingerprintSeed: result.fingerprintSeed ?? null,
    reloadQuality: result.reloadQuality ?? result.ticketmasterScore ?? null,
    reloadBytes: result.reloadBytes ?? null,
    durationMs,
    tokenUsable: result.tokenUsable ?? result.validForTicketmaster ?? null,
    hint: result.hint,
    anchorToken: result.anchorToken,
    version: result.version,
    reloadError: result.reloadError,
    headers: result.headers,
  };
  if (tm) {
    return {
      ...base,
      ticketmasterScore: result.ticketmasterScore,
      validForTicketmaster: result.validForTicketmaster,
      tmCookies: result.tmCookies ?? null,
      cookieHeader: result.tmCookies ?? null,
      login: {
        recaptchaToken: result.token,
        cookie: result.tmCookies ?? null,
      },
    };
  }
  return base;
}

/**
 * Applique les flags pipeline TM sur process.env pour une requête API,
 * puis restaure l’état précédent (évite de polluer les requêtes suivantes).
 */
export function applyTmNativePipelineEnv(opts) {
  const snapshot = {
    RECAPTCHA_CHROME_CAPTURE: process.env.RECAPTCHA_CHROME_CAPTURE,
    RECAPTCHA_AUTO_DUMP: process.env.RECAPTCHA_AUTO_DUMP,
    RECAPTCHA_FINGERPRINT_PROFILE: process.env.RECAPTCHA_FINGERPRINT_PROFILE,
  };

  process.env.RECAPTCHA_CHROME_CAPTURE = opts.chromeCapture === true ? "1" : "0";
  process.env.RECAPTCHA_AUTO_DUMP = opts.autoDump === false ? "0" : "1";

  if (typeof opts.fingerprint === "string" && opts.fingerprint.trim()) {
    process.env.RECAPTCHA_FINGERPRINT_PROFILE = opts.fingerprint.trim();
  }

  return () => {
    for (const key of Object.keys(snapshot)) {
      const v = snapshot[key];
      if (v === undefined) delete process.env[key];
      else process.env[key] = v;
    }
  };
}

/** Plus de validation template — flux 100 % dynamique. */
export function formatApi2CaptureRequiredError() {
  return null;
}

export function formatTemplateMismatchError() {
  return null;
}

/** @deprecated alias */
export function ticketmasterTokenOptions(overrides = {}) {
  return buildTokenRequestOptions(overrides, { tmDefaults: true });
}

export function formatTicketmasterApiResponse(result, durationMs) {
  return formatTokenApiResponse(result, durationMs);
}
