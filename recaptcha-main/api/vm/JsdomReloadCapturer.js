import { JSDOM, VirtualConsole } from "jsdom";
import { applyBrowserPolyfills } from "./BrowserPolyfills.js";
import { installRecaptchaHandshake } from "./RecaptchaHandshake.js";
import { installNetworkCapture } from "./NetworkCapture.js";
import { RecaptchaVmHost } from "./RecaptchaVmHost.js";
import { ReloadResponseParser } from "../ReloadResponseParser.js";

/**
 * Exécute reCAPTCHA en JSDOM (Google uniquement) et capture le POST /reload VM.
 * Pas de navigateur, pas de requête Ticketmaster.
 */
let asyncGuardInstalled = false;
function installAsyncGuard() {
  if (asyncGuardInstalled) return;
  asyncGuardInstalled = true;
  const ignore = (err) => {
    const msg = String(err?.message ?? err);
    return (
      msg.includes("Timed out") ||
      msg.includes("reCAPTCHA Timeout") ||
      msg.includes("postMessage") ||
      msg.includes("Cannot read properties of null")
    );
  };
  process.on("uncaughtException", (err) => {
    if (ignore(err)) return;
  });
  process.on("unhandledRejection", (err) => {
    if (ignore(err)) return;
  });
}

export class JsdomReloadCapturer {
  static async capture({
    siteKey,
    action = "login",
    origin = "https://auth.ticketmaster.com",
    referer = "https://auth.ticketmaster.com/",
    userAgent,
    timeoutMs = Number(process.env.RECAPTCHA_JSDOM_TIMEOUT_MS) || 90_000,
  }) {
    installAsyncGuard();
    const http = await RecaptchaVmHost.bootstrapHttp({
      siteKey,
      enterprise: true,
      origin,
      referer,
      userAgent,
    });

    const parent = await JsdomReloadCapturer.#runParentPage({
      http,
      siteKey,
      action,
      origin,
      referer,
      userAgent: userAgent ?? http.cfg.userAgent,
      timeoutMs,
    });

    return {
      ...parent,
      anchor: http.anchor,
      bootstrap: http.bootstrap,
      anchorUrl: http.anchorUrl,
      jar: http.jar,
      http,
    };
  }

  static async #runParentPage({ http, siteKey, action, origin, referer, userAgent, timeoutMs }) {
    const virtualConsole = new VirtualConsole();
    for (const ev of ["error", "warn"]) {
      virtualConsole.on(ev, () => {});
    }

    const html = `<!DOCTYPE html><html><head></head><body>
      <div class="g-recaptcha" data-sitekey="${siteKey}" data-action="${action}"></div>
      <textarea id="g-recaptcha-response" name="g-recaptcha-response"></textarea>
      <div id="recaptcha-token"></div>
    </body></html>`;
    const dom = new JSDOM(html, {
      url: `${origin}/`,
      referrer: referer,
      pretendToBeVisual: true,
      runScripts: "dangerously",
      resources: "usable",
      userAgent,
      virtualConsole,
      beforeParse(w) {
        applyBrowserPolyfills(w);
        installRecaptchaHandshake(w);
        installNetworkCapture(w);
      },
    });

    const { window } = dom;
    applyBrowserPolyfills(window);
    installRecaptchaHandshake(window);
    installNetworkCapture(window);
    JsdomReloadCapturer.#patchIframeOnLoad(window);
    try {
      Object.defineProperty(window, "parent", { get: () => window, configurable: true });
    } catch {
      /* ignore */
    }

    window.___grecaptcha_cfg = {
      clients: {},
      render: [siteKey],
      enterprise: [],
      enterprise2fa: [],
      oid: {},
      version: http.bootstrap.version,
      apiBase: http.bootstrap.apiBase,
    };

    const errors = [];

    try {
      const entUrl = `https://www.google.com/recaptcha/enterprise.js?render=${siteKey}`;
      const entJs = await fetch(entUrl, {
        headers: { "user-agent": userAgent, referer: "https://www.google.com/" },
      }).then((r) => r.text());

      await JsdomReloadCapturer.#appendScript(window, entJs, entUrl);

      const frRes = await fetch(http.bootstrap.scriptUrl, {
        headers: { "user-agent": userAgent, referer: "https://www.google.com/" },
      });
      const frJs = await frRes.text();
      await JsdomReloadCapturer.#appendScript(window, frJs, http.bootstrap.scriptUrl);

      await JsdomReloadCapturer.#waitFor(
        () => typeof window.grecaptcha?.enterprise?.execute === "function",
        25_000,
      );

      await JsdomReloadCapturer.#mountAnchorIframe(window, http.anchorUrl);

      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("execute timeout")), timeoutMs);
        window.grecaptcha.enterprise.ready(async () => {
          try {
            const token = await window.grecaptcha.enterprise.execute(siteKey, { action });
            clearTimeout(timer);
            window.__executeToken = token;
            resolve(token);
          } catch (e) {
            clearTimeout(timer);
            reject(e);
          }
        });
      }).catch((e) => {
        errors.push(`execute: ${e.message}`);
      });

      await JsdomReloadCapturer.#waitForReloadCapture(window, 15_000);

      const cap = window.__reloadCapture?.reload;
      const executeToken = window.__executeToken ?? null;
      let token = null;

      if (executeToken?.startsWith("0cAFcWeA") && executeToken.length > 500) {
        token = executeToken;
      } else if (cap?.response) {
        const parsed = ReloadResponseParser.parse(cap.response);
        token = parsed.token;
      }

      return {
        token,
        success: !!token,
        executeToken,
        reloadCapture: cap,
        reloadBytes: cap?.bodyLen ?? null,
        errors,
        grecaptchaReady: !!window.grecaptcha,
        enterpriseReady: !!window.grecaptcha?.enterprise?.execute,
        vmDump: window.___vmDump ?? null,
      };
    } finally {
      dom.window.close();
    }
  }

  static #patchIframeOnLoad(window) {
    const doc = window.document;
    const orig = doc.createElement.bind(doc);
    doc.createElement = (name, opts) => {
      const el = orig(name, opts);
      if (String(name).toLowerCase() === "iframe") {
        const patch = () => {
          try {
            const w = el.contentWindow;
            if (w && !w.__recaptchaPolyfilled) {
              applyBrowserPolyfills(w);
              installRecaptchaHandshake(w);
              installNetworkCapture(w);
              w.__recaptchaPolyfilled = true;
            }
          } catch {
            /* ignore */
          }
        };
        el.addEventListener("load", patch);
        setTimeout(patch, 0);
      }
      return el;
    };
  }

  static async #appendScript(window, source, src) {
    return new Promise((resolve, reject) => {
      const script = window.document.createElement("script");
      script.textContent = source;
      if (src) script.setAttribute("src", src);
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`script load failed: ${src}`));
      window.document.head.appendChild(script);
      setTimeout(resolve, 50);
    });
  }

  static async #waitFor(fn, ms) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (fn()) return true;
      await new Promise((r) => setTimeout(r, 80));
    }
    return false;
  }

  static async #mountAnchorIframe(window, anchorUrl) {
    return new Promise((resolve) => {
      const iframe = window.document.createElement("iframe");
      iframe.setAttribute("src", anchorUrl);
      iframe.setAttribute("title", "reCAPTCHA anchor");
      iframe.style.display = "none";
      const done = () => {
        try {
          const child = iframe.contentWindow;
          if (child) {
            JsdomReloadCapturer.#bridgeWindows(window, child);
            window.frames = window.frames || [];
            window.frames[0] = child;
            window.length = 1;
          }
        } catch {
          /* ignore */
        }
        resolve();
      };
      iframe.onload = () => setTimeout(done, 2000);
      iframe.onerror = () => done();
      window.document.body.appendChild(iframe);
      setTimeout(done, 15_000);
    });
  }

  static #bridgeWindows(parent, child) {
    const relay = (from, to) => {
      const orig = from.postMessage?.bind(from);
      if (!orig) return;
      from.postMessage = (message, targetOrigin, transfer) => {
        const ports = Array.isArray(transfer) ? transfer : [];
        queueMicrotask(() => {
          const Ev = to.MessageEvent || to.Event;
          const ev = new Ev("message", {
            data: message,
            ports,
            origin: typeof targetOrigin === "string" ? targetOrigin : "*",
            source: from,
          });
          if (typeof to.onmessage === "function") to.onmessage(ev);
          const list = to._evtMap?.get("message") ?? [];
          for (const fn of list) {
            try {
              fn.call(to, ev);
            } catch {
              /* ignore */
            }
          }
          for (const port of ports) {
            if (port?._queue?.length && typeof port.onmessage === "function") {
              port.onmessage(port._queue.shift());
            }
          }
        });
        try {
          orig(message, targetOrigin ?? "*", transfer);
        } catch {
          /* ignore */
        }
      };
    };
    relay(parent, child);
    relay(child, parent);
  }

  static async #waitForReloadCapture(window, ms) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const cap = window.__reloadCapture?.reload;
      if (cap?.bodyLen >= 8000 && cap?.response) return cap;
      await new Promise((r) => setTimeout(r, 100));
    }
    return window.__reloadCapture?.reload ?? null;
  }
}
