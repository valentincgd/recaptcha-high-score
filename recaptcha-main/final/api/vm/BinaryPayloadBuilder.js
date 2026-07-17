import { randomBytes } from "node:crypto";
import { ProtobufWire } from "../ProtobufWire.js";
import { BrowserObjectsHasher } from "../level2/BrowserObjectsHasher.js";
import { EnterpriseBlobEncoder } from "./EnterpriseBlobEncoder.js";

const B64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.";

/**
 * Champ 22 — BDA… (base64 custom des hashes objets navigateur + métadonnées session).
 */
export class BinaryPayloadBuilder {
  static build(env, { encryptionKey, version, siteKey }) {
    const hashes = BrowserObjectsHasher.collect(env.window);
    const body = Buffer.concat([
      Buffer.from([0x04, 0x30, 0x00, 0x6c, 0x06]),
      ProtobufWire.writeString(1, version ?? ""),
      ProtobufWire.writeString(2, siteKey ?? ""),
      ProtobufWire.writeBytes(3, Buffer.from(JSON.stringify(hashes), "utf8")),
      randomBytes(24),
    ]);

    let inner = body;
    if (encryptionKey != null) {
      const wrapped = EnterpriseBlobEncoder.encodeFingerprintPayload(
        JSON.stringify(hashes),
        encryptionKey,
      );
      inner = Buffer.concat([body, wrapped]);
    }

    return BinaryPayloadBuilder.#encodeCustomBase64(inner);
  }

  static #encodeCustomBase64(buf) {
    let out = "";
    let i = 0;
    while (i < buf.length) {
      const b0 = buf[i++] ?? 0;
      const b1 = buf[i++] ?? 0;
      const b2 = buf[i++] ?? 0;
      out += B64[b0 >> 2];
      out += B64[((b0 & 3) << 4) | (b1 >> 4)];
      out += B64[((b1 & 15) << 2) | (b2 >> 6)];
      out += B64[b2 & 63];
    }
    return out;
  }
}
