import { DynamicFlatReloadBuilder } from "../level2/DynamicFlatReloadBuilder.js";

export function describeReloadPipeline() {
  return "flat";
}

export function shouldUseJsdomReload() {
  return false;
}

export function shouldUseIdenticalReload() {
  return false;
}

/** Reload flat uniquement. */
export class DynamicReload {
  static buildFlat(opts) {
    const { cfg, bootstrap, anchor, onLog } = opts;

    const body = DynamicFlatReloadBuilder.build({
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
      fingerprint: cfg.fingerprint ?? opts.fingerprint,
      anchorMs: cfg.anchorMs,
      executeMs: cfg.executeMs,
      onLog,
    });

    return {
      body,
      reloadBytes: body.length,
      strategy: "dynamic-flat",
      secondarySource: "flat",
      profileId: cfg.fingerprint?.id ?? null,
      fingerprintSeed: cfg.fingerprint?._seed ?? null,
    };
  }

  static async buildAsync(opts) {
    const { anchor } = opts;
    if (!anchor?.anchorToken || anchor.encryptionKey == null) {
      throw new Error("anchor live requis (token + encryptionKey)");
    }
    return DynamicReload.buildFlat(opts);
  }
}
