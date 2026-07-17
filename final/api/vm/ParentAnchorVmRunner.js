import { JSDOM, VirtualConsole } from "jsdom";
import requestInterceptor from "jsdom/lib/jsdom/browser/resources/request-interceptor.js";
import { HttpClient } from "../HttpClient.js";
import { VmScriptLoader } from "./VmScriptLoader.js";
import { applyBrowserPolyfills } from "./BrowserPolyfills.js";
import { applyStealthToWindow } from "./applyStealthToWindow.js";
import {
  installRecaptchaHandshake,
  wireRecaptchaPort,
} from "./RecaptchaHandshake.js";
import { runFullAnchorHandshake, waitForMainExecute } from "./AnchorHandshake.js";
import { serializePostMessageData } from "./postMessageSerialize.js";
import {
  installErrorMainDiagnostics,
  ensureAnchorInitHooks,
  collectErrorMainReport,
  formatErrorMainReport,
} from "./ErrorMainInstrumentation.js";
import { VmRuntimeCapture } from "./VmRuntimeCapture.js";
import { installNetworkCapture } from "./NetworkCapture.js";
import { installGoogleNetwork } from "./installGoogleNetwork.js";
import { ReloadResponseParser } from "../ReloadResponseParser.js";
import { VmInterpreter } from "./VmInterpreter.js";
import { Collectors } from "./Collectors.js";
import { AnchorVmRunner, installAsyncGuard } from "./AnchorVmRunner.js";

/**
 * Page TM + iframe anchor (URL Google via intercepteur JSDOM) → execute → POST /reload capturé.
 */
export class ParentAnchorVmRunner {
  static MIN_RELOAD_BYTES =
    Number(process.env.RECAPTCHA_JSDOM_MIN_RELOAD_BYTES) || 8000;

  static async run(ctx) {
    const {
      cfg,
      bootstrap,
      anchor,
      anchorHtml,
      anchorUrl,
      headers,
      jar,
      onLog = null,
    } = ctx;
    installAsyncGuard();
    const log = (sub, d = "") => onLog?.(sub, d);
    const enterprise = cfg.mode === "enterprise" || cfg.enterprise === true;
    const maxRunMs = Number(process.env.RECAPTCHA_JSDOM_VM_MAX_MS) || 14_000;
    const runStarted = Date.now();
    const { siteKey, action, origin, referer, userAgent } = cfg;

    const tmHtml = `<!DOCTYPE html><html><head></head><body>
      <div class="g-recaptcha" data-sitekey="${siteKey}" data-action="${action}"></div>
    </body></html>`;

    const virtualConsole = new VirtualConsole();
    virtualConsole.on("error", () => {});
    virtualConsole.on("warn", () => {});

    const anchorKey = ParentAnchorVmRunner.#anchorUrlKey(anchorUrl);

    const parentDom = new JSDOM(tmHtml, {
      url: `${origin}/`,
      referrer: referer,
      pretendToBeVisual: true,
      runScripts: "dangerously",
      resources: {
        interceptors: [
          requestInterceptor(async (request) => {
            const u = request.url;
            if (ParentAnchorVmRunner.#isAnchorRequest(u, anchorKey, siteKey)) {
              const shell = AnchorVmRunner.htmlWithoutScripts(anchorHtml);
              return new Response(shell, {
                status: 200,
                headers: { "Content-Type": "text/html; charset=utf-8" },
              });
            }
            return undefined;
          }),
        ],
      },
      userAgent,
      virtualConsole,
    });

    const pw = parentDom.window;
    const errors = [];

    try {
      ParentAnchorVmRunner.#wire(pw, { topLevel: true });
      ParentAnchorVmRunner.#patchIframeChild(pw, headers, jar, log);
      installGoogleNetwork(pw, headers, jar);
      installNetworkCapture(pw);
      AnchorVmRunner.seedCookies(pw, jar);

      pw.___grecaptcha_cfg = {
        clients: {},
        render: [siteKey],
        enterprise: enterprise ? [siteKey] : [],
        version: bootstrap.version,
        apiBase: bootstrap.apiBase,
      };

      log("Parent+anchor", `api.js → iframe ${anchorKey} (intercepteur)`);

      const bootUrl = enterprise
        ? `https://www.google.com/recaptcha/enterprise.js?render=${siteKey}`
        : `https://www.google.com/recaptcha/api.js?render=${siteKey}`;
      const bootJs = await HttpClient.fetchText(bootUrl, headers, jar);
      AnchorVmRunner.execScript(pw, bootJs, bootUrl);
      await ParentAnchorVmRunner.#pause(400);
      try {
        const bundleJs = await HttpClient.fetchText(bootstrap.scriptUrl, headers, jar);
        AnchorVmRunner.execScript(pw, bundleJs, bootstrap.scriptUrl);
        log("Script", "recaptcha__fr.js (parent)");
      } catch (e) {
        errors.push(`parent bundle: ${e.message?.slice(0, 80)}`);
      }
      await ParentAnchorVmRunner.#pause(600);

      let iframeEl = null;
      await ParentAnchorVmRunner.#waitFor(() => {
        iframeEl =
          pw.document.querySelector('iframe[src*="anchor"]') ??
          pw.document.querySelector('iframe[src*="recaptcha"]') ??
          pw.document.querySelector("iframe");
        try {
          return !!iframeEl?.contentWindow?.document?.body;
        } catch {
          return false;
        }
      }, 20_000);

