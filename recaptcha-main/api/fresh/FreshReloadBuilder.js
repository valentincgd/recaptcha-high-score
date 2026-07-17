import { ProtobufWire } from "../ProtobufWire.js";
import { ReloadStructure } from "../level2/ReloadStructure.js";
import { F7Assembler } from "../level2/F7Assembler.js";
import { TelemetryBuilder } from "../level2/TelemetryBuilder.js";
import { EventCounterBuilder } from "../level2/EventCounterBuilder.js";
import { BrowserEnvironment } from "../vm/BrowserEnvironment.js";
import { Collectors } from "../vm/Collectors.js";
import { FingerprintArrayBuilder } from "../vm/FingerprintArrayBuilder.js";
import { EnterpriseBlobEncoder } from "../vm/EnterpriseBlobEncoder.js";
import { SecondaryTokenGenerator } from "../vm/SecondaryTokenGenerator.js";
import { VmInterpreter } from "../vm/VmInterpreter.js";

/**
 * Corps reload enterprise généré de A à Z — aucun reload.bin / reload.curl.
 */
export class FreshReloadBuilder {
  static build({
    version,
    anchorToken,
    siteKey,
    action = "login",
    encryptionKey,
    configBytecode = null,
    vmBytecodeKeys = null,
    userAgent,
    referer,
    origin,
    challengeType = "q",
  }) {
    const env = new BrowserEnvironment({
      origin: origin ?? "https://auth.ticketmaster.com",
      referer: referer ?? "https://auth.ticketmaster.com/",
      userAgent,
    });

    try {
      const ctx = { siteKey, action, origin, referer, userAgent };
      const signals = Collectors.runAll(env, ctx);
      const fpArray = FingerprintArrayBuilder.build(env, ctx);
      const serialized = FingerprintArrayBuilder.serialize(fpArray);

      const vmAnalysis =
        configBytecode && vmBytecodeKeys
          ? VmInterpreter.analyzeAnchorConfig(
              configBytecode,
              vmBytecodeKeys,
              encryptionKey,
            )
          : null;

      const liveKey = vmAnalysis?.encryptionKey ?? encryptionKey;

      const encSignals =
        liveKey && signals.length
          ? VmInterpreter.encryptCollectorSignals(signals, liveKey)
          : null;

      let blobInner = encSignals?.length
        ? EnterpriseBlobEncoder.encodeFromEncryptedChunks(encSignals)
        : EnterpriseBlobEncoder.encodeFromSignals(signals, liveKey);

      if (blobInner.length < 8000) {
        const jsonBlob = EnterpriseBlobEncoder.encodeFingerprintPayload(
          serialized,
          liveKey,
        );
        blobInner = Buffer.concat([blobInner, jsonBlob]);
      }

      const telemetry = TelemetryBuilder.build({ version });
      const events = EventCounterBuilder.build();

      const send05 = vmAnalysis?.sends?.find((s) => String(s).startsWith("05AL"));
      const secondaryToken =
        send05 ??
        SecondaryTokenGenerator.generate({
          anchorToken,
          encryptionKey: liveKey,
          configBytecode,
          vmBytecodeKeys,
        });

      const encryptedBlob = EnterpriseBlobEncoder.patchBlobSegments(blobInner, {
        telemetry,
        events,
        siteKey,
        action,
      });

      const f7 = F7Assembler.build({
        secondaryToken,
        action,
        siteKey,
        encryptedBlob,
      });

      const f5Hash = ReloadStructure.hashFingerprintSerialized(
        f7.toString("latin1"),
      );

      const suffix = ReloadStructure.buildSuffix({
        f5Hash: String(f5Hash),
        challengeType,
        f7,
      });

      return ReloadStructure.buildTopLevel({
        version,
        anchorToken,
        suffix,
      });
    } finally {
      env.close();
    }
  }
}
