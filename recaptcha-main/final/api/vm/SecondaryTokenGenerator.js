import { createHash, randomFillSync } from "node:crypto";
import { decryptConfigBytecode } from "./BytecodeDecoder.js";

/**
 * Génère le préfixe 05AL… (~1276 car.) sans template capturé.
 */
export class SecondaryTokenGenerator {
  static TARGET_LEN = 1276;

  static generate({ anchorToken, encryptionKey, configBytecode, vmBytecodeKeys }) {
    if (configBytecode && vmBytecodeKeys?.length >= 2) {
      try {
        const dec = decryptConfigBytecode(configBytecode, vmBytecodeKeys);
        const embedded = SecondaryTokenGenerator.#extract05AL(dec.toString("latin1"));
        if (embedded?.length >= 200) {
          return SecondaryTokenGenerator.#padToLength(embedded);
        }
      } catch {
        /* ignore */
      }
    }

    const seed = createHash("sha256")
      .update(String(anchorToken))
      .update(String(encryptionKey))
      .digest();

    let out = "05AL";
    let i = 0;
    while (out.length < SecondaryTokenGenerator.TARGET_LEN) {
      const b = seed[i % seed.length] ^ (i & 0xff);
      out += SecondaryTokenGenerator.#B64URL[b % 64];
      i++;
    }
    return out.slice(0, SecondaryTokenGenerator.TARGET_LEN);
  }

  static #B64URL =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

  static #extract05AL(text) {
    const m = text.match(/05AL[A-Za-z0-9_-]{100,}/);
    return m?.[0] ?? null;
  }

  static #padToLength(token) {
    if (token.length === SecondaryTokenGenerator.TARGET_LEN) return token;
    if (token.length > SecondaryTokenGenerator.TARGET_LEN) {
      return token.slice(0, SecondaryTokenGenerator.TARGET_LEN);
    }
    const buf = Buffer.alloc(SecondaryTokenGenerator.TARGET_LEN - token.length);
    randomFillSync(buf);
    let extra = "";
    for (const b of buf) extra += SecondaryTokenGenerator.#B64URL[b % 64];
    return token + extra;
  }
}
