import { JsdomBrowserReload } from "./JsdomBrowserReload.js";
import { VmPureReloadBuilder } from "../vm/VmPureReloadBuilder.js";
import { IdenticalReload } from "./IdenticalReload.js";
import {
  shouldUseIdenticalReload,
  shouldUseJsdomReload,
  describeReloadPipeline,
} from "./ReloadPipeline.js";

export { describeReloadPipeline, shouldUseJsdomReload, shouldUseIdenticalReload };

/**
 * Reload : pipeline choisi automatiquement (pas de reloadStrategy côté client).
 */
export class DynamicReload {
  static async buildAsync(opts) {
    const { cfg, bootstrap, anchor } = opts;

    if (!anchor?.anchorToken || anchor.encryptionKey == null) {
      throw new Error("anchor live requis (token + encryptionKey)");
    }

    if (shouldUseIdenticalReload(cfg)) {
      return IdenticalReload.buildAsync(opts);
    }

    if (shouldUseJsdomReload(cfg)) {
      return JsdomBrowserReload.buildAsync(opts);
    }

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
      fingerprint: cfg.fingerprint ?? opts.fingerprint,
      anchorMs: cfg.anchorMs,
      executeMs: cfg.executeMs,
      onLog: opts.onLog,
      chromeCapture: cfg.chromeCapture,
      autoDump: cfg.autoDump,
    });

    return {
      body: built.body,
      reloadBytes: built.reloadBytes,
      strategy: built.strategy,
      secondarySource: built.secondarySource,
      profileId: built.profileId,
      fingerprintSeed: built.fingerprintSeed,
      templatePath: null,
      vmAnalysis: built.vmAnalysis,
    };
  }
}
