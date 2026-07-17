import { COLLECTOR_SIGNAL_KEYS } from "./VmSignalCatalog.js";
import { VmRustCatalog } from "./VmRustCatalog.js";

/** Ordre des collecteurs (aligné Collectors.runAll). */
export const COLLECTOR_ORDER = [
  "userAgent",
  "refererQuoted",
  "originSlash",
  "webgl",
  "innerWidth",
  "innerHeight",
  "originBare",
  "titleHash",
  "inputs",
  "cookie",
  "botFlag",
  "dpr",
  "siteKeyTag",
  "localStorage",
  "docReferrer",
  "scrollY",
  "platform",
  "languages",
];

/**
 * Associe clés signal VM (registres conf bytecode) aux collecteurs.
 */
export class VmSignalMapper {
  static mapCollectorKeys({ vmAnalysis, collectorIndexes }) {
    const bytecodeKeys = vmAnalysis?.signalKeys ?? [];
    const rustKeys = VmRustCatalog.allSignalKeys();
    const base = COLLECTOR_SIGNAL_KEYS.slice();

    if (bytecodeKeys.length > 0) return bytecodeKeys;
    if (process.env.RECAPTCHA_FULL_SIGNALS === "1") return rustKeys;

    if (Array.isArray(collectorIndexes) && collectorIndexes.length) {
      return VmSignalMapper.#permuteByIndexes(base, collectorIndexes);
    }

    return base;
  }

  static #permuteByIndexes(keys, indexes) {
    const out = [];
    for (let i = 0; i < keys.length; i++) {
      const idx = Number(indexes[i % indexes.length]) | 0;
      out.push(keys[idx % keys.length] ?? keys[i]);
    }
    return out.length ? out : keys;
  }

  static applyKeysToSignals(signals, keyMap) {
    return signals.map((s, i) => ({
      ...s,
      signalKey: keyMap[i] ?? s.signalKey,
    }));
  }
}
