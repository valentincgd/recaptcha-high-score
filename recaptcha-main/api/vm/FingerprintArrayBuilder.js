import { Collectors } from "./Collectors.js";
import { SignalDerivation } from "./SignalDerivation.js";

/** Construit le tableau empreinte style fp1.json — 100 % en mémoire. */
export class FingerprintArrayBuilder {
  static build(env, ctx = {}) {
    const signals = Collectors.runAll(env, ctx);
    const entries = [];
    const chain = [];

    for (const { plaintext, signalKey, elapsed } of signals) {
      const code = SignalDerivation.deriveSignalCode(plaintext);
      const derivedKey = SignalDerivation.deriveKey(code);
      const enc = SignalDerivation.encryptValueWithKey(derivedKey, plaintext);
      chain.push([1, code]);
      entries.push([enc, signalKey, elapsed]);
    }

    return [
      [chain],
      String(entries.length),
      ...entries,
      null,
      null,
      [ctx.siteKey ? `${ctx.siteKey}6d` : "", 4, 0],
    ];
  }

  static serialize(array) {
    return JSON.stringify(array);
  }
}
