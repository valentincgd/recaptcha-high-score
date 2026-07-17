import { Config } from "../Config.js";
import { HttpClient } from "../HttpClient.js";
import { CookieJar } from "../CookieJar.js";
import { CallbackGenerator } from "../CallbackGenerator.js";
import { EnterpriseBootstrapParser } from "../EnterpriseBootstrapParser.js";
import { AnchorParser } from "../AnchorParser.js";
import { BrowserEnvironment } from "./BrowserEnvironment.js";
import { VmScriptLoader } from "./VmScriptLoader.js";
import { VmInterpreter } from "./VmInterpreter.js";
import { Collectors } from "./Collectors.js";

/**
 * Hôte JSDOM : charge recaptcha__fr.js, init anchor, dump VM.
 */
export class RecaptchaVmHost {
  static async bootstrapHttp({
    siteKey,
    enterprise = true,
    origin,
    referer,
    userAgent,
  }) {
    const cfg = Config.fromEnv({ siteKey, enterprise, origin, referer, userAgent });
    const jar = new CookieJar();
    const headers = cfg.googleHeaders();

    const bootUrl = enterprise
      ? `https://www.google.com/recaptcha/enterprise.js?render=${siteKey}`
      : `https://www.google.com/recaptcha/api.js?render=${siteKey}`;

    const bootJs = await HttpClient.fetchText(bootUrl, headers, jar);
    const bootstrap = EnterpriseBootstrapParser.parse(bootJs);

    await HttpClient.fetchText(
      bootstrap.scriptUrl,
      { ...headers, referer: "https://www.google.com/" },
      jar,
    );

    const anchorUrl = cfg.buildAnchorUrl({
      apiBase: bootstrap.apiBase,
      version: bootstrap.version,
      cb: CallbackGenerator.generate(),
    });

    const anchorHtml = await HttpClient.fetchText(anchorUrl, headers, jar);
    const anchor = AnchorParser.parse(anchorHtml);

    return { cfg, bootstrap, anchor, anchorUrl, anchorHtml, headers, jar };
  }

  static async runInJsdom({
    bootstrap,
    anchor,
    anchorHtml,
    headers,
    siteKey,
    action = "login",
    origin,
    referer,
    userAgent,
    runAnchorInit = true,
  }) {
    const dump = {
      script: { errors: [], logs: [] },
      anchor: {
        anchorToken: anchor.anchorToken,
        encryptionKey: anchor.encryptionKey,
        bftSignature: anchor.config?.bftSignature,
        vmBytecodeKeys: anchor.config?.vmBytecodeKeys,
        collectorIndexes: anchor.config?.collectorIndexes,
      },
      bytecode: null,
      collectors: null,
      grecaptcha: null,
    };

    const env = new BrowserEnvironment({ origin, referer, userAgent });
    const { window } = env;

    try {
      env.injectRecaptchaCfg({
        siteKey,
        version: bootstrap.version,
        apiBase: bootstrap.apiBase,
      });

      try {
        const entJs = await HttpClient.fetchText(
          `https://www.google.com/recaptcha/enterprise.js?render=${siteKey}`,
          headers,
        );
        env.runScriptViaDom(entJs, "enterprise.js");
        dump.script.enterpriseLoader = true;
      } catch (err) {
        dump.script.errors.push(`enterprise.js: ${err.message?.slice(0, 120)}`);
      }

      const { source, cachePath, fromCache } = await VmScriptLoader.fetchRecaptchaBundle({
        scriptUrl: bootstrap.scriptUrl,
        headers,
      });

      dump.script.cachePath = cachePath;
      dump.script.fromCache = fromCache;
      dump.script.bytes = source.length;

      try {
        env.runScriptViaDom(source, bootstrap.scriptUrl);
        dump.script.domLoad = true;
      } catch (err) {
        dump.script.errors.push(`dom: ${err.message?.slice(0, 200)}`);
      }

      await RecaptchaVmHost.#waitForEnterprise(window, 20_000);
      dump.script.grecaptchaReady = !!window.grecaptcha;
      dump.script.enterpriseReady = !!window.grecaptcha?.enterprise?.execute;

      const hasConf =
        Array.isArray(anchor.initPayload) &&
        anchor.initPayload.some((x) => Array.isArray(x) && x[0] === "conf");

      if (runAnchorInit && hasConf) {
        dump.script.initHasConf = true;
        const initFn =
          window.recaptcha?.anchor?.Main?.init ??
          window.___grecaptcha_cfg?.clients?.[siteKey]?.anchor?.Main?.init;

        if (typeof initFn === "function") {
          try {
            initFn(anchor.initString ?? anchor.initPayload);
            dump.script.anchorInit = "Main.init";
          } catch (err) {
            dump.script.errors.push(`anchor.init: ${err.message}`);
          }
        } else if (anchorHtml) {
          const initCall = RecaptchaVmHost.#extractInitCall(anchorHtml);
          if (initCall) {
            try {
              env.runScriptViaDom(initCall, "anchor-inline-init");
              dump.script.anchorInit = "inline";
            } catch (err) {
              dump.script.errors.push(`anchor.inline: ${err.message}`);
            }
          } else {
            dump.script.errors.push(
              "recaptcha.anchor.Main.init absent — utiliser grecaptcha.enterprise.execute",
            );
          }
        } else {
          dump.script.errors.push(
            "recaptcha.anchor.Main.init absent — utiliser grecaptcha.enterprise.execute",
          );
        }
      } else if (runAnchorInit) {
        dump.script.anchorInitSkipped = "initPayload sans conf";
      }

      if (window.grecaptcha?.enterprise?.execute) {
        try {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("execute timeout")), 25_000);
            window.grecaptcha.enterprise.ready(async () => {
              try {
                const t = await window.grecaptcha.enterprise.execute(siteKey, {
                  action,
                });
                clearTimeout(timer);
                dump.grecaptcha = {
                  executeToken: t,
                  executeTokenLen: t?.length,
                  preview: t?.slice(0, 48),
                };
                resolve();
              } catch (e) {
                clearTimeout(timer);
                reject(e);
              }
            });
          });
        } catch (err) {
          dump.script.errors.push(`execute: ${err.message}`);
        }
      }

      dump.collectors = Collectors.runAll(env, {
        origin,
        referer,
        userAgent,
        siteKey,
        action,
      });

      if (anchor.configBytecode) {
        dump.bytecode = VmInterpreter.analyzeAnchorConfig(
          anchor.configBytecode,
          anchor.config?.vmBytecodeKeys,
          anchor.encryptionKey,
        );
        if (dump.collectors?.length && dump.bytecode.encryptionKey) {
          dump.encryptedSignals = VmInterpreter.encryptCollectorSignals(
            dump.collectors,
            dump.bytecode.encryptionKey ?? anchor.encryptionKey,
          );
        }
      }

      if (window.___vmDump) {
        dump.runtime = window.___vmDump;
      }
    } finally {
      env.close();
    }

    return dump;
  }

  static async #waitForEnterprise(window, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (typeof window.grecaptcha?.enterprise?.execute === "function") return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }

  static #extractInitCall(html) {
    const marker = "recaptcha.anchor.Main.init";
    const start = html.indexOf(marker);
    if (start < 0) return null;
    const callStart = html.indexOf("(", start);
    if (callStart < 0) return null;
    let depth = 0;
    for (let i = callStart; i < html.length; i++) {
      const c = html[i];
      if (c === "(") depth++;
      if (c === ")") {
        depth--;
        if (depth === 0) {
          return html.slice(start, i + 1) + ";";
        }
      }
    }
    return null;
  }
}
