import { ProtobufWire } from "../ProtobufWire.js";
import { ReloadStructure } from "../level2/ReloadStructure.js";
import { TelemetryBuilder } from "../level2/TelemetryBuilder.js";
import { FlatTelemetryBuilder } from "../level2/FlatTelemetryBuilder.js";
import { EventCounterBuilder } from "../level2/EventCounterBuilder.js";
import { F7Assembler } from "../level2/F7Assembler.js";
import { Collectors } from "./Collectors.js";
import { ExtendedCollectors } from "./ExtendedCollectors.js";
import { VmRustCatalog } from "./VmRustCatalog.js";
import { BrowserSimulator } from "./BrowserSimulator.js";
import { FingerprintArrayBuilder } from "./FingerprintArrayBuilder.js";
import { EnterpriseBlobEncoder } from "./EnterpriseBlobEncoder.js";
import { SecondaryTokenGenerator } from "./SecondaryTokenGenerator.js";
import { AuxTokenGenerator } from "./AuxTokenGenerator.js";
import { BinaryPayloadBuilder } from "./BinaryPayloadBuilder.js";
import { VmBytecodeRunner } from "./VmBytecodeRunner.js";
import { VmSignalMapper } from "./VmSignalMapper.js";
import { EnterpriseSignalStream } from "./EnterpriseSignalStream.js";
import { InnerBlobPatcher } from "../level2/InnerBlobPatcher.js";
import { loadChromeVmCapture } from "./loadChromeVmCapture.js";
import { resolveFreshFingerprint } from "./FreshFingerprint.js";
import { saveNativeSessionDump } from "./saveNativeSessionDump.js";

/**
 * Reload 100 % JS pur : simulateur navigateur + bytecode config VM + LCG (parse.rs reg 586).
 */
