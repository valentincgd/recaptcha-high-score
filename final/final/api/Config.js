import { join } from "node:path";

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

  // Fallbacks GÉNÉRIQUES (aucun hardcode site : siteKey/origin/referer sont toujours fournis par l'appelant
  // — l'API les prend dans le body ; les constantes de sites sont dans constants.json).
  static DEFAULTS = {
    siteKey: null,
    origin: null,
    referer: null,
    hl: "fr",
    size: "invisible",
    action: "LoginPage",
    /** auto | api2 | enterprise — Ticketmaster utilise api2 + action login */
    mode: "auto",
    anchorMs: "20000",
    executeMs: "30000",
    // PAS d'UA hardcodé : l'UA vient TOUJOURS du fingerprint (cfg.userAgent = fingerprint.userAgent dans
    // index.mjs, ou fp.userAgent dans clientHints). null = force l'usage du profil (un UA figé serait un tell).
    userAgent: null,
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

  /**
   * Client-hints DÉRIVÉS du profil (UA + fingerprint) pour cohérence sur tout le flux :
   * accept-language ← fingerprint.languages ; sec-ch-ua ← version Chrome de l'UA ;
   * sec-ch-ua-platform ← fingerprint.platform. Fallbacks si profil absent.
   */
  clientHints() {
    const fp = this.fingerprint && typeof this.fingerprint === "object" ? this.fingerprint : {};
    const ua = this.userAgent || fp.userAgent || "";

    // accept-language : construit depuis languages (q décroissant) sinon language.
    let acceptLanguage;
    const langs = Array.isArray(fp.languages) && fp.languages.length ? fp.languages : (fp.language ? [fp.language] : null);
    if (langs) {
      acceptLanguage = langs
        .map((l, i) => (i === 0 ? l : `${l};q=${Math.max(0.1, 1 - i * 0.1).toFixed(1)}`))
        .join(",");
    } else {
      acceptLanguage = "en-US,en;q=0.9";
    }

    // sec-ch-ua : PRIORITÉ au profil (fp.brands = grease EXACT du vrai Chrome, ex Chrome 150 =
    // "Not;A=Brand";v="8"). Le template hardcodé "Not/A)Brand";v="99" est un grease PÉRIMÉ (ère Chrome
    // ~100) que le vrai Chrome 150 n'envoie JAMAIS → tell détecté par Google/tm-bl sur /reload. On
    // reconstruit depuis fp.brands (ordre inclus) si présent, sinon fallback template.
    const m = /Chrome\/(\d+)/.exec(ua);
    const major = m ? m[1] : "148";
    let secChUa;
    if (Array.isArray(fp.brands) && fp.brands.length) {
      secChUa = fp.brands.map((b) => `"${b[0]}";v="${b[1]}"`).join(", ");
    } else {
      secChUa = `"Chromium";v="${major}", "Google Chrome";v="${major}", "Not/A)Brand";v="99"`;
    }

    // sec-ch-ua-platform depuis platform/UA.
    const plat = String(fp.platform || "");
    let platform = '"Windows"';
    if (/mac/i.test(plat) || /Mac OS X/i.test(ua)) platform = '"macOS"';
    else if (/linux/i.test(plat) || (/Linux/i.test(ua) && !/Android/i.test(ua))) platform = '"Linux"';
    else if (/android/i.test(plat) || /Android/i.test(ua)) platform = '"Android"';

    const mobile = /Android|Mobile/i.test(ua) ? "?1" : "?0";
    return { acceptLanguage, secChUa, platform, mobile };
  }

  googleHeaders() {
    const ch = this.clientHints();
    return {
      accept: "*/*",
      "accept-language": ch.acceptLanguage,
      referer: this.referer,
      "sec-ch-ua": ch.secChUa,
      "sec-ch-ua-mobile": ch.mobile,
      "sec-ch-ua-platform": ch.platform,
      "sec-fetch-dest": "script",
      "sec-fetch-mode": "no-cors",
      "sec-fetch-site": "cross-site",
      // PAS de sec-gpc sur les requêtes Google : jsdom (qui PASSE) ne l'envoie pas ; le header en trop
      // distinguait flat sur le GET anchor → token anchor de qualité différente (vérifié : diff de longueur).
      "user-agent": this.userAgent,
    };
  }

  ticketmasterHeaders() {
    const ch = this.clientHints();
    return {
      "User-Agent": this.userAgent,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": ch.acceptLanguage,
      "Content-Type": "application/json",
      Origin: this.origin,
      Referer: this.referer,
      "sec-ch-ua": ch.secChUa,
      "sec-ch-ua-mobile": ch.mobile,
      "sec-ch-ua-platform": ch.platform,
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
    const base = this.origin.replace(/\/$/, "");

    // Le port par défaut :443 (https) fait partie du `co` réel envoyé par les navigateurs.
    // RECAPTCHA_CO_WITH_PORT=0 pour désactiver ; =1 pour forcer ; sinon activé pour https.
    const env = process.env.RECAPTCHA_CO_WITH_PORT;
    let withPort;
    if (env === "1") withPort = true;
    else if (env === "0") withPort = false;
    else withPort = /^https:/i.test(base) && !/:\d+$/.test(base);

    const originForCo = base.includes(":443") || !withPort ? base : `${base}:443`;
    // reCAPTCHA encode `co` en base64URL avec padding '.' (PAS le base64 standard '+/=').
    return Buffer.from(originForCo, "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, ".");
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
