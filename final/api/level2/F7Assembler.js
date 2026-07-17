import { ProtobufWire } from "../ProtobufWire.js";
import { InnerBlobPatcher } from "./InnerBlobPatcher.js";

/** Reconstruit le champ 7 (05AL + login + siteKey + blob empreinte). */
export class F7Assembler {
  static build({
    secondaryToken,
    action,
    siteKey,
    encryptedBlob,
    telemetry,
    events,
  }) {
    let blob = encryptedBlob;
    if (telemetry || events || siteKey || action) {
      blob = InnerBlobPatcher.patch(blob, { telemetry, events, siteKey, action });
    }

    const inner = Buffer.concat([
      ProtobufWire.writeString(8, action),
      ProtobufWire.writeString(14, siteKey),
      ProtobufWire.writeBytes(2088, blob),
    ]);

    return Buffer.concat([Buffer.from(secondaryToken, "utf8"), inner]);
  }
}