export class VmPureReloadBuilder {
  static build({
    version,
    anchorToken,
    siteKey,
    action,
    encryptionKey,
    anchor = null,
    configBytecode = null,
    vmBytecodeKeys = null,
    userAgent = null,
    referer = null,
    origin = null,
    fingerprint = null,
    challengeType = "q",
    anchorMs = 20000,
    executeMs = 30000,
    secondaryToken = null,
    auxToken = null,
    eventCounts = null,
    onLog = null,
    preCollectedSignals = null,
    chromeCapture = false,
    autoDump = true,
  }) {
    const log = (sub, detail = "") => {
      if (typeof onLog === "function") onLog(sub, detail);
    };

    const resolvedOrigin =
      origin ?? referer?.replace(/\/$/, "") ?? "https://auth.ticketmaster.com";

    const freshProfile = fingerprint
      ? typeof fingerprint === "object" && fingerprint.userAgent
        ? fingerprint
        : BrowserSimulator.resolveProfile(fingerprint)
      : resolveFreshFingerprint({
          profileId: process.env.RECAPTCHA_FINGERPRINT_PROFILE,
          seed: `${anchorToken}:${encryptionKey}`,
        });

    const { profile, env } = BrowserSimulator.createEnvironment({
      origin: resolvedOrigin,
      referer,
      fingerprint: freshProfile,
    });

    log(
      "Simulateur",
      `profil=${profile.id} (frais) | ${env.window.innerWidth}x${env.window.innerHeight} | seed=${freshProfile._seed ?? "—"}`,
    );

    try {
      const chromeCaptureDump = loadChromeVmCapture({ enabled: chromeCapture });
      const vmDump = chromeCaptureDump
        ? {
            ...chromeCapture,
            ...(anchor?.vmDump ?? {}),
            ...(env.window?.___vmDump ?? {}),
          }
        : env.window?.___vmDump ?? anchor?.vmDump ?? null;
      const hasDump =
        vmDump &&
        (vmDump.last05AL ||
          vmDump.sends?.length ||
          vmDump.bytecodes?.length);

      const vmRun = VmBytecodeRunner.analyze(
        anchor ?? { configBytecode, config: { vmBytecodeKeys } },
        encryptionKey,
        {
          env,
          vmDump: hasDump ? vmDump : null,
        },
      );

      if (chromeCaptureDump?.last05AL) {
        log(
          "Chrome capture",
          `(RECAPTCHA_CHROME_CAPTURE=1) 05AL=${chromeCaptureDump.last05AL.length} car.`,
        );
      }
      const liveKey = Number(vmRun.encryptionKey) | 0;

      if (liveKey == null || !anchorToken) {
        throw new Error("anchorToken et encryptionKey requis");
      }

      log(
        "VM config",
        `clé=${liveKey} | signalKeys=${vmRun.signalKeys.length} | SEND=${vmRun.sends.length} | main=${vmRun.mainExec?.mainBytecodeSource ?? "?"} (${vmRun.mainExec?.mainBytecodeLen ?? 0}b) | runtimeSEND=${vmRun.mainExec?.runtimeSends ?? 0}`,
      );

      const ctx = {
        siteKey,
        action,
        origin: resolvedOrigin,
        referer: referer ?? env.referer,
        userAgent: profile.userAgent ?? userAgent ?? env.userAgent,
      };

      const useFull =
        process.env.RECAPTCHA_FULL_SIGNALS === "1" ||
        (vmRun.signalKeys?.length ?? 0) === 0;

      let signals =
        preCollectedSignals?.length > 0
          ? preCollectedSignals
          : useFull
            ? ExtendedCollectors.runAll(env, ctx, VmRustCatalog.allSignalKeys())
            : Collectors.runAll(env, ctx);

      if (!useFull) {
        const keyMap = VmSignalMapper.mapCollectorKeys({
          vmAnalysis: vmRun.vmAnalysis,
          collectorIndexes: anchor?.config?.collectorIndexes,
        });
        signals = VmSignalMapper.applyKeysToSignals(signals, keyMap);
      }

      const sessionSeed = `${profile.id}:${anchorToken.slice(0, 48)}:${liveKey}`;

      const streamBody = EnterpriseSignalStream.encodeSignals(signals, liveKey, sessionSeed);
      let blobInner = EnterpriseSignalStream.wrapAsField6(streamBody);

      const fpSerialized = FingerprintArrayBuilder.serialize(
        FingerprintArrayBuilder.build(env, ctx),
      );
      blobInner = Buffer.concat([
        blobInner,
        EnterpriseBlobEncoder.encodeFingerprintPayload(fpSerialized, liveKey),
      ]);

      const telemetryInner = TelemetryBuilder.build({ version });
      const eventsInner = EventCounterBuilder.build(eventCounts);
      let encryptedBlob = EnterpriseBlobEncoder.patchBlobSegments(blobInner, {
        telemetry: telemetryInner,
        events: eventsInner,
        siteKey,
        action,
      });
      if (!Buffer.isBuffer(encryptedBlob)) {
        encryptedBlob = InnerBlobPatcher.patch(
          Buffer.isBuffer(blobInner) ? blobInner : Buffer.from(blobInner),
          { telemetry: telemetryInner, events: eventsInner, siteKey, action },
        );
      }

      const send05 =
        secondaryToken ??
        vmRun.token05AL ??
        vmRun.sends.find((s) => /^05AL[A-Za-z0-9_-]{100,}/.test(String(s)))?.slice(0, 1276) ??
        vmRun.sends.find((s) => String(s).length > 200) ??
        SecondaryTokenGenerator.generate({
          anchorToken,
          encryptionKey: liveKey,
          configBytecode: configBytecode ?? anchor?.configBytecode,
          vmBytecodeKeys: vmBytecodeKeys ?? anchor?.config?.vmBytecodeKeys,
        });

      const f7 = F7Assembler.build({
        secondaryToken: send05,
        action,
        siteKey,
        encryptedBlob,
      });

      const fingerprintHash = String(
        ReloadStructure.hashFingerprintSerialized(f7.toString("latin1")),
      );

      const field20 = FlatTelemetryBuilder.build({
        env,
        referer: ctx.referer,
        collectionElapsedMs: Math.round(env.window.performance.now() % 900) + 400,
      });
      const field21 =
        auxToken ??
        AuxTokenGenerator.generate({
          anchorToken,
          encryptionKey: liveKey,
          secondaryToken: send05,
        });
      const field22 = BinaryPayloadBuilder.build(env, {
        encryptionKey: liveKey,
        version,
        siteKey,
      });
      const field25 = EventCounterBuilder.buildFlat(eventCounts);

      log(
        "Reload pur",
        `${signals.length} signaux LCG | f7=${f7.length}b | 16=${encryptedBlob.length}b | profil=${profile.id}`,
      );

      const body = Buffer.concat([
        ProtobufWire.writeString(1, version),
        ProtobufWire.writeBytes(2, Buffer.from(anchorToken, "utf8")),
        ProtobufWire.writeString(5, fingerprintHash),
        ProtobufWire.writeString(6, challengeType),
        ProtobufWire.writeBytes(7, f7),
        ProtobufWire.writeString(8, action),
        ProtobufWire.writeString(14, siteKey),
        ProtobufWire.writeBytes(16, encryptedBlob),
        ProtobufWire.writeString(20, field20),
        ProtobufWire.writeString(21, field21),
        ProtobufWire.writeString(22, field22),
        ProtobufWire.writeString(25, field25),
        ProtobufWire.writeInt32(28, Number(anchorMs) || 20000),
        ProtobufWire.writeInt32(29, Number(executeMs) || 30000),
      ]);

      const secondarySource = chromeCapture?.last05AL
        ? "chrome-capture-05AL"
        : vmRun.token05AL &&
            vmRun.sends?.some((s) => /^05AL[A-Za-z0-9_-]{100,}/.test(String(s)))
          ? "vm-send-05AL"
          : vmRun.token05AL
            ? "vm-send-05AL"
            : vmRun.sends?.some((s) => String(s).length > 200)
              ? "vm-send-long"
              : "derived-05AL";

      const out = {
        body,
        reloadBytes: body.length,
        strategy: "dynamic-pure",
        secondarySource,
        profileId: profile.id,
        fingerprintSeed: freshProfile._seed,
        vmAnalysis: vmRun.vmAnalysis,
        encryptionKey: liveKey,
        signalCount: signals.length,
        token05AL: send05?.slice?.(0, 80),
      };

      const dumpPath = saveNativeSessionDump(
        {
        source: "dynamic-pure",
        profileId: profile.id,
        fingerprintSeed: freshProfile._seed,
        secondarySource,
        signalCount: signals.length,
        reloadBytes: body.length,
        encryptionKey: liveKey,
        sends: vmRun.sends?.filter((s) => String(s).startsWith("05AL")) ?? [],
        last05AL:
          typeof send05 === "string" && send05.startsWith("05AL")
            ? send05.slice(0, 1276)
            : null,
        bytecodes: env.window?.___vmDump?.bytecodes ?? [],
        vmDump: env.window?.___vmDump ?? null,
      },
        { autoDump },
      );
      if (dumpPath) log("Session dump", dumpPath);

      return out;
    } finally {
      env.close?.();
    }
  }
}