      if (!iframeEl) {
        iframeEl = pw.document.createElement("iframe");
        iframeEl.setAttribute("src", anchorUrl);
        iframeEl.style.display = "none";
        pw.document.body.appendChild(iframeEl);
        log("iframe", "fallback manuel");
        await ParentAnchorVmRunner.#pause(1500);
      }

      let aw = null;
      try {
        aw = iframeEl.contentWindow;
      } catch {
        aw = null;
      }

      if (aw) {
        ParentAnchorVmRunner.#wireChild(aw, pw, headers, jar);
        ParentAnchorVmRunner.#emitParentHandshake(pw, aw, anchor);
        const scripts = AnchorVmRunner.extractScripts(anchorHtml);
        for (const s of scripts) {
          if (!s.src && s.body?.includes("recaptcha.anchor.Main.init")) {
            continue;
          }
          try {
            if (s.src) {
              const js = await HttpClient.fetchText(s.src, headers, jar);
              AnchorVmRunner.execScript(aw, js, s.src);
              await ParentAnchorVmRunner.#pause(250);
            } else if (s.body?.trim()) {
              AnchorVmRunner.execScript(aw, s.body, "anchor-inline");
              await ParentAnchorVmRunner.#pause(400);
            }
          } catch (e) {
            errors.push(`script: ${e.message?.slice(0, 80)}`);
          }
        }
      }

