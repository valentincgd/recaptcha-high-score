import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { runInContext, createContext } from "node:vm";
import { JSDOM, VirtualConsole } from "jsdom";
import { HttpClient } from "../HttpClient.js";
import { VmScriptLoader } from "../vm/VmScriptLoader.js";
import { applyBrowserPolyfills } from "./BrowserPolyfills.js";
import { applyStealthToWindow } from "./applyStealthToWindow.js";
import { installRecaptchaHandshake } from "./RecaptchaHandshake.js";
import {
  runFullAnchorHandshake,
  waitForMainExecute,
  probeAnchorRuntime,
} from "./AnchorHandshake.js";
import { dispatchWindowMessage } from "./RecaptchaHandshake.js";
import { serializePostMessageData } from "./postMessageSerialize.js";
import {
  installErrorMainDiagnostics,
  ensureAnchorInitHooks,
  collectErrorMainReport,
  formatErrorMainReport,
} from "./ErrorMainInstrumentation.js";
import { resolveConfigBytecode } from "./VmConfigBytecode.js";
import { VmRuntimeCapture } from "./VmRuntimeCapture.js";
import { installNetworkCapture } from "./NetworkCapture.js";
import { installGoogleNetwork } from "./installGoogleNetwork.js";
import { ReloadResponseParser } from "../ReloadResponseParser.js";
import { VmInterpreter } from "./VmInterpreter.js";
import { Collectors } from "./Collectors.js";
import { isTicketmasterSiteKey } from "../TicketmasterProfile.js";

let asyncGuardInstalled = false;
export function installAsyncGuard() {
  if (asyncGuardInstalled) return;
  asyncGuardInstalled = true;
  const ignore = (err) => {
    const msg = String(err?.message ?? err);
    return (
      msg.includes("Timed out") ||
      msg.includes("reCAPTCHA Timeout") ||
      msg.includes("postMessage") ||
      msg.includes("Cannot read properties of null") ||
      msg.includes("is not valid JSON") ||
      msg.includes("JSON.parse") ||
      err === 1 ||
      msg === "1"
    );
  };
  process.on("uncaughtException", (err) => {
    if (ignore(err)) return;
  });
  process.on("unhandledRejection", (err) => {
    if (ignore(err)) return;
  });
}

/**
 * Exécute la page anchor Google telle quelle (scripts injectés via HttpClient),
 * capture POST /reload + analyse VM.
 */
export class AnchorVmRunner {
  static MIN_RELOAD_BYTES =
    Number(process.env.RECAPTCHA_JSDOM_MIN_RELOAD_BYTES) || 8000;

  /** Délai max d'attente POST /reload après Main.execute. */
  static capturePollDeadline(runStarted, maxRunMs) {
    const captureMs = Number(process.env.RECAPTCHA_VM_CAPTURE_MS) || 8_000;
    const envWait = Number(process.env.RECAPTCHA_ANCHOR_VM_WAIT_MS);
    const waitMs = envWait > 0 ? Math.min(envWait, 10_000) : captureMs;
    const effective = Math.min(captureMs, waitMs);
    const remaining = maxRunMs - (Date.now() - runStarted) - 400;
    return Date.now() + Math.max(400, Math.min(effective, remaining));
  }

  static async run(ctx) {
    const tm = isTicketmasterSiteKey(ctx.cfg?.siteKey);
    const useParent =
      process.env.RECAPTCHA_ANCHOR_VM_PARENT === "1" ||
      (tm &&
        process.env.RECAPTCHA_ANCHOR_VM_PARENT !== "0" &&
        (process.env.RECAPTCHA_IDENTICAL === "1" ||
          process.env.RECAPTCHA_IDENTICAL === "1" ||
          !!(ctx.cfg?.reloadTemplatePath && String(ctx.cfg.reloadTemplatePath).trim())));
    if (useParent) {
      const { ParentAnchorVmRunner } = await import("./ParentAnchorVmRunner.js");
      ctx.onLog?.("Parent VM", "page TM + iframe anchor (capture /reload)");
      return ParentAnchorVmRunner.run(ctx);
    }
    return AnchorVmRunner.#runLegacyAnchor(ctx);
  }

