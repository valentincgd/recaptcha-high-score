import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Config } from "./Config.js";
import { HttpClient } from "./HttpClient.js";
import { CookieJar } from "./CookieJar.js";
import { CallbackGenerator } from "./CallbackGenerator.js";
import { EnterpriseBootstrapParser } from "./EnterpriseBootstrapParser.js";
import { AnchorParser } from "./AnchorParser.js";
import { ReloadResponseParser } from "./ReloadResponseParser.js";
import { DynamicReload, describeReloadPipeline } from "./fresh/DynamicReload.js";
import { isTicketmasterSiteKey } from "./TicketmasterProfile.js";
import {
  computeReloadQualityScore,
  isReloadAcceptable,
} from "./SiteKeySupport.js";

export class RecaptchaEnterprise {
  constructor(config = {}) {
    this.config = config instanceof Config ? config : Config.fromEnv(config);
  }

  static #seedGoogleCookies(jar) {
    if (!jar) return;
    const path =
      process.env.RECAPTCHA_GOOGLE_COOKIES ??
      join(process.cwd(), "captures", "tm-cookies.txt");
    if (existsSync(path)) {
      jar.seed(readFileSync(path, "utf8").trim());
    }
  }

  #log(...args) {
    if (this.config.quiet && !this.config.verbose) return;
    const ts = new Date().toISOString();
    console.log(`[recaptcha] ${ts}`, ...args);
  }

  #logStep(step, message, detail = "") {
    if (this.config.quiet && !this.config.verbose) return;
    const ts = new Date().toISOString();
    const extra = detail ? ` — ${detail}` : "";
    console.log(`[recaptcha] ${ts} [${step}] ${message}${extra}`);
  }

  #logTokenResult(result, durationMs) {
    if (!this.config.logResult) return;
    const ts = new Date().toISOString();
    const cfg = this.config;
    if (result.success && result.token) {
      const preview = `${result.token.slice(0, 24)}…`;
      console.log(
        `[recaptcha] ${ts} token généré | pipeline=${result.pipeline} | mode=${result.mode} | siteKey=${result.siteKey} | action=${cfg.action} | ${durationMs}ms | ${result.token.length} chars | ${preview}`,
      );
      return;
    }
    console.log(
      `[recaptcha] ${ts} échec token | pipeline=${result.pipeline} | mode=${result.mode} | siteKey=${result.siteKey} | action=${cfg.action} | ${durationMs}ms`,
    );
  }

  #reloadHeaders(headers, { referer, anchorUrl }) {
    return {
      ...headers,
      accept: "*/*",
      "content-type": "application/x-protobuffer",
      origin: "https://www.google.com",
      referer: referer ?? anchorUrl,
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      "sec-fetch-storage-access": "none",
      priority: "u=1, i",
    };
  }

  async #fetchBootstrap(headers, jar, preferMode) {
    const cfg = this.config;
    const errors = [];
    const candidates = cfg.bootstrapCandidates();
    const ordered =
      preferMode && preferMode !== "auto"
        ? [
            ...candidates.filter((c) => c.mode === preferMode),
            ...candidates.filter((c) => c.mode !== preferMode),
          ]
        : candidates;

    for (const { mode, url } of ordered) {
      try {
        this.#log(`[1/4] GET ${mode === "api2" ? "api.js" : "enterprise.js"}`);
        const js = await HttpClient.fetchText(url, headers, jar);
        const bootstrap = EnterpriseBootstrapParser.parse(js);
        if (!bootstrap.version) {
          errors.push(`${mode}: version introuvable`);
          continue;
        }
        return { bootstrap, mode, bootstrapUrl: url };
      } catch (err) {
        errors.push(`${mode}: ${err.message}`);
      }
    }

    throw new Error(`bootstrap introuvable — ${errors.join(" | ")}`);
  }

  async #fetchAnchor({ headers, jar, bootstrap, mode, referer }) {
    const cfg = this.config;
    const cb = CallbackGenerator.generate();
    const anchorUrl = cfg.buildAnchorUrl({
      apiBase: bootstrap.apiBase,
      version: bootstrap.version,
      cb,
    });

    this.#log(`      GET ${mode}/anchor`);
    const anchorHtml = await HttpClient.fetchText(
      anchorUrl,
      {
        ...headers,
        referer: referer ?? cfg.referer,
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "sec-fetch-dest": "iframe",
        "sec-fetch-mode": "navigate",
        "upgrade-insecure-requests": "1",
      },
      jar,
    );

    const anchor = AnchorParser.parse(anchorHtml);
    if (!anchor.anchorToken) {
      if (/Invalid domain for site key/i.test(anchorHtml)) {
        throw new Error(
          "domain refusé pour cette siteKey — origin/referer doivent correspondre au site enregistré (TM : auth.ticketmaster.com ; autres sites souvent sans :443 dans co)",
        );
      }
      throw new Error("recaptcha-token introuvable (anchor sans token — clé v3 ou page erreur Google)");
    }
    this.#log(`      anchor ${anchor.anchorToken.length} chars`);
    return { anchor, anchorUrl, anchorHtml };
  }

  async #postReload({ headers, jar, apiBase, siteKey, body, referer, anchorUrl }) {
    const url = `${apiBase}reload?k=${siteKey}`;
    const init = {
      method: "POST",
      headers: this.#reloadHeaders(headers, { referer, anchorUrl }),
      body,
    };
    let lastErr = null;
    const attempts = Number(process.env.RECAPTCHA_RELOAD_RETRIES) || 3;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const buf = await HttpClient.fetchBuffer(url, init, jar);
        return ReloadResponseParser.parse(buf.toString("utf8"));
      } catch (err) {
        lastErr = err;
        const retryable =
          attempt < attempts - 1 && String(err.message).includes("HTTP 5");
        if (!retryable) throw err;
        await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
      }
    }
    throw lastErr;
  }

  async #getTokenViaDynamic({ cfg, started }) {
    let profile = cfg.fingerprint;
    if (!profile?.userAgent) {
      const { bindFingerprintSession } = await import("./vm/FreshFingerprint.js");
      profile = bindFingerprintSession(cfg);
    } else {
      cfg.userAgent = profile.userAgent;
      cfg._fingerprintSession = profile.id ?? "custom";
    }
    const headers = cfg.googleHeaders();
    const jar = cfg.useCookies ? new CookieJar() : null;

    this.#logStep(
      "0/6",
      "Configuration",
      `siteKey=${cfg.siteKey} mode=${cfg.mode} enterprise=${cfg.enterprise} action=${cfg.action}`,
    );
    this.#logStep(
      "0/6",
      "Fingerprint session",
      `${profile.id} | ${profile.width}x${profile.height} | UA aligné sur tout le flux`,
    );

    try {
      RecaptchaEnterprise.#seedGoogleCookies(jar);
      if (jar) this.#logStep("0/6", "Cookies", "tm-cookies chargés");

      this.#logStep("1/6", "Bootstrap", `GET ${cfg.mode === "api2" ? "api.js" : "enterprise.js"}`);
      const { bootstrap, mode } = await this.#fetchBootstrap(
        headers,
        jar,
        cfg.mode,
      );
      this.#logStep(
        "1/6",
        "Bootstrap OK",
        `version=${bootstrap.version} apiBase=${bootstrap.apiBase}`,
      );

      if (!cfg.skipScript && process.env.RECAPTCHA_SKIP_SCRIPT !== "1") {
        this.#logStep("2/6", "Script", bootstrap.scriptUrl);
        await HttpClient.fetchText(
          bootstrap.scriptUrl,
          { ...headers, referer: "https://www.google.com/" },
          jar,
        );
        this.#logStep("2/6", "Script OK", "recaptcha__*.js chargé");
      }

      this.#logStep("3/6", "Anchor", `GET ${mode}/anchor (invisible)`);
      let { anchor, anchorUrl, anchorHtml } = await this.#fetchAnchor({
        headers,
        jar,
        bootstrap,
        mode,
      });
      this.#logStep(
        "3/6",
        "Anchor OK",
        `token ${anchor.anchorToken.length} chars | encryptionKey=${anchor.encryptionKey}`,
      );

      const onBuildLog = (sub, detail) => this.#logStep("4/6", sub, detail);

      this.#logStep("4/6", "Reload body", describeReloadPipeline(cfg));
      let built = await DynamicReload.buildAsync({
        cfg,
        bootstrap,
        anchor,
        anchorUrl,
        anchorHtml,
        headers,
        jar,
        onLog: onBuildLog,
      });
      this.#logStep(
        "4/6",
        "Reload body OK",
        `${built.reloadBytes} octets | strategy=${built.strategy} | 05AL=${built.secondarySource ?? "?"}`,
      );

      this.#logStep("5/6", "POST reload", `${bootstrap.apiBase}reload?k=${cfg.siteKey}`);
      let reload;
      let anchorForReload = anchor;
      let anchorUrlForReload = anchorUrl;
      try {
        reload = await this.#postReload({
          headers,
          jar,
          apiBase: bootstrap.apiBase,
          siteKey: cfg.siteKey,
          body: built.body,
          anchorUrl: anchorUrlForReload,
        });
      } catch (reloadErr) {
        if (!String(reloadErr.message).includes("HTTP 5")) throw reloadErr;
        this.#logStep("5/6", "Reload 5xx", "nouvel anchor + body flat");
        const fresh = await this.#fetchAnchor({
          headers,
          jar,
          bootstrap,
          mode,
        });
        anchorForReload = fresh.anchor;
        anchorUrlForReload = fresh.anchorUrl;
        built = await DynamicReload.buildAsync({
          cfg,
          bootstrap,
          anchor: anchorForReload,
          onLog: onBuildLog,
        });
        built.strategy = "dynamic-flat-retry";
        built.secondarySource = "flat-retry";
        reload = await this.#postReload({
          headers,
          jar,
          apiBase: bootstrap.apiBase,
          siteKey: cfg.siteKey,
          body: built.body,
          anchorUrl: anchorUrlForReload,
        });
      }
      anchor = anchorForReload;
      anchorUrl = anchorUrlForReload;
      this.#logStep(
        "5/6",
        "Reload réponse",
        reload.success
          ? `token ${reload.token?.length ?? 0} chars`
          : "rresp null ou erreur",
      );

      const reloadQuality = computeReloadQualityScore(
        built.reloadBytes,
        built.strategy,
      );
      const ticketmasterScore = reload.token ? reloadQuality : "low";
      const tokenUsable = isReloadAcceptable({
        success: !!reload.token,
        reloadBytes: built.reloadBytes,
        pipeline: built.strategy,
        score: reloadQuality,
      });

      this.#logStep(
        "6/6",
        "Terminé",
        reload.token
          ? `tokenUsable=${tokenUsable} score=${reloadQuality} reload=${built.reloadBytes}b`
          : "échec",
      );

      return this.#finalize(
        {
          siteKey: cfg.siteKey,
          origin: cfg.origin,
          enterprise: mode === "enterprise",
          mode,
          apiBase: bootstrap.apiBase,
          version: bootstrap.version,
          anchorToken: anchor.anchorToken,
          token: reload.token,
          encryptionKey: anchor.encryptionKey,
          anchorUrl,
          reload,
          pipeline: built.strategy,
          secondarySource: built.secondarySource,
          fingerprintSession: cfg._fingerprintSession,
          profileId: built.profileId,
          fingerprintSeed: built.fingerprintSeed,
          reloadQuality,
          ticketmasterScore,
          reloadBytes: built.reloadBytes,
          action: cfg.action,
          tokenUsable,
          validForTicketmaster: isTicketmasterSiteKey(cfg.siteKey)
            ? tokenUsable
            : null,
          hint: reload.token
            ? undefined
            : "rresp null — vérifier anchor live (encryptionKey même session).",
        },
        started,
      );
    } catch (err) {
      this.#logStep("!", "Erreur", err.message);
      let hint = err.message;
      if (String(err.message).includes("HTTP 5")) {
        hint +=
          " — reload refusé (clé v3 ou mauvais mode ? v3 = pas de POST /reload ; essayer enterprise:false + origin du site)";
      }
      return this.#finalize(
        {
          siteKey: cfg.siteKey,
          origin: cfg.origin,
          reload: { token: null, success: false },
          reloadError: err.message,
          pipeline: "error",
          reloadQuality: "low",
          ticketmasterScore: "low",
          tokenUsable: false,
          hint,
        },
        started,
      );
    }
  }

  async getToken() {
    const started = Date.now();
    const cfg = this.config;

    this.#logStep(
      "start",
      "Génération token",
      `pipeline=auto siteKey=${cfg.siteKey} action=${cfg.action} mode=${cfg.mode}`,
    );

    return this.#getTokenViaDynamic({ cfg, started });
  }

  #finalize(partial, started) {
    const cfg = this.config;
    const reload = partial.reload ?? { token: null, success: false };
    const result = {
      siteKey: partial.siteKey ?? cfg.siteKey,
      enterprise: partial.enterprise,
      mode: partial.mode,
      apiBase: partial.apiBase,
      version: partial.version,
      anchorToken: partial.anchorToken,
      token: reload.token ?? partial.token,
      encryptionKey: partial.encryptionKey,
      configBytecode: partial.configBytecode,
      dynamicConfig: partial.dynamicConfig,
      anchorUrl: partial.anchorUrl,
      success: !!(reload.token ?? partial.token),
      reloadError: partial.reloadError,
      origin: partial.origin ?? cfg.origin,
      pipeline: partial.pipeline ?? "unknown",
      secondarySource: partial.secondarySource ?? null,
      fingerprintSession: partial.fingerprintSession ?? cfg._fingerprintSession ?? null,
      profileId: partial.profileId ?? null,
      fingerprintSeed: partial.fingerprintSeed ?? null,
      reloadQuality: partial.reloadQuality ?? partial.ticketmasterScore ?? null,
      tokenUsable: partial.tokenUsable ?? null,
      ticketmasterScore: partial.ticketmasterScore,
      tmCookies: partial.tmCookies,
      reloadBytes: partial.reloadBytes,
      action: partial.action ?? cfg.action,
      requestedSiteKey: partial.requestedSiteKey ?? cfg.requestedSiteKey ?? null,
      requestedAction: partial.requestedAction ?? cfg.requestedAction ?? null,
      validForTicketmaster:
        partial.validForTicketmaster ??
        (isTicketmasterSiteKey(partial.siteKey ?? cfg.siteKey)
          ? (partial.reloadBytes ?? 0) > 2000 &&
            (partial.ticketmasterScore === "high" ||
              partial.ticketmasterScore === "medium")
          : null),
      needsFullReloadBody:
        partial.ticketmasterScore === "low" || !partial.success,
      hint: partial.hint ?? this.#hint(partial),
      headers: {
        google: cfg.googleHeaders(),
        ticketmaster: cfg.ticketmasterHeaders(),
      },
    };

    if (cfg.saveState) {
      writeFileSync(cfg.saveState, JSON.stringify(result, null, 2));
    }

    this.#logTokenResult(result, Date.now() - started);
    return result;
  }

  #hint(partial) {
    if (partial.token) {
      if (partial.ticketmasterScore === "low" || partial.reloadBytes < 2000) {
        return "Token Google OK — reload trop léger pour Ticketmaster (pipeline JSDOM ou pur attendu).";
      }
      return undefined;
    }
    return "Échec reload — vérifier siteKey, enterprise/mode, anchor live (JSDOM VM).";
  }
}