      await ParentAnchorVmRunner.#waitFor(() => {
        try {
          aw = iframeEl?.contentWindow ?? aw;
          return !!aw?.recaptcha?.anchor;
        } catch {
          return false;
        }
      }, 12_000);

      log("anchor", aw?.recaptcha?.anchor ? "OK (iframe)" : "absent");

      const anchorSignalsEarly = aw
        ? Collectors.runAll(
            { window: aw, document: aw.document, origin: cfg.origin, referer: cfg.referer },
            { siteKey, action, origin: cfg.origin, referer: cfg.referer, userAgent },
          )
        : [];

      if (aw && aw.recaptcha?.anchor?.Main?.init) {
        try {
          ensureAnchorInitHooks(aw);
          const initScript = AnchorVmRunner.extractScripts(anchorHtml).find(
            (s) => !s.src && s.body?.includes("recaptcha.anchor.Main.init"),
          );
          if (initScript?.body?.trim()) {
            AnchorVmRunner.execScript(aw, initScript.body, "Main.init-inline");
            log("init", "Main.init (script inline iframe)");
          } else if (anchor.initString) {
            aw.recaptcha.anchor.Main.init(anchor.initString);
          } else if (Array.isArray(anchor.initPayload)) {
            aw.recaptcha.anchor.Main.init(JSON.stringify(anchor.initPayload));
          }
          await ParentAnchorVmRunner.#pause(
            Number(process.env.RECAPTCHA_INIT_SETTLE_MS) || 400,
          );
          await runFullAnchorHandshake(aw, anchor);
          const gotExec = await waitForMainExecute(aw, Number(process.env.RECAPTCHA_ANCHOR_EXECUTE_WAIT_MS) || 20_000);
          const errReport = collectErrorMainReport(aw);
          if (
            process.env.RECAPTCHA_VM_DEBUG === "1" ||
            process.env.RECAPTCHA_ERRORMAIN_DEBUG === "1"
          ) {
            log("ErrorMain", formatErrorMainReport(errReport));
          }
          log(
            "init",
            `iframe handshake | Main.execute=${typeof aw.recaptcha?.anchor?.Main?.execute} | wait=${gotExec} | ${errReport.likelyCause ?? "?"}`,
          );
        } catch (e) {
          errors.push(`init: ${e.message}`);
        }
      }

      ParentAnchorVmRunner.#patchGrecaptchaReady(pw, enterprise);

      const runChildExecute = async () => {
        if (typeof aw?.recaptcha?.anchor?.Main?.execute === "function") {
          aw.recaptcha.anchor.Main.execute();
          return true;
        }
        return false;
      };

      await ParentAnchorVmRunner.#waitFor(
        () => typeof aw?.recaptcha?.anchor?.Main?.execute === "function",
        Number(process.env.RECAPTCHA_ANCHOR_EXECUTE_WAIT_MS) || 15_000,
      );

      let executed = false;
      if (await runChildExecute()) {
        log("execute", "iframe Main.execute");
        executed = true;
      }

      if (!executed && process.env.RECAPTCHA_PARENT_GEXECUTE === "1") {
        try {
          const execFn = enterprise
            ? pw.grecaptcha?.enterprise?.execute
            : pw.grecaptcha?.execute;
          if (typeof execFn === "function") {
            ParentAnchorVmRunner.#patchGrecaptchaReady(pw, enterprise);
            const g = enterprise ? pw.grecaptcha.enterprise : pw.grecaptcha;
            await new Promise((resolve, reject) => {
              const timer = globalThis.setTimeout(
                () => reject(new Error("execute timeout")),
                6_000,
              );
              g.ready(async () => {
                try {
                  await execFn.call(g, siteKey, { action });
                  globalThis.clearTimeout(timer);
                  resolve();
                } catch (e) {
                  globalThis.clearTimeout(timer);
                  reject(e);
                }
              });
            });
            log("execute", "grecaptcha.execute (parent)");
            executed = true;
          }
        } catch (e) {
          errors.push(`execute: ${e.message}`);
          log("execute", e.message?.slice(0, 80) ?? "skip");
        }
      } else if (!executed) {
        log("execute", "skip grecaptcha parent (RECAPTCHA_PARENT_GEXECUTE=1 pour activer)");
      }

      let cap = ParentAnchorVmRunner.#bestCapture(pw, aw);

      let vmAnalysis =
        anchor.configBytecode && anchor.config?.vmBytecodeKeys?.length
          ? VmInterpreter.analyzeAnchorConfig(
              anchor.configBytecode,
              anchor.config.vmBytecodeKeys,
              anchor.encryptionKey,
            )
          : null;

      const deadline = AnchorVmRunner.capturePollDeadline(runStarted, maxRunMs);
      while (Date.now() < deadline) {
        cap = ParentAnchorVmRunner.#bestCapture(pw, aw);
        if (cap?.bodyLen >= ParentAnchorVmRunner.MIN_RELOAD_BYTES && cap?.body) break;
        await ParentAnchorVmRunner.#pause(100);
      }

      let body = cap?.body ?? null;
      if (body && !Buffer.isBuffer(body)) body = Buffer.from(body);
      if (body?.length && anchor.anchorToken) {
        body = AnchorVmRunner.patchAnchorField(body, anchor.anchorToken);
      }

      vmAnalysis = VmRuntimeCapture.mergeAnalysis({
        vmAnalysis,
        vmDump: aw?.___vmDump ?? pw.___vmDump,
        reloadBody: body,
        configBytecode: anchor.configBytecode,
        vmBytecodeKeys: anchor.config?.vmBytecodeKeys,
        encryptionKey: anchor.encryptionKey,
      });

      const errorMainReport = aw ? collectErrorMainReport(aw) : null;

      return {
        body,
        secondarySource: cap ? "network-capture" : "none",
        sendCount: vmAnalysis?.sends?.length ?? 0,
        vmDump: aw?.___vmDump ?? pw.___vmDump ?? null,
        vmAnalysis,
        anchorSignals: anchorSignalsEarly,
        recaptchaLoaded: !!aw?.recaptcha?.anchor,
        errorMainReport,
        errors,
        parsed: cap?.response ? ReloadResponseParser.parse(cap.response) : null,
      };
    } finally {
      parentDom.window.close();
    }
  }

  static #anchorUrlKey(anchorUrl) {
    try {
      const u = new URL(anchorUrl);
      return `${u.pathname}${u.search}`;
    } catch {
      return anchorUrl;
    }
  }

  static #isAnchorRequest(url, anchorKey, siteKey) {
    if (!url?.includes("google.com/recaptcha")) return false;
    if (!url.includes("/anchor")) return false;
    if (url.includes(anchorKey) || url.includes(`k=${siteKey}`)) return true;
    try {
      return ParentAnchorVmRunner.#anchorUrlKey(url) === anchorKey;
    } catch {
      return false;
    }
  }

  static #wire(w, { topLevel }) {
    applyBrowserPolyfills(w);
    applyStealthToWindow(w);
    installRecaptchaHandshake(w);
    installErrorMainDiagnostics(w);
    if (topLevel) {
      try {
        Object.defineProperty(w, "parent", { get: () => w, configurable: true });
        Object.defineProperty(w, "top", { get: () => w, configurable: true });
      } catch {
        /* ignore */
      }
    }
  }

  static #wireChild(child, parent, headers, jar) {
    ParentAnchorVmRunner.#wire(child, { topLevel: false });
    AnchorVmRunner.seedCookies(child, jar);
    installGoogleNetwork(child, headers, jar);
    installNetworkCapture(child);
    ParentAnchorVmRunner.#bridge(parent, child);
    try {
      Object.defineProperty(child, "parent", { get: () => parent, configurable: true });
      Object.defineProperty(child, "top", { get: () => parent, configurable: true });
    } catch {
      /* ignore */
    }
    if (parent.___grecaptcha_cfg) {
      child.___grecaptcha_cfg = parent.___grecaptcha_cfg;
    }
  }

  static #patchIframeChild(parentWin, headers, jar, log) {
    const doc = parentWin.document;
    const orig = doc.createElement.bind(doc);
    doc.createElement = (name, opts) => {
      const el = orig(name, opts);
      if (String(name).toLowerCase() !== "iframe") return el;
      const patch = () => {
        try {
          const cw = el.contentWindow;
          if (cw && !cw.__recaptchaChildWired) {
            cw.__recaptchaChildWired = true;
            ParentAnchorVmRunner.#wireChild(cw, parentWin, headers, jar);
            log?.("iframe", "child wired + capture");
          }
        } catch {
          /* ignore */
        }
      };
      el.addEventListener("load", () => globalThis.setTimeout(patch, 100));
      globalThis.setTimeout(patch, 500);
      globalThis.setTimeout(patch, 2000);
      return el;
    };
  }

  static #findAnchorFrame(parent) {
    for (let i = 0; i < (parent.frames?.length ?? 0); i++) {
      const f = parent.frames[i];
      if (f?.recaptcha?.anchor) return f;
    }
    for (const el of parent.document.querySelectorAll("iframe")) {
      try {
        const cw = el.contentWindow;
        if (cw?.recaptcha?.anchor) return cw;
      } catch {
        /* ignore */
      }
    }
    return null;
  }

  static #emitParentHandshake(parent, child, anchor) {
    try {
      const MC = parent.MessageChannel;
      if (!MC) return;
      const mc = new MC();
      wireRecaptchaPort(mc.port1, { window: child, peer: mc.port2 });
      wireRecaptchaPort(mc.port2, { window: parent, peer: mc.port1 });
      const label = anchor.initPayload?.[0] ?? "ainput";
      const handshake = JSON.stringify([label, null]);
      child.__recaptchaNk = handshake;
      parent.__recaptchaNk = handshake;
      try {
        mc.port2.postMessage(handshake);
      } catch {
        /* ignore */
      }
      try {
        mc.port1.start?.();
        mc.port2.start?.();
      } catch {
        /* ignore */
      }
      queueMicrotask(() => {
        try {
          child.postMessage(handshake, "https://www.google.com", [mc.port2]);
        } catch {
          /* ignore */
        }
      });
    } catch {
      /* ignore */
    }
  }

  static #bridge(parent, child) {
    const relay = (from, to) => {
      from.postMessage = (message, targetOrigin, transfer) => {
        const ports = Array.isArray(transfer) ? transfer : [];
        const payload = serializePostMessageData(message);
        for (const p of ports) {
          wireRecaptchaPort(p, { window: to });
          try {
            p.start?.();
          } catch {
            /* ignore */
          }
        }
        queueMicrotask(() => {
          const Ev = to.MessageEvent || to.Event;
          const origin =
            typeof targetOrigin === "string" && targetOrigin !== "*"
              ? targetOrigin
              : "https://www.google.com";
          const ev = new Ev("message", {
            data: payload,
            ports,
            origin,
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
      };
    };
    relay(parent, child);
    relay(child, parent);
  }

  static #bestCapture(pw, aw) {
    const wins = [pw, aw].filter(Boolean);
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

  static #patchGrecaptchaReady(pw, enterprise) {
    const patch = (g) => {
      if (!g) return;
      g.ready = (cb) => {
        if (typeof cb !== "function") return;
        try {
          cb();
        } catch {
          queueMicrotask(() => {
            try {
              cb();
            } catch {
              /* ignore */
            }
          });
        }
      };
    };
    patch(pw.grecaptcha);
    if (enterprise) patch(pw.grecaptcha?.enterprise);
  }

  static #pause(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  static async #waitFor(fn, ms) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (fn()) return true;
      await ParentAnchorVmRunner.#pause(80);
    }
    return false;
  }
}
