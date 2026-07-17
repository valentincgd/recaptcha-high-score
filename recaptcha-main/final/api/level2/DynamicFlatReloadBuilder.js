import { ProtobufWire } from "../ProtobufWire.js";
import { ReloadStructure } from "./ReloadStructure.js";
import { TelemetryBuilder } from "./TelemetryBuilder.js";
import { FlatTelemetryBuilder } from "./FlatTelemetryBuilder.js";
import { EventCounterBuilder } from "./EventCounterBuilder.js";
import { BrowserEnvironment } from "../vm/BrowserEnvironment.js";
import { PureBrowserEnvironment } from "../vm/PureBrowserEnvironment.js";
import { Collectors } from "../vm/Collectors.js";
import { FingerprintArrayBuilder } from "../vm/FingerprintArrayBuilder.js";
import { EnterpriseBlobEncoder } from "../vm/EnterpriseBlobEncoder.js";
import { BinaryPayloadBuilder } from "../vm/BinaryPayloadBuilder.js";
import { VmInterpreter } from "../vm/VmInterpreter.js";
import { loadCapturedBDA } from "./ChromeBdaCapture.js";

/**
 * Génère un reload plat Ticketmaster Chrome Event (champs 1,2,5,6,8,14,16,20,22,25,28,29)
 * sans champ 7 ni 21 — aligné capture Charles navigateur.
 */
export class DynamicFlatReloadBuilder {
  static build({
    version,
    anchorToken,
    siteKey,
    action,
    encryptionKey,
    configBytecode = null,
    vmBytecodeKeys = null,
    userAgent = null,
    referer = null,
    origin = null,
    challengeType = "q",
    anchorMs = 20000,
    executeMs = 30000,
    secondaryToken = null,
    auxToken = null,
    eventCounts = null,
    onLog = null,
    preCollectedSignals = null,
    fingerprint = null,
    useJsdom = process.env.RECAPTCHA_FLAT_USE_JSDOM === "1",
  }) {
    const log = (sub, detail = "") => {
      if (typeof onLog === "function") onLog(sub, detail);
    };

    const resolvedOrigin =
      origin ?? referer?.replace(/\/$/, "") ?? "https://auth.ticketmaster.com";
    log(useJsdom ? "JSDOM" : "Pur", `origin=${resolvedOrigin}`);
    const env = useJsdom
      ? new BrowserEnvironment({ userAgent, referer, origin: resolvedOrigin })
      : fingerprint != null
        ? PureBrowserEnvironment.fromFingerprint({
            ...fingerprint,
            origin: fingerprint.origin ?? resolvedOrigin,
            referer: fingerprint.referer ?? referer,
            userAgent: fingerprint.userAgent ?? userAgent,
          })
        : new PureBrowserEnvironment({
            userAgent,
            referer,
            origin: resolvedOrigin,
          });

    try {
      const ctx = { siteKey, action, origin: resolvedOrigin, referer, userAgent };
      const signals =
        preCollectedSignals?.length > 0
          ? preCollectedSignals
          : Collectors.runAll(env, ctx);
      log(
        "Collecteurs",
        preCollectedSignals?.length
          ? `${signals.length} signaux (anchor VM / recaptcha chargé)`
          : `${signals.length} signaux (UA, WebGL, cookies, …)`,
      );

      const vmAnalysis =
        configBytecode && vmBytecodeKeys?.length
          ? VmInterpreter.analyzeAnchorConfig(
              configBytecode,
              vmBytecodeKeys,
              encryptionKey,
            )
          : null;

      const liveKey = vmAnalysis?.encryptionKey ?? encryptionKey;
      if (liveKey == null || !anchorToken) {
        throw new Error(
          "anchorToken et encryptionKey requis (réponse anchor live ou tm-session.json complet)",
        );
      }
      log(
        "VM anchor",
        vmAnalysis?.encryptionKey != null
          ? `clé VM + ${vmAnalysis.sends?.length ?? 0} SEND`
          : `clé session ${liveKey}`,
      );

      const encSignals =
        liveKey && signals.length
          ? VmInterpreter.encryptCollectorSignals(signals, liveKey)
          : [];
      log("Chiffrement LCG", `${encSignals.length} blobs signal`);

      let blobInner = encSignals.length
        ? EnterpriseBlobEncoder.encodeFromEncryptedChunks(encSignals)
        : EnterpriseBlobEncoder.encodeFromSignals(signals, liveKey);
      if (!Buffer.isBuffer(blobInner)) {
        blobInner = EnterpriseBlobEncoder.encodeFingerprintPayload(
          FingerprintArrayBuilder.serialize(FingerprintArrayBuilder.build(env, ctx)),
          liveKey,
        );
      }

      const fpSerialized = FingerprintArrayBuilder.serialize(
        FingerprintArrayBuilder.build(env, ctx),
      );
      if (blobInner.length < 4000) {
        blobInner = Buffer.concat([
          blobInner,
          EnterpriseBlobEncoder.encodeFingerprintPayload(fpSerialized, liveKey),
        ]);
      }

      const telemetryInner = TelemetryBuilder.build({ version });
      const eventsInner = EventCounterBuilder.build(eventCounts);
      let encryptedBlob = EnterpriseBlobEncoder.patchBlobSegments(blobInner, {
        telemetry: telemetryInner,
        events: eventsInner,
        siteKey,
        action,
      });
      if (!Buffer.isBuffer(encryptedBlob)) {
        encryptedBlob = Buffer.isBuffer(blobInner) ? blobInner : Buffer.from(blobInner);
      }

      const fpInner = Buffer.concat([
        ProtobufWire.writeString(8, action),
        ProtobufWire.writeString(14, siteKey),
        ProtobufWire.writeBytes(2088, encryptedBlob),
      ]);
      const fingerprintHash = String(
        ReloadStructure.hashFingerprintSerialized(fpInner.toString("latin1")),
      );

      const field20 = FlatTelemetryBuilder.build({ env, referer });
      const capturedBDA = loadCapturedBDA();
      const field22 =
        capturedBDA ??
        BinaryPayloadBuilder.build(env, {
          encryptionKey: liveKey,
          version,
          siteKey,
        });
      const field25 = EventCounterBuilder.buildFlat(eventCounts);

      log(
        "Champs protobuf",
        `1=${version} 5=${fingerprintHash} 8=${action} 14=${siteKey} 16=${encryptedBlob.length}b 20=${field20.length}c 22=${field22.length}c(${capturedBDA ? "capture" : "gen"}) 25=${field25.length}c`,
      );

      const parts = [
        ProtobufWire.writeString(1, version),
        ProtobufWire.writeBytes(2, Buffer.from(anchorToken, "utf8")),
        ProtobufWire.writeString(5, fingerprintHash),
        ProtobufWire.writeString(6, challengeType),
        ProtobufWire.writeString(8, action),
        ProtobufWire.writeString(14, siteKey),
        ProtobufWire.writeBytes(16, encryptedBlob),
        ProtobufWire.writeString(20, field20),
        ProtobufWire.writeString(22, field22),
        ProtobufWire.writeString(25, field25),
        ProtobufWire.writeInt32(28, Number(anchorMs) || 20000),
        ProtobufWire.writeInt32(29, Number(executeMs) || 30000),
      ];

      return Buffer.concat(parts);
    } finally {
      env.close();
    }
  }
}
