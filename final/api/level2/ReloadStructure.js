import { readFileSync } from "node:fs";
import { ProtobufWire } from "../ProtobufWire.js";
import { HashUtil } from "../HashUtil.js";

const ANCHOR_RE = /^03AFcWeA[A-Za-z0-9_-]+/;

/** Parse / reconstruit la structure field2 découverte dans les captures TM. */
export class ReloadStructure {
  static splitField2(field2Buf) {
    const utf8 = field2Buf.toString("latin1");
    const anchor = utf8.match(ANCHOR_RE)?.[0];
    if (!anchor) throw new Error("anchor introuvable dans le template field2");
    return {
      anchor,
      suffix: field2Buf.subarray(anchor.length),
    };
  }

  static readTemplateField2(templatePath) {
    const fields = ProtobufWire.decodeMessage(readFileSync(templatePath));
    const f2 = fields.find((f) => f.fieldNumber === 2 && f.wireType === 2);
    if (!f2) throw new Error("template sans champ 2");
    return f2.value;
  }

  static parseSuffix(suffixBuf) {
    const outer = ProtobufWire.decodeMessage(suffixBuf);
    const f5 = outer.find((f) => f.fieldNumber === 5)?.value?.toString("utf8");
    const f6 = outer.find((f) => f.fieldNumber === 6)?.value?.toString("utf8");
    const f7 = outer.find((f) => f.fieldNumber === 7)?.value;
    if (!f7) throw new Error("suffix sans champ 7");
    return { f5Hash: f5, challengeType: f6 ?? "q", f7 };
  }

  static buildSuffix({ f5Hash, challengeType, f7 }) {
    return Buffer.concat([
      ProtobufWire.writeString(5, f5Hash),
      ProtobufWire.writeString(6, challengeType),
      ProtobufWire.writeBytes(7, f7),
    ]);
  }

  static buildTopLevel({ version, anchorToken, suffix }) {
    return Buffer.concat([
      ProtobufWire.writeString(1, version),
      ProtobufWire.writeBytes(2, Buffer.concat([Buffer.from(anchorToken, "utf8"), suffix])),
    ]);
  }

  static hashFingerprintSerialized(serialized) {
    return String(HashUtil.hashString(serialized));
  }
}
