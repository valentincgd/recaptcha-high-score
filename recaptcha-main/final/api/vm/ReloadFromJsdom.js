import { ProtobufWire } from "../ProtobufWire.js";
import { ReloadStructure } from "../level2/ReloadStructure.js";
import { F7Assembler } from "../level2/F7Assembler.js";
import { TelemetryBuilder } from "../level2/TelemetryBuilder.js";
import { EventCounterBuilder } from "../level2/EventCounterBuilder.js";
import { SecondaryTokenGenerator } from "./SecondaryTokenGenerator.js";
import { VmInterpreter } from "./VmInterpreter.js";
import { EnterpriseBlobEncoder } from "./EnterpriseBlobEncoder.js";
import { Collectors } from "./Collectors.js";
import { BrowserEnvironment } from "./BrowserEnvironment.js";

/**
 * Construit et POST le reload en utilisant anchor HTTP + empreinte JSDOM + VM analyse.
 */
export class ReloadFromJsdom {
  static buildReloadBody({
    bootstrap,
    anchor,
    siteKey,
    action,
    userAgent,
    referer,
    origin,
    vmDump,
  }) {
    const env = new BrowserEnvironment({ origin, referer, userAgent });
    try {
      const ctx = { siteKey, action, origin, referer, userAgent };
      const signals = Collectors.runAll(env, ctx);

      const vmAnalysis = anchor.configBytecode
        ? VmInterpreter.analyzeAnchorConfig(
            anchor.configBytecode,
            anchor.config?.vmBytecodeKeys,
            anchor.encryptionKey,
          )
        : null;

      const encryptionKey =
        vmAnalysis?.encryptionKey ?? anchor.encryptionKey;

      const secondaryToken =
        vmDump?.executeToken?.startsWith("05AL")
          ? vmDump.executeToken
          : vmAnalysis?.sends?.find((s) => String(s).startsWith("05AL")) ??
            ReloadFromJsdom.#synthetic05AL(anchor);

      const encSignals = VmInterpreter.encryptCollectorSignals(signals, encryptionKey);
      let blobInner = EnterpriseBlobEncoder.encodeFromEncryptedChunks(encSignals);

      const telemetry = TelemetryBuilder.build({ version: bootstrap.version });
      const events = EventCounterBuilder.build();
      blobInner = EnterpriseBlobEncoder.patchBlobSegments(blobInner, {
        telemetry,
        events,
        siteKey,
        action,
      });

      const f7 = F7Assembler.build({
        secondaryToken,
        action,
        siteKey,
        encryptedBlob: blobInner,
      });

      const suffix = ReloadStructure.buildSuffix({
        f5Hash: String(
          ReloadStructure.hashFingerprintSerialized(f7.toString("latin1")),
        ),
        challengeType: "q",
        f7,
      });

      return ReloadStructure.buildTopLevel({
        version: bootstrap.version,
        anchorToken: anchor.anchorToken,
        suffix,
      });
    } finally {
      env.close();
    }
  }

  static #synthetic05AL(anchor) {
    return SecondaryTokenGenerator.generate({
      anchorToken: anchor.anchorToken,
      encryptionKey: anchor.encryptionKey,
      configBytecode: anchor.configBytecode,
      vmBytecodeKeys: anchor.config?.vmBytecodeKeys,
    });
  }
}
