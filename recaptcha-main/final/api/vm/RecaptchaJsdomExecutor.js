import { RecaptchaVmHost } from "./RecaptchaVmHost.js";

/**
 * Exécute reCAPTCHA dans JSDOM (enterprise.js + recaptcha__fr.js + execute).
 * Retourne le token client + métadonnées VM dump.
 */
let recaptchaAsyncGuard = false;
function swallowRecaptchaAsyncErrors() {
  if (recaptchaAsyncGuard) return;
  recaptchaAsyncGuard = true;
  const ignore = (err) => {
    const msg = String(err?.message ?? err);
    return msg.includes("Timed out") || msg.includes("postMessage");
  };
  process.on("uncaughtException", (err) => {
    if (ignore(err)) return;
  });
  process.on("unhandledRejection", (err) => {
    if (ignore(err)) return;
  });
}

export class RecaptchaJsdomExecutor {
  static async run({
    siteKey,
    action = "login",
    origin,
    referer,
    userAgent,
    enterprise = true,
  }) {
    swallowRecaptchaAsyncErrors();
    const http = await RecaptchaVmHost.bootstrapHttp({
      siteKey,
      enterprise,
      origin,
      referer,
      userAgent,
    });

    const dump = await RecaptchaVmHost.runInJsdom({
      bootstrap: http.bootstrap,
      anchor: http.anchor,
      anchorHtml: http.anchorHtml,
      headers: http.headers,
      siteKey,
      action,
      origin: origin ?? http.cfg.origin,
      referer: referer ?? http.cfg.referer,
      userAgent: userAgent ?? http.cfg.userAgent,
      runAnchorInit: true,
    });

    let executeToken = dump.grecaptcha?.executeToken ?? null;

    if (!executeToken && dump.script?.enterpriseReady) {
      executeToken = await RecaptchaJsdomExecutor.#retryExecute(
        http,
        siteKey,
        action,
        origin,
        referer,
        userAgent,
      );
    }

    return {
      ...dump,
      executeToken,
      anchor: http.anchor,
      bootstrap: http.bootstrap,
      http,
    };
  }

  static async #retryExecute(http, siteKey, action, origin, referer, userAgent) {
    const { BrowserEnvironment } = await import("./BrowserEnvironment.js");
    const env = new BrowserEnvironment({ origin, referer, userAgent });
    try {
      if (!env.window.grecaptcha?.enterprise?.execute) return null;
      return await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("execute timeout")), 30000);
        env.window.grecaptcha.enterprise.ready(async () => {
          try {
            const token = await env.window.grecaptcha.enterprise.execute(siteKey, {
              action,
            });
            clearTimeout(t);
            resolve(token);
          } catch (e) {
            clearTimeout(t);
            reject(e);
          }
        });
      });
    } catch {
      return null;
    } finally {
      env.close();
    }
  }
}