  static async #runLegacyAnchor({
    cfg,
    bootstrap,
    anchor,
    anchorHtml,
    anchorUrl,
    headers,
    jar = null,
    onLog = null,
  }) {
    const log = (sub, detail = "") => {
      if (typeof onLog === "function") onLog(sub, detail);
    };

    installAsyncGuard();
    const maxRunMs = Number(process.env.RECAPTCHA_JSDOM_VM_MAX_MS) || 20_000;
    const runStarted = Date.now();
    const enterprise = cfg.mode === "enterprise" || cfg.enterprise === true;

    const captureMs = Number(process.env.RECAPTCHA_VM_CAPTURE_MS) || 3_000;
    log(
      "Anchor VM",
      `HTML ${anchorHtml.length} chars | capture ${captureMs}ms max ${maxRunMs}ms`,
    );

    const scripts = AnchorVmRunner.extractScripts(anchorHtml);
    const shell = AnchorVmRunner.htmlWithoutScripts(anchorHtml);

    const virtualConsole = new VirtualConsole();
    virtualConsole.on("error", () => {});
    virtualConsole.on("warn", () => {});

    const dom = new JSDOM(shell, {
      url: anchorUrl,
      referrer: cfg.referer ?? "https://auth.ticketmaster.com/",
      pretendToBeVisual: true,
      runScripts: "dangerously",
      resources: undefined,
      userAgent: cfg.userAgent,
      virtualConsole,
      beforeParse(w) {
        AnchorVmRunner.#wireWindow(w, { selfParent: false });
      },
    });

    const { window } = dom;
    AnchorVmRunner.#wireWindow(window, { capture: false, selfParent: false });
    installGoogleNetwork(window, headers, jar);
    installNetworkCapture(window);
    AnchorVmRunner.#seedCookies(window, jar);

    window.___grecaptcha_cfg = {
      clients: {},
      render: [cfg.siteKey],
      enterprise: enterprise ? [cfg.siteKey] : [],
      version: bootstrap.version,
      apiBase: bootstrap.apiBase,
    };

    const errors = [];

    try {
      const apiBase = bootstrap.apiBase ?? "https://www.google.com/recaptcha/api2/";
      try {
        window.__recaptcha_api = apiBase;
      } catch {
        /* ignore */
      }

      for (const s of scripts) {
        if (s.src) {
          log("Script", s.src.slice(-48));
          const js = await HttpClient.fetchText(s.src, headers, jar);
          AnchorVmRunner.#execScript(window, js, s.src);
          await AnchorVmRunner.#pause(300);
        } else if (s.body?.trim()) {
          if (s.body.includes("recaptcha.anchor.Main.init")) {
            log("Script", "defer Main.init (handshake programmé)");
            continue;
          }
          log("Script", "inline");
          AnchorVmRunner.#execScript(window, s.body, "anchor-inline");
          await AnchorVmRunner.#pause(500);
        }
      }

      if (!window.recaptcha?.anchor) {
        log("Script", "fallback recaptcha__fr.js");
        const { source } = await VmScriptLoader.fetchRecaptchaBundle({
          scriptUrl: bootstrap.scriptUrl,
          headers,
        });
        AnchorVmRunner.#execScript(window, source, bootstrap.scriptUrl);
        await AnchorVmRunner.#pause(500);
        const initScript = scripts.find(
          (s) => !s.src && s.body?.includes("recaptcha.anchor.Main.init"),
        );
        if (initScript?.body) {
          AnchorVmRunner.#execScript(window, initScript.body, "Main.init-retry");
        }
      }

      log("recaptcha", window.recaptcha?.anchor ? "anchor OK" : "anchor absent");

      const anchorSignalsEarly = Collectors.runAll(
        { window, document: window.document, origin: cfg.origin, referer: cfg.referer },
        {
          siteKey: cfg.siteKey,
          action: cfg.action,
          origin: cfg.origin,
          referer: cfg.referer,
          userAgent: cfg.userAgent,
        },
      );

      if (window.recaptcha?.anchor && process.env.RECAPTCHA_JSDOM_WIDGET === "1") {
        log("Widget", enterprise ? "enterprise.execute" : "api2.execute");
        try {
          const widgetCap = await AnchorVmRunner.#runWidgetExecute({
            anchorWin: window,
            cfg,
            bootstrap,
            headers,
            jar,
            enterprise,
            log,
          });
          if (widgetCap?.bodyLen >= AnchorVmRunner.MIN_RELOAD_BYTES) {
            window.__reloadCapture = window.__reloadCapture ?? { reloads: [] };
            window.__reloadCapture.reload = widgetCap;
          }
        } catch (widgetErr) {
          errors.push(`widget: ${widgetErr.message}`);
          log("Widget", widgetErr.message?.slice(0, 80) ?? "échec");
        }
      }

      await AnchorVmRunner.#ensureAnchorInit(window, anchor, log, anchorHtml);
      AnchorVmRunner.#triggerAnchorReload(window, log);

      const resolvedCfg = resolveConfigBytecode(anchor);
      let vmAnalysis = null;
      if (resolvedCfg?.raw) {
        vmAnalysis = VmInterpreter.analyzeAnchorConfig(
          resolvedCfg.raw,
          resolvedCfg.keys ?? anchor.config?.vmBytecodeKeys,
          anchor.encryptionKey,
        );
        if (vmAnalysis) {
          vmAnalysis.configSource = `bgdata inner=${resolvedCfg.inner?.length ?? 0} seed=${resolvedCfg.seed}`;
        }
      }

      const deadline = AnchorVmRunner.capturePollDeadline(runStarted, maxRunMs);
      let cap = null;
      while (Date.now() < deadline) {
        cap = AnchorVmRunner.#bestReloadCapture(window);
        if (cap?.bodyLen >= AnchorVmRunner.MIN_RELOAD_BYTES && cap?.body) break;
        await AnchorVmRunner.#pause(100);
      }

      let body = cap?.body ?? null;
      if (body && !Buffer.isBuffer(body)) body = Buffer.from(body);

      vmAnalysis = VmRuntimeCapture.mergeAnalysis({
        vmAnalysis,
        vmDump: window.___vmDump,
        reloadBody: body,
        configBytecode: anchor.configBytecode,
        vmBytecodeKeys: anchor.config?.vmBytecodeKeys,
        encryptionKey: anchor.encryptionKey,
      });

      const vmDump = window.___vmDump ?? null;
      const send05 =
        vmAnalysis?.sends?.find((s) => String(s).startsWith("05AL")) ??
        vmDump?.sends?.find((s) => String(s).startsWith("05AL"));

      if (body?.length && anchor.anchorToken) {
        body = AnchorVmRunner.#patchAnchorField(body, anchor.anchorToken);
      }

      const anchorSignals =
        anchorSignalsEarly.length > 0
          ? anchorSignalsEarly
          : Collectors.runAll(
              { window, document: window.document, origin: cfg.origin, referer: cfg.referer },
              {
                siteKey: cfg.siteKey,
                action: cfg.action,
                origin: cfg.origin,
                referer: cfg.referer,
                userAgent: cfg.userAgent,
              },
            );

      const executeType =
        typeof window.recaptcha?.anchor?.Main?.execute ?? "undefined";
      const errorMainReport = collectErrorMainReport(window);

      return {
        body,
        secondarySource: send05 ? "vm-send" : cap ? "network-capture" : "none",
        sendCount:
          vmAnalysis?.sends?.length ?? vmDump?.sends?.length ?? (send05 ? 1 : 0),
        vmDump: { ...(vmDump ?? {}), executeType },
        vmAnalysis,
        anchorSignals,
        recaptchaLoaded: !!window.recaptcha?.anchor,
        errorMainReport,
        errors,
        parsed: cap?.response
          ? ReloadResponseParser.parse(cap.response)
          : null,
      };
    } catch (err) {
      errors.push(err.message);
      log("Anchor VM", `erreur non bloquante: ${err.message.slice(0, 120)}`);
      return {
        body: null,
        secondarySource: "none",
        sendCount: 0,
        vmDump: window.___vmDump ?? null,
        vmAnalysis: null,
        anchorSignals: Collectors.runAll(
          { window, document: window.document },
          {
            siteKey: cfg.siteKey,
            action: cfg.action,
            origin: cfg.origin,
            referer: cfg.referer,
            userAgent: cfg.userAgent,
          },
        ),
        recaptchaLoaded: !!window.recaptcha?.anchor,
        errors,
        parsed: null,
      };
    } finally {
      dom.window.close();
    }
  }

  static extractScripts(html) {
    const scripts = [];
    const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html))) {
      const attrs = m[1] ?? "";
      const src = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
      scripts.push({ src: src ?? null, body: m[2] ?? "" });
    }
    return scripts;
  }

  static htmlWithoutScripts(html) {
    return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  }

  static execScript(window, source, filename) {
    return AnchorVmRunner.#execScript(window, source, filename);
  }

  static patchAnchorField(body, anchorToken) {
    return AnchorVmRunner.#patchAnchorField(body, anchorToken);
  }

  static seedCookies(window, jar) {
    return AnchorVmRunner.#seedCookies(window, jar);
  }

  static #wireWindow(w, { capture = true, selfParent = false } = {}) {
    applyBrowserPolyfills(w);
    applyStealthToWindow(w);
    installRecaptchaHandshake(w);
    installErrorMainDiagnostics(w);
    if (capture) installNetworkCapture(w);
    if (selfParent) {
      try {
        Object.defineProperty(w, "parent", { get: () => w, configurable: true });
        Object.defineProperty(w, "top", { get: () => w, configurable: true });
      } catch {
        /* ignore */
      }
    }
  }

  static #seedCookies(window, jar) {
    const paths = [];
    const hdr = jar?.header();
    if (hdr) paths.push(hdr);
    const p =
      process.env.RECAPTCHA_GOOGLE_COOKIES ??
      join(process.cwd(), "captures", "tm-cookies.txt");
    if (existsSync(p)) paths.push(readFileSync(p, "utf8").trim());
    for (const part of paths.join("; ").split(";")) {
      const t = part.trim();
      if (t) {
        try {
          window.document.cookie = t;
        } catch {
          /* ignore */
        }
      }
    }
  }

  static #bridgeParentOrigin(anchorWin, anchor) {
    const parentUrl =
      anchor?.initPayload?.find(
        (x) => typeof x === "string" && x.startsWith("https://"),
      ) ?? "https://auth.ticketmaster.com:443";
    let parentOrigin = parentUrl;
    try {
      parentOrigin = new URL(parentUrl).origin;
    } catch {
      /* ignore */
    }
    const parentShim = {
      location: { href: parentUrl, origin: parentOrigin },
      postMessage(message, _target, _transfer) {
        const payload = serializePostMessageData(message);
        dispatchWindowMessage(anchorWin, payload, [], { origin: parentOrigin });
      },
    };
    try {
      Object.defineProperty(anchorWin, "parent", {
        get: () => parentShim,
        configurable: true,
      });
      Object.defineProperty(anchorWin, "top", {
        get: () => parentShim,
        configurable: true,
      });
    } catch {
      /* ignore */
    }
  }

  static async #ensureAnchorInit(anchorWin, anchor, log, anchorHtml = "") {
    try {
      ensureAnchorInitHooks(anchorWin);
      AnchorVmRunner.#bridgeParentOrigin(anchorWin, anchor);
      const initScript = anchorHtml
        ? AnchorVmRunner.extractScripts(anchorHtml).find(
            (s) => !s.src && s.body?.includes("recaptcha.anchor.Main.init"),
          )
        : null;
      if (initScript?.body?.trim()) {
        AnchorVmRunner.#execScript(anchorWin, initScript.body, "Main.init-inline");
        log("init", "Main.init (script inline rejoué)");
      } else {
        const initFn = anchorWin.recaptcha?.anchor?.Main?.init;
        if (typeof initFn === "function") {
          if (anchor.initString) {
            initFn(anchor.initString);
            log("init", "Main.init (initString)");
          } else if (Array.isArray(anchor.initPayload)) {
            initFn(JSON.stringify(anchor.initPayload));
            log("init", "Main.init (initPayload → JSON)");
          }
        }
      }

      await AnchorVmRunner.#pause(
        Number(process.env.RECAPTCHA_INIT_SETTLE_MS) || 400,
      );
      await runFullAnchorHandshake(anchorWin, anchor);
      const waitMs = Number(process.env.RECAPTCHA_ANCHOR_EXECUTE_WAIT_MS) || 20_000;
      const gotExecute = await waitForMainExecute(anchorWin, waitMs);
      const errReport = collectErrorMainReport(anchorWin);
      if (
        process.env.RECAPTCHA_VM_DEBUG === "1" ||
        process.env.RECAPTCHA_ERRORMAIN_DEBUG === "1"
      ) {
        log("probe", JSON.stringify(probeAnchorRuntime(anchorWin)));
        log("ErrorMain", formatErrorMainReport(errReport));
        if (process.env.RECAPTCHA_ERRORMAIN_DEBUG === "1") {
          log("ErrorMain.json", JSON.stringify(errReport));
        }
      }
      log(
        "init",
        `handshake | Main.execute=${typeof anchorWin.recaptcha?.anchor?.Main?.execute} | wait=${gotExecute} | ${errReport.likelyCause ?? "?"}`,
      );
    } catch (e) {
      log("init", e.message?.slice(0, 80) ?? "échec");
      try {
        const errReport = collectErrorMainReport(anchorWin);
        log("ErrorMain", formatErrorMainReport(errReport));
      } catch {
        /* ignore */
      }
    }
  }

  static #triggerAnchorReload(anchorWin, log) {
    if (typeof anchorWin.recaptcha?.anchor?.Main?.execute !== "function") {
      log("reload", "Main.execute absent — pas de POST /reload VM");
      return;
    }
    try {
      anchorWin.recaptcha.anchor.Main.execute();
    } catch (e) {
      log("reload", `Main.execute erreur: ${e.message?.slice(0, 60)}`);
    }
    try {
      const clients = anchorWin.___grecaptcha_cfg?.clients ?? {};
      for (const c of Object.values(clients)) {
        c?.K?.K?.execute?.();
        c?.anchor?.Main?.execute?.();
      }
    } catch {
      /* ignore */
    }
    log("reload", "Main.execute + clients");
    const cap = anchorWin.__reloadCapture;
    if (cap && !cap.reloads?.length) {
      log("reload", "attente POST /reload (XHR Google)");
    }
  }

  static #execScript(window, source, filename) {
    const doc = window?.document;
    if (!doc?.createElement) {
      runInContext(source, createContext(window), { filename, timeout: 120_000 });
      return;
    }
    try {
      runInContext(source, createContext(window), {
        filename,
        timeout: 120_000,
      });
    } catch (err) {
      const script = doc.createElement("script");
      script.textContent = source;
      doc.head.appendChild(script);
      if (String(err.message).includes(filename)) throw err;
    }
  }

  static #patchAnchorField(body, anchorToken) {
    const tokenBuf = Buffer.from(anchorToken, "utf8");
    const field2 = Buffer.concat([
      Buffer.from([0x12]),
      ...AnchorVmRunner.#writeVarint(tokenBuf.length),
      tokenBuf,
    ]);
    const idx = body.indexOf(Buffer.from([0x12]));
    if (idx < 0) return Buffer.concat([field2, body]);
    let p = idx + 1;
    let len = 0;
    let shift = 0;
    while (p < body.length) {
      const b = body[p++];
      len |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    return Buffer.concat([body.subarray(0, idx), field2, body.subarray(p + len)]);
  }

  static #writeVarint(n) {
    const out = [];
    let v = n;
    while (v > 0x7f) {
      out.push((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    out.push(v);
    return out;
  }

  static #pause(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** Page TM + iframe(anchor) simulé → execute déclenche POST /reload sur l'anchor. */
  static async #runWidgetExecute({
    anchorWin,
    cfg,
    bootstrap,
    headers,
    jar,
    enterprise,
    log,
  }) {
    const { siteKey, action, origin, referer, userAgent } = cfg;
    const tmHtml = `<!DOCTYPE html><html><head></head><body>
      <div class="g-recaptcha" data-sitekey="${siteKey}" data-action="${action}"></div>
    </body></html>`;

    const parentDom = new JSDOM(tmHtml, {
      url: `${origin}/`,
      referrer: referer,
      pretendToBeVisual: true,
      runScripts: "dangerously",
      resources: undefined,
      userAgent,
      beforeParse(w) {
        AnchorVmRunner.#wireWindow(w);
      },
    });

    const pw = parentDom.window;
    AnchorVmRunner.#wireWindow(pw);
    AnchorVmRunner.#bridgeWindows(pw, anchorWin);
    AnchorVmRunner.#patchIframeToAnchor(pw, anchorWin);

    pw.___grecaptcha_cfg = {
      clients: {},
      render: [siteKey],
      enterprise: enterprise ? [siteKey] : [],
      version: bootstrap.version,
      apiBase: bootstrap.apiBase,
    };

    const bootUrl = enterprise
      ? `https://www.google.com/recaptcha/enterprise.js?render=${siteKey}`
      : `https://www.google.com/recaptcha/api.js?render=${siteKey}`;
    const bootJs = await HttpClient.fetchText(bootUrl, headers, jar);
    AnchorVmRunner.#execScript(pw, bootJs, bootUrl);

    const { source } = await VmScriptLoader.fetchRecaptchaBundle({
      scriptUrl: bootstrap.scriptUrl,
      headers,
    });
    AnchorVmRunner.#execScript(pw, source, bootstrap.scriptUrl);

    await AnchorVmRunner.#waitForFn(
      () =>
        enterprise
          ? typeof pw.grecaptcha?.enterprise?.execute === "function"
          : typeof pw.grecaptcha?.execute === "function",
      6_000,
    );

    const g = enterprise ? pw.grecaptcha?.enterprise : pw.grecaptcha;
    if (g) {
      g.ready = (cb) => {
        if (typeof cb === "function") queueMicrotask(cb);
      };
    }

    const exec = enterprise
      ? (k, o) => pw.grecaptcha.enterprise.execute(k, o)
      : (k, o) => pw.grecaptcha.execute(k, o);

    try {
      const token = await Promise.race([
        exec(siteKey, { action }),
        AnchorVmRunner.#pause(5_000).then(() => {
          throw new Error("widget execute timeout");
        }),
      ]);
      log("execute", `${String(token).length} chars`);
    } catch (e) {
      log("execute", e.message?.slice(0, 80) ?? "échec");
      try {
        anchorWin.recaptcha?.anchor?.Main?.execute?.();
        log("execute", "fallback anchor.Main.execute");
      } catch {
        /* ignore */
      }
    }

    await AnchorVmRunner.#pause(2_000);
    const cap = AnchorVmRunner.#bestReloadCapture(pw, anchorWin);
    parentDom.window.close();
    return cap;
  }

  static #bestReloadCapture(...wins) {
    let best = null;
    for (const w of wins) {
      if (!w?.__reloadCapture) continue;
      for (const hit of w.__reloadCapture.reloads ?? []) {
        if (!best || (hit.bodyLen ?? 0) > (best.bodyLen ?? 0)) best = hit;
      }
      const cur = w.__reloadCapture.reload;
      if (cur && (!best || (cur.bodyLen ?? 0) > (best.bodyLen ?? 0))) best = cur;
    }
    return best;
  }

  static #patchIframeToAnchor(parentWin, anchorWin) {
    const doc = parentWin?.document;
    if (!doc?.createElement) return;
    const orig = doc.createElement.bind(doc);
    doc.createElement = (name, opts) => {
      const el = orig(name, opts);
      if (String(name).toLowerCase() === "iframe") {
        try {
          Object.defineProperty(el, "contentWindow", {
            get: () => anchorWin,
            configurable: true,
          });
          Object.defineProperty(el, "contentDocument", {
            get: () => anchorWin.document,
            configurable: true,
          });
        } catch {
          /* ignore */
        }
        setTimeout(() => {
          try {
            el.onload?.();
          } catch {
            /* ignore */
          }
        }, 50);
      }
      return el;
    };
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

  static async #waitForFn(fn, ms) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (fn()) return true;
      await AnchorVmRunner.#pause(80);
    }
    return false;
  }
}
