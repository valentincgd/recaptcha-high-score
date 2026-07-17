import { FreshReloadBuilder } from "../fresh/FreshReloadBuilder.js";
import { Collectors } from "./Collectors.js";
import { BrowserEnvironment } from "./BrowserEnvironment.js";

/** Alias de FreshReloadBuilder — aucune capture reload.bin. */
export class RecaptchaVmRunner {
  static generateReloadBody({
    bootstrap,
    anchor,
    siteKey,
    action,
    userAgent,
    referer,
    origin,
  }) {
    const env = new BrowserEnvironment({ origin, referer, userAgent });
    let signalCount = 0;
    try {
      signalCount = Collectors.runAll(env, {
        origin,
        referer,
        userAgent,
        siteKey,
        action,
      }).length;
    } finally {
      env.close();
    }

    const body = FreshReloadBuilder.build({
      version: bootstrap.version,
      anchorToken: anchor.anchorToken,
      siteKey,
      action,
      encryptionKey: anchor.encryptionKey,
      configBytecode: anchor.configBytecode,
      vmBytecodeKeys: anchor.config?.vmBytecodeKeys,
      userAgent,
      referer,
      origin,
    });

    return { reloadBody: body, mode: "vm-fresh", signalCount };
  }
}
