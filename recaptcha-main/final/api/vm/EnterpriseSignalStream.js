import { ProtobufWire } from "../ProtobufWire.js";
import { SignalEncryptor } from "../level2/SignalEncryptor.js";

const CHUNK_TAG = 0x62;

/**
 * Flux binaire champ 16 / f2088 : chunks 0x62 + uint16 LE + ciphertext LCG.
 */
export class EnterpriseSignalStream {
  static encodeSignals(signals, encryptionKey, sessionSeed = "") {
    const chunks = [];
    for (let i = 0; i < signals.length; i++) {
      const { plaintext, signalKey } = signals[i];
      const enc = SignalEncryptor.encryptForSession(
        plaintext,
        encryptionKey,
        signalKey,
        sessionSeed,
        i,
      );
      chunks.push(EnterpriseSignalStream.#wrapChunk(enc));
    }
    return Buffer.concat(chunks);
  }

  static #wrapChunk(encrypted) {
    const len = encrypted.length;
    return Buffer.concat([
      Buffer.from([CHUNK_TAG]),
      Buffer.from([len & 0xff, (len >> 8) & 0xff]),
      encrypted,
    ]);
  }

  static wrapAsField6(bodyBuf) {
    const b64 = EnterpriseSignalStream.#customB64(bodyBuf);
    return ProtobufWire.writeString(6, b64);
  }

  static #customB64(buf) {
    const B64 =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.";
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
