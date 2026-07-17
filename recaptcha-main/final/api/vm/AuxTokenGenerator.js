import { createHash, randomFillSync } from "node:crypto";

/** Champ 21 — token 0aAL… (captcha précédent / session). */
export class AuxTokenGenerator {
  static TARGET_LEN = 73;

  static generate({ anchorToken, encryptionKey, secondaryToken = null }) {
    if (secondaryToken?.startsWith("0aAL") && secondaryToken.length >= 40) {
      return AuxTokenGenerator.#pad(secondaryToken);
    }

    const seed = createHash("sha256")
      .update("0aAL")
      .update(String(anchorToken))
      .update(String(encryptionKey))
      .digest();

    let out = "0aAL";
    let i = 0;
    while (out.length < AuxTokenGenerator.TARGET_LEN) {
      out += AuxTokenGenerator.#B64URL[(seed[i % seed.length] ^ (i * 7)) % 64];
      i++;
    }
    return out.slice(0, AuxTokenGenerator.TARGET_LEN);
  }

  static #B64URL =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

  static #pad(token) {
    if (token.length === AuxTokenGenerator.TARGET_LEN) return token;
    if (token.length > AuxTokenGenerator.TARGET_LEN) {
      return token.slice(0, AuxTokenGenerator.TARGET_LEN);
    }
    const buf = Buffer.alloc(AuxTokenGenerator.TARGET_LEN - token.length);
    randomFillSync(buf);
    let extra = "";
    for (const b of buf) extra += AuxTokenGenerator.#B64URL[b % 64];
    return token + extra;
  }
}
