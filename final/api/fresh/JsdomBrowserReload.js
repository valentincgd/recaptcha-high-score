import { AnchorVmRunner } from "../vm/AnchorVmRunner.js";
import { DynamicFlatReloadBuilder } from "../level2/DynamicFlatReloadBuilder.js";
import { VmPureReloadBuilder } from "../vm/VmPureReloadBuilder.js";
import { FreshReloadBuilder } from "./FreshReloadBuilder.js";
import { VmRuntimeCapture } from "../vm/VmRuntimeCapture.js";
import { saveNativeSessionDump } from "../vm/saveNativeSessionDump.js";

/**
 * Reload type navigateur : anchor VM (scripts réels) → fallback protobuf plat.
 */
export class JsdomBrowserReload {
  static MIN_RELOAD_BYTES =
    Number(process.env.RECAPTCHA_JSDOM_MIN_RELOAD_BYTES) || 8000;

  static async buildAsync({
    cfg,
    bootstrap,
    anchor,
    anchorUrl,
    anchorHtml = null,
    headers,
    jar,
    onLog = null,
  }) {
    const log = (sub, detail = "") => {
      if (typeof onLog === "function") onLog(sub, detail);
    };

    if (process.env.RECAPTCHA_JSDOM_BROWSER === "0") {
      log("JSDOM VM", "désactivé → reload pur (VmPureReloadBuilder)");
      return JsdomBrowserReload.#pureFallback({ cfg, bootstrap, anchor, onLog, anchorSignals: null });
    }

    if (!anchorHtml?.length) {
      log("Anchor VM", "HTML anchor manquant → flat");
      return JsdomBrowserReload.#flatFallback({ cfg, bootstrap, anchor, onLog });
    }

    log("Anchor VM", "page anchor Google + scripts injectés (HttpClient)");

    let vmAnalysis = null;
    let anchorSignals = null;
    try {
      const vm = await AnchorVmRunner.run({
        cfg,
        bootstrap,
        anchor,
        anchorHtml,
        anchorUrl,
        headers,
        jar,
        onLog: log,
      });
      vmAnalysis = VmRuntimeCapture.mergeAnalysis({
        vmAnalysis: vm.vmAnalysis,
        vmDump: vm.vmDump,
        reloadBody: vm.body,
        configBytecode: anchor.configBytecode,
        vmBytecodeKeys: anchor.config?.vmBytecodeKeys,
        encryptionKey: anchor.encryptionKey,
      });
      anchorSignals = vm.anchorSignals;

      const dumpPath = saveNativeSessionDump(
        {
        source: "dynamic-jsdom",
        reloadBytes: vm.body?.length ?? 0,
        secondarySource: vm.secondarySource,
        sendCount: vm.sendCount,
        vmDump: vm.vmDump,
        errorMainReport: vm.errorMainReport,
        anchorSignals: anchorSignals?.length,
      },
        { autoDump: cfg.autoDump },
      );
      if (dumpPath) log("Session dump", dumpPath);

      if (vm.body?.length >= JsdomBrowserReload.MIN_RELOAD_BYTES) {
        log(
          "Reload capturé VM",
          `${vm.body.length} octets | source=${vm.secondarySource} | sends=${vm.sendCount}`,
        );
        return {
          body: vm.body,
          reloadBytes: vm.body.length,
          strategy: "dynamic-jsdom",
          secondarySource: vm.secondarySource,
          templatePath: null,
          vmDump: vm.vmDump,
        };
      }

      const partial = vm.body?.length ?? 0;
      log(
        "Reload VM incomplet",
        `${partial} o — fallback JS pur + signaux JSDOM (fingerprint régénéré)`,
      );
      return JsdomBrowserReload.#pureFallback({
        cfg,
        bootstrap,
        anchor,
        onLog,
        anchorSignals,
      });
    } catch (err) {
      if (process.env.RECAPTCHA_ALLOW_FLAT_FALLBACK !== "1") {
        throw err;
      }
      log("Anchor VM échec", err.message.slice(0, 160));
    }

    return JsdomBrowserReload.#flatFallback({
      cfg,
      bootstrap,
      anchor,
      onLog,
      vmAnalysis,
      anchorSignals,
    });
  }

  static #pureFallback({ cfg, bootstrap, anchor, onLog, anchorSignals = null }) {
    const built = VmPureReloadBuilder.build({
      version: bootstrap.version,
      anchorToken: anchor.anchorToken,
      siteKey: cfg.siteKey,
      action: cfg.action,
      encryptionKey: anchor.encryptionKey,
      anchor,
      configBytecode: anchor.configBytecode,
      vmBytecodeKeys: anchor.config?.vmBytecodeKeys,
      userAgent: cfg.userAgent,
      referer: cfg.referer,
      origin: cfg.origin,
      fingerprint: cfg.fingerprint,
      anchorMs: cfg.anchorMs,
      executeMs: cfg.executeMs,
      preCollectedSignals: anchorSignals,
      onLog,
    });
    return {
      body: built.body,
      reloadBytes: built.reloadBytes,
      strategy: built.strategy,
      secondarySource: built.secondarySource,
      templatePath: null,
    };
  }

  static #flatFallback({
    cfg,
    bootstrap,
    anchor,
    onLog,
    vmAnalysis = null,
    anchorSignals = null,
  }) {
    const useNested = process.env.RECAPTCHA_RELOAD_NESTED === "1";
    const body = useNested
      ? FreshReloadBuilder.build({
          version: bootstrap.version,
          anchorToken: anchor.anchorToken,
          siteKey: cfg.siteKey,
          action: cfg.action,
          encryptionKey: anchor.encryptionKey,
          configBytecode: anchor.configBytecode,
          vmBytecodeKeys: anchor.config?.vmBytecodeKeys,
          userAgent: cfg.userAgent,
          referer: cfg.referer,
          origin: cfg.origin,
        })
      : DynamicFlatReloadBuilder.build({
          version: bootstrap.version,
          anchorToken: anchor.anchorToken,
          siteKey: cfg.siteKey,
          action: cfg.action,
          encryptionKey: anchor.encryptionKey,
          configBytecode: anchor.configBytecode,
          vmBytecodeKeys: anchor.config?.vmBytecodeKeys,
          userAgent: cfg.userAgent,
          referer: cfg.referer,
          origin: cfg.origin,
          anchorMs: cfg.anchorMs,
          executeMs: cfg.executeMs,
          preCollectedSignals: anchorSignals,
          onLog,
        });
    if (typeof onLog === "function") {
      onLog("Reload fallback", `${useNested ? "nested" : "flat"} ${body.length} o`);
    }
    return {
      body,
      reloadBytes: body.length,
      strategy: "dynamic",
      secondarySource: useNested ? "fresh-nested" : "flat-fallback",
      templatePath: null,
    };
  }
}
