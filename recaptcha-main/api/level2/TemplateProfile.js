import { readFileSync } from "node:fs";
import { ReloadStructure } from "./ReloadStructure.js";
import { InnerBlobPatcher } from "./InnerBlobPatcher.js";
import { ProtobufWire } from "../ProtobufWire.js";

/** Extrait la structure empreinte TM depuis un reload.bin capturé. */
export class TemplateProfile {
  static load(templatePath) {
    const field2 = ReloadStructure.readTemplateField2(templatePath);
    const { anchor, suffix } = ReloadStructure.splitField2(field2);
    const parsed = ReloadStructure.parseSuffix(suffix);
    const loginAt = parsed.f7.indexOf(Buffer.from([0x42, 0x05]));
    if (loginAt < 0) throw new Error("profil template: protobuf login introuvable dans f7");

    const secondaryToken = parsed.f7.subarray(0, loginAt).toString("utf8");
    const innerProto = parsed.f7.subarray(loginAt);
    const innerFields = ProtobufWire.decodeMessage(innerProto);
    const action = innerFields.find((f) => f.fieldNumber === 8)?.value?.toString("utf8") ?? "login";
    const siteKey =
      innerFields.find((f) => f.fieldNumber === 14)?.value?.toString("utf8") ?? null;
    const encryptedBlob =
      innerFields.find((f) => f.fieldNumber === 2088)?.value ??
      innerFields.find((f) => f.wireType === 2 && f.value.length > 1000)?.value;

    if (!encryptedBlob) throw new Error("profil template: blob chiffré introuvable");

    const segments = InnerBlobPatcher.extractSegments(encryptedBlob);

    return {
      templatePath,
      anchorLength: anchor.length,
      anchorPrefix: anchor.slice(0, 32),
      secondaryToken,
      secondaryTokenLength: secondaryToken.length,
      challengeType: parsed.challengeType,
      f5HashSample: parsed.f5Hash,
      action,
      siteKey,
      encryptedBlob,
      segments,
      innerProto,
    };
  }

  static readOrNull(templatePath) {
    try {
      return TemplateProfile.load(templatePath);
    } catch {
      return null;
    }
  }
}
