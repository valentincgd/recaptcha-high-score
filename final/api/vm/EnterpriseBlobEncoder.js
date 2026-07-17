import { randomBytes } from "node:crypto";
import { ProtobufWire } from "../ProtobufWire.js";
import { SignalEncryptor } from "../level2/SignalEncryptor.js";
import { InnerBlobPatcher } from "../level2/InnerBlobPatcher.js";
import { decodeBase64Custom } from "./BytecodeDecoder.js";

const B64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.";

/**
 * Encode le payload empreinte pour le champ protobuf f2088 (wrapper f6 string).
 */
export class EnterpriseBlobEncoder {
  static encodeFingerprintPayload(serializedJson, encryptionKey) {
    const key = Number(encryptionKey) | 0;
    const master = SignalEncryptor.encrypt(serializedJson, key, 73);
    const body = Buffer.concat([master, randomBytes(32)]);
    const b64 = EnterpriseBlobEncoder.#encodeCustomBase64(body);
    const inner = Buffer.concat([ProtobufWire.writeString(6, b64)]);
    return inner;
  }

  static encodeFromEncryptedChunks(encSignals) {
    const chunks = [];
    for (const { encrypted } of encSignals) {
      const tag = Buffer.from([0x62]);
      const len = Buffer.from([encrypted.length & 0xff, (encrypted.length >> 8) & 0xff]);
      chunks.push(tag, len, encrypted);
    }
    const body = Buffer.concat(chunks);
    const b64 = EnterpriseBlobEncoder.#encodeCustomBase64(body);
    return ProtobufWire.writeString(6, b64);
  }

  static encodeFromSignals(signals, encryptionKey) {
    const chunks = [];
    for (const { plaintext, signalKey } of signals) {
      const enc = SignalEncryptor.encrypt(plaintext, encryptionKey, signalKey);
      const tag = Buffer.from([0x62]);
      const len = Buffer.from([enc.length & 0xff, (enc.length >> 8) & 0xff]);
      chunks.push(tag, len, enc);
    }
    const body = Buffer.concat(chunks);
    const b64 = EnterpriseBlobEncoder.#encodeCustomBase64(body);
    return ProtobufWire.writeString(6, b64);
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

  static decodeCustomBase64(s) {
    return decodeBase64Custom(s, 6);
  }

  static patchBlobSegments(blobInnerBuf, opts) {
    const fields = ProtobufWire.decodeMessage(blobInnerBuf);
    const f6 = fields.find((f) => f.fieldNumber === 6 && f.wireType === 2);
    if (!f6) return blobInnerBuf;

    let s = f6.value.toString("latin1");
    if (opts.telemetry && !s.includes("tbMy")) s += opts.telemetry;
    if (opts.events && !s.includes("W1tb")) s += opts.events;

    const patched = InnerBlobPatcher.patch(Buffer.from(s, "latin1"), opts);
    return ProtobufWire.writeString(6, patched.toString("latin1"));
  }
}
