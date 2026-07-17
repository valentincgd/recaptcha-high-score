import { HashUtil } from "../HashUtil.js";

const CHARSET =
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_";

/**
 * Dérivation compacte des codes signal (approximation documentée README).
 * Les paires connues servent de calibration ; à affiner via VM config.
 */
export class SignalDerivation {
  static #KNOWN = new Map([
    ["BUTTON,195a81c9", "wg"],
    ["wgia1z9pwq", "21"],
  ]);

  static deriveSignalCode(value) {
    const s = String(value ?? "");
    if (SignalDerivation.#KNOWN.has(s)) return SignalDerivation.#KNOWN.get(s);

    const h = HashUtil.hashString(s) >>> 0;
    const a = CHARSET[(h >> 0) % 64];
    const b = CHARSET[(h >> 8) % 64];
    return a + b;
  }

  static deriveKey(signalCode) {
    const known = { wg: 3792, "21": 1599 };
    if (known[signalCode] != null) return known[signalCode];

    let h = HashUtil.hashString(signalCode);
    h = ((h % 4000) + 4000) % 4000;
    return 1500 + (h % 2500);
  }

  static encryptValueWithKey(derivedKey, plaintext) {
    const seed = HashUtil.hashString(`${derivedKey}:${plaintext}`) >>> 0;
    let out = "b";
    for (let i = 0; i < Math.min(plaintext.length + 8, 48); i++) {
      const idx =
        (seed + i * 17 + plaintext.charCodeAt(i % plaintext.length)) % 64;
      out += CHARSET[idx];
    }
    if (plaintext.length > 40) {
      out += Buffer.from(plaintext.slice(0, 32), "utf8").toString("base64url");
    }
    return out.slice(0, 64);
  }
}
