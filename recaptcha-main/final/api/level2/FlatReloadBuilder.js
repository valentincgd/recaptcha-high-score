import { readFileSync } from "node:fs";
import { ProtobufWire } from "../ProtobufWire.js";
import { ReloadBuilder } from "../ReloadBuilder.js";
import { VmHttpSolver } from "./VmHttpSolver.js";
import { Collectors } from "../vm/Collectors.js";
import { BrowserEnvironment } from "../vm/BrowserEnvironment.js";
import { FingerprintBlobBuilder } from "../vm/FingerprintBlobBuilder.js";

/**
 * reload.bin « plat » TM : champs 2=anchor, 8=action, 14=siteKey, 16=blob empreinte.
 */
export class FlatReloadBuilder {
  static isFlatFormat(templatePath) {
    try {
      const fields = ProtobufWire.decodeMessage(readFileSync(templatePath));
      return fields.some((f) => f.fieldNumber === 14 && f.wireType === 2);
    } catch {
      return false;
    }
  }

  static loadProfile(templatePath) {
    const fields = ProtobufWire.decodeMessage(readFileSync(templatePath));
    const encryptedBlob =
      fields.find((f) => f.fieldNumber === 16 && f.wireType === 2)?.value ??
      fields
        .filter((f) => f.wireType === 2 && f.fieldNumber !== 2)
        .sort((a, b) => b.value.length - a.value.length)[0]?.value;

    if (!encryptedBlob) throw new Error("flat reload: champ 16 (blob) introuvable");

    return {
      fields,
      action:
        fields.find((f) => f.fieldNumber === 8)?.value?.toString("utf8") ?? "login",
      siteKey:
        fields.find((f) => f.fieldNumber === 14)?.value?.toString("utf8") ?? null,
      encryptedBlob,
    };
  }

  static #writeField(parts, f) {
    if (f.wireType === 0) parts.push(ProtobufWire.writeInt32(f.fieldNumber, f.value));
    else if (f.wireType === 2) parts.push(ProtobufWire.writeBytes(f.fieldNumber, f.value));
  }

  static build({
    templatePath,
    version,
    anchorToken,
    siteKey,
    action,
    encryptionKey = null,
    userAgent = null,
    referer = null,
    mode = "enterprise",
  }) {
    const captureMode = ReloadBuilder.getTemplateCaptureMode(templatePath);
    if (captureMode && mode && captureMode !== mode) {
      throw new Error(
        `template capturé en ${captureMode} — requête ${mode} : capture réelle requise (npm run capture:reload-api2)`,
      );
    }

    const profile = FlatReloadBuilder.loadProfile(templatePath);
    const sk = siteKey ?? profile.siteKey;
    const act = action ?? profile.action;
    const origin = referer?.replace(/\/$/, "") ?? "https://auth.ticketmaster.com";

    const env = new BrowserEnvironment({ userAgent, referer, origin });
    const signals = Collectors.runAll(env, {
      siteKey: sk,
      referer,
      userAgent,
      origin,
    });

    let blob = FingerprintBlobBuilder.rebuild(profile.encryptedBlob, {
      encryptionKey,
      signals,
      ctx: { userAgent, referer, siteKey: sk, action: act, origin },
    });

    const parts = [];
    for (const f of profile.fields) {
      if (f.fieldNumber === 1 && f.wireType === 2) {
        parts.push(ProtobufWire.writeString(1, version));
      } else if (f.fieldNumber === 2 && f.wireType === 2) {
        parts.push(ProtobufWire.writeBytes(2, Buffer.from(anchorToken, "utf8")));
      } else if (f.fieldNumber === 8 && f.wireType === 2) {
        parts.push(ProtobufWire.writeString(8, act));
      } else if (f.fieldNumber === 14 && f.wireType === 2) {
        parts.push(ProtobufWire.writeString(14, sk));
      } else if (f.fieldNumber === 16 && f.wireType === 2) {
        parts.push(ProtobufWire.writeBytes(16, blob));
      } else {
        FlatReloadBuilder.#writeField(parts, f);
      }
    }

    return Buffer.concat(parts);
  }
}
