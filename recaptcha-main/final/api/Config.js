import { join } from "node:path";
import { isTicketmasterSiteKey } from "./TicketmasterProfile.js";

export class Config {
  static parseEnterpriseFlag(value) {
    if (value === undefined || value === null || value === "") return undefined;
    if (value === true || value === "true" || value === "1" || value === 1) {
      return true;
    }
    if (value === false || value === "false" || value === "0" || value === 0) {
      return false;
    }
    return undefined;
  }

  static resolveMode({ enterprise, mode }) {
    const ent = Config.parseEnterpriseFlag(enterprise);
    if (ent === true) return "enterprise";
    if (ent === false) return "api2";
    if (mode === "enterprise" || mode === "api2") return mode;
    return "auto";
  }

  static DEFAULTS = {
    siteKey: "6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV",
    origin: "https://auth.ticketmaster.com",
    referer: "https://auth.ticketmaster.com/",
    loginUrl:
      "https://auth.ticketmaster.com/as/authorization.oauth2?client_id=8bf7204a7e97.web.ticketmaster.us&response_type=code&scope=openid%20profile%20phone%20email%20tm&redirect_uri=https://identity.ticketmaster.com/exchange&visualPresets=tm&lang=fr-fr&placementId=myAccount&showHeader=true&hideLeftPanel=false&integratorId=prd283.myAccount&intSiteToken=tm-us",
    hl: "fr",
    size: "invisible",
    action: "LoginPage",
    /** auto | api2 | enterprise — Ticketmaster utilise api2 + action login */
    mode: "auto",
    anchorMs: "20000",
    executeMs: "30000",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
  };

  constructor(overrides = {}) {
    const d = Config.DEFAULTS;
    this.siteKey = overrides.siteKey ?? process.env.RECAPTCHA_SITE_KEY ?? d.siteKey;
    this.origin = overrides.origin ?? process.env.RECAPTCHA_ORIGIN ?? d.origin;
    this.referer = overrides.referer ?? process.env.RECAPTCHA_REFERER ?? d.referer;
    this.hl = overrides.hl ?? process.env.RECAPTCHA_HL ?? d.hl;
    this.size = overrides.size ?? process.env.RECAPTCHA_SIZE ?? d.size;
    this.action = overrides.action ?? process.env.RECAPTCHA_ACTION ?? d.action;
    this.anchorMs =
      overrides.anchorMs ?? process.env.RECAPTCHA_ANCHOR_MS ?? d.anchorMs;
    this.executeMs =
      overrides.executeMs ?? process.env.RECAPTCHA_EXECUTE_MS ?? d.executeMs;
    this.userAgent =
      overrides.userAgent ?? process.env.RECAPTCHA_USER_AGENT ?? d.userAgent;
    this.loginUrl =
      overrides.loginUrl ?? process.env.TM_LOGIN_URL ?? d.loginUrl;
    this.loginEmail = overrides.loginEmail ?? process.env.TM_EMAIL ?? "";
    this.loginPassword = overrides.loginPassword ?? process.env.TM_PASSWORD ?? "";
    this.reloadTemplatePath =
      overrides.reloadTemplatePath ??
      process.env.RECAPTCHA_RELOAD_TEMPLATE ??
      "";
    this.saveState = overrides.saveState ?? process.env.RECAPTCHA_SAVE_STATE ?? "";
    this.skipReload =
      overrides.skipReload ??
      (process.env.RECAPTCHA_SKIP_RELOAD === "1" || overrides.skipReload === true);
    this.quiet = overrides.quiet ?? false;
    this.verbose = overrides.verbose !== false;
    this.logResult = overrides.logResult ?? true;

    const envEnterprise = Config.parseEnterpriseFlag(
      process.env.RECAPTCHA_ENTERPRISE,
    );
    const overrideEnterprise = Config.parseEnterpriseFlag(overrides.enterprise);

    this.enterprise =
      overrideEnterprise !== undefined ? overrideEnterprise : envEnterprise;

    this.mode = Config.resolveMode({
      enterprise: this.enterprise,
      mode: overrides.mode ?? process.env.RECAPTCHA_MODE ?? d.mode,
    });

    this.useCookies =
      overrides.useCookies ??
      (process.env.RECAPTCHA_USE_COOKIES !== "0");

    this.requestedSiteKey = overrides.requestedSiteKey ?? null;
    this.requestedAction = overrides.requestedAction ?? null;
    this.tmEnterpriseForced = !!overrides.tmEnterpriseForced;

    /** Pipeline TM natif (API / CLI) — pas de dump Chrome sauf opt-in explicite */
    this.chromeCapture = overrides.chromeCapture === true;
    this.autoDump = overrides.autoDump !== false;
    /** Garde origin/referer de la requête (ex. final/ API multi-domaines TM) */
    this.preserveOrigin = overrides.preserveOrigin === true;
    /** Skip téléchargement recaptcha__*.js (~4–5 s) — flat n'en a pas besoin */
    this.skipScript =
      overrides.skipScript === true ||
      process.env.RECAPTCHA_SKIP_SCRIPT === "1";
  }

