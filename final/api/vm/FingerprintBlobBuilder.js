import { SignalEncryptor } from "../level2/SignalEncryptor.js";
import { InnerBlobPatcher } from "../level2/InnerBlobPatcher.js";
import { VmHttpSolver } from "../level2/VmHttpSolver.js";

/**
 * Re-chiffre les signaux connus dans le blob template pour la clé anchor live.
 * En attendant l'interpréteur VM complet (opcode SEND).
 */
export class FingerprintBlobBuilder {
  static rebuild(templateBlob, { encryptionKey, signals, ctx = {} }) {
    const templateKey = VmHttpSolver.loadTemplateSessionKey();
    let buf = Buffer.from(templateBlob);

    if (templateKey && encryptionKey && templateKey !== encryptionKey) {
      buf = VmHttpSolver.rebindEncryptedBlob(buf, {
        templateKey,
        liveKey: encryptionKey,
        ctx,
      });
    }

    buf = FingerprintBlobBuilder.#injectSignals(buf, encryptionKey, signals);
    return InnerBlobPatcher.patch(buf, ctx);
  }

  static #injectSignals(buf, encryptionKey, signals) {
    if (!encryptionKey || !signals?.length) return buf;

    const candidates = VmHttpSolver.findEncryptedCandidates(buf);

    for (const { signalKey, plaintext } of signals) {
      const reenc = SignalEncryptor.encrypt(plaintext, encryptionKey, signalKey);
      for (const cand of candidates) {
        const dec = SignalEncryptor.decrypt(cand.bytes, encryptionKey, signalKey);
        if (!dec || dec.length < 4) continue;
        if (
          dec.includes(plaintext.slice(0, 24)) ||
          (plaintext.includes("Mozilla") && dec.includes("Mozilla"))
        ) {
          if (reenc.length === cand.bytes.length) {
            buf = Buffer.concat([
              buf.subarray(0, cand.offset),
              reenc,
              buf.subarray(cand.offset + cand.bytes.length),
            ]);
          }
          break;
        }
      }
    }
    return buf;
  }
}
