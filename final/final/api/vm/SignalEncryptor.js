import { createHash } from "node:crypto";

/** Port de recaptcha-vm/src/encryption/mod.rs (LCG stream cipher). */
const LCG_MODULUS = 94906238;
const LCG_MULTIPLIER = 13558035;
const LCG_INCREMENT = 13037;
const GOLDEN_RATIO = 2654435761n;

function toI32(n) {
  return Number(n) | 0;
}

function normalizeSeed(seed) {
  const s = toI32(seed);
  return ((s % LCG_MODULUS) + LCG_MODULUS) % LCG_MODULUS;
}

function nextLcg(seed) {
  return Number(
    (BigInt(toI32(seed)) * BigInt(LCG_MULTIPLIER) + BigInt(LCG_INCREMENT)) %
      BigInt(LCG_MODULUS),
  );
}

function serializeRuntimeSeed(runtimeSeed) {
  return Buffer.from([
    (runtimeSeed >> 24) & 0xff,
    (runtimeSeed >> 16) & 0xff,
    (runtimeSeed >> 8) & 0xff,
    runtimeSeed & 0xff,
  ]);
}

export class SignalEncryptor {
  /** Même algorithme que encrypt(), mais graine LCG dérivée de la session + profil (reproductible). */
  static encryptForSession(
    plaintext,
    encryptionKey,
    signalKey,
    sessionSeed = "",
    signalIndex = 0,
  ) {
    const ts = SignalEncryptor.#deriveTs(sessionSeed, encryptionKey, signalKey, signalIndex);
    return SignalEncryptor.encrypt(plaintext, encryptionKey, signalKey, ts);
  }

  static #deriveTs(sessionSeed, encryptionKey, signalKey, signalIndex) {
    const h = createHash("sha256")
      .update("recaptcha-signal-v1")
      .update(String(sessionSeed))
      .update(String(encryptionKey))
      .update(String(signalKey))
      .update(String(signalIndex))
      .digest();
    return h.readUInt32LE(0) >>> 0;
  }

  static encrypt(plaintext, encryptionKey, signalKey, runtimeSeed = null) {
    const encKey = toI32(encryptionKey);
    const sigKey = toI32(signalKey);
    const ts =
      runtimeSeed ??
      Number((BigInt(Math.floor(Math.random() * 0x7fffffff)) + 939n) & 0xffffffffn);
    const runtime = (((ts + 939) >>> 0) * Number(GOLDEN_RATIO)) | 0;
    const initial = runtime ^ (encKey ^ sigKey);
    const bytes = Buffer.from(plaintext, "utf8");

    if (bytes.length === 0) {
      return serializeRuntimeSeed(runtime);
    }

    let seed = normalizeSeed(initial);
    seed = nextLcg(seed);
    const out = Buffer.from(bytes);
    out[0] = ((out[0] + seed) % 256) & 0xff;

    for (let i = 1; i < out.length; i++) {
      seed = nextLcg(seed);
      out[i] = ((out[i] + seed) % 256) & 0xff;
    }

    return Buffer.concat([out, serializeRuntimeSeed(runtime)]);
  }

  /** Déchiffre un payload signal (port de decrypt_signal_payload Rust). */
  static decrypt(encryptedData, encryptionKey, signalKey) {
    const buf = Buffer.isBuffer(encryptedData)
      ? encryptedData
      : Buffer.from(encryptedData);
    if (buf.length < 4) return "";

    const runtimeSeed = toI32(
      ((buf[buf.length - 4] << 24) |
        (buf[buf.length - 3] << 16) |
        (buf[buf.length - 2] << 8) |
        buf[buf.length - 1]) >>>
        0,
    );
    const initialSeed = runtimeSeed ^ (toI32(encryptionKey) ^ toI32(signalKey));
    const payload = buf.subarray(0, buf.length - 4);
    if (!payload.length) return "";

    let seed = normalizeSeed(initialSeed);
    seed = nextLcg(seed);
    const out = Buffer.from(payload);
    out[0] = ((out[0] - seed) % 256 + 256) % 256;

    for (let i = 1; i < out.length; i++) {
      seed = nextLcg(seed);
      out[i] = ((out[i] - seed) % 256 + 256) % 256;
    }

    return out.toString("utf8");
  }
}