  static fromEnv(overrides = {}) {
    return new Config(overrides);
  }

  bootstrapCandidates() {
    const order =
      this.mode === "auto"
        ? ["api2", "enterprise"]
        : this.mode === "enterprise"
          ? ["enterprise"]
          : ["api2"];
    return order.flatMap((mode) => {
      if (mode === "enterprise") {
        return [
          {
            mode,
            url: `https://www.google.com/recaptcha/enterprise.js?render=${this.siteKey}`,
          },
        ];
      }
      return [
        {
          mode,
          url: `https://www.google.com/recaptcha/api.js?render=${this.siteKey}`,
        },
        { mode, url: "https://www.google.com/recaptcha/api.js" },
      ];
    });
  }

  googleHeaders() {
    const fp = this.fingerprint ?? {};
    return {
      accept: "*/*",
      "accept-language": fp.acceptLang ?? "fr-FR,fr;q=0.9,en-US;q=0.8",
      referer: this.referer,
      "sec-ch-ua":
        fp.secChUa ??
        '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
      "sec-ch-ua-mobile": fp.secChUaMobile ?? "?0",
      "sec-ch-ua-platform": fp.secChUaPlatform ?? '"Windows"',
      "sec-fetch-dest": "script",
      "sec-fetch-mode": "no-cors",
      "sec-fetch-site": "cross-site",
      "sec-gpc": "1",
      "user-agent": fp.userAgent ?? this.userAgent,
    };
  }

  ticketmasterHeaders() {
    const fp = this.fingerprint ?? {};
    const ua = fp.userAgent ?? this.userAgent;
    const lang = fp.acceptLang ?? "fr-FR,fr;q=0.9";
    return {
      "User-Agent": ua,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": lang,
      "Content-Type": "application/json",
      Origin: this.origin,
      Referer: this.referer,
      "sec-ch-ua":
        fp.secChUa ??
        '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
      "sec-ch-ua-mobile": fp.secChUaMobile ?? "?0",
      "sec-ch-ua-platform": fp.secChUaPlatform ?? '"Windows"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
    };
  }

  /**
   * Paramètre `co` de l’URL anchor (base64 de l’origin).
   * Ticketmaster attend `https://…:443` ; la plupart des autres sites : origin seul.
   * RECAPTCHA_CO_WITH_PORT=1 force `:443` partout ; `0` ne l’ajoute jamais.
   */
  encodeOriginCo() {
    if (isTicketmasterSiteKey(this.siteKey)) {
      return Buffer.from("https://auth.ticketmaster.com:443", "utf8").toString("base64");
    }

    const base = this.origin.replace(/\/$/, "");
    if (base.includes(":443")) {
      return Buffer.from(base, "utf8").toString("base64");
    }

    const env = process.env.RECAPTCHA_CO_WITH_PORT;
    let withPort = false;
    if (env === "1") withPort = true;
    else if (env === "0") withPort = false;
    else {
      try {
        withPort = /ticketmaster\.com$/i.test(new URL(base).hostname);
      } catch {
        withPort = /ticketmaster\.com/i.test(base);
      }
    }

    const originForCo = withPort ? `${base}:443` : base;
    return Buffer.from(originForCo, "utf8").toString("base64");
  }

  buildAnchorUrl({ apiBase, version, cb }) {
    const p = new URLSearchParams({
      ar: "1",
      k: this.siteKey,
      co: this.encodeOriginCo(),
      hl: this.hl,
      v: version,
      size: this.size,
      "anchor-ms": this.anchorMs,
      "execute-ms": this.executeMs,
      cb,
    });
    return `${apiBase}anchor?${p}`;
  }
}
