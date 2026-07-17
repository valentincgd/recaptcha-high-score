import { HashUtil } from "../HashUtil.js";
import { Collectors } from "./Collectors.js";
import { VmRustCatalog } from "./VmRustCatalog.js";

/**
 * Collecte étendue : une entrée par signalKey VM connue (catalogue Rust).
 */
export class ExtendedCollectors {
  static runAll(env, ctx = {}, signalKeys = null) {
    const base = Collectors.runAll(env, ctx);
    const byKey = new Map(base.map((s) => [s.signalKey, s]));
    const keys = signalKeys ?? VmRustCatalog.allSignalKeys();
    const window = env?.window ?? env;
    const t0 = window?.performance?.now?.() ?? 0;

    for (const signalKey of keys) {
      if (byKey.has(signalKey)) continue;
      const plaintext = ExtendedCollectors.#syntheticForKey(signalKey, env, ctx);
      if (!plaintext) continue;
      byKey.set(signalKey, {
        signalKey,
        plaintext,
        elapsed: Math.round((window?.performance?.now?.() ?? t0) - t0 + 10 + (signalKey % 50)),
      });
    }

    return [...byKey.values()];
  }

  static #syntheticForKey(signalKey, env, ctx) {
    const w = env?.window ?? env;
    const origin = ctx.origin ?? env?.origin ?? w?.location?.origin;
    const siteKey = ctx.siteKey ?? "";

    const table = {
      41: () => JSON.stringify([w?.navigator?.platform ?? "Win32"]),
      43: () => String(w?.devicePixelRatio ?? 1),
      545: () => `"${origin}/"`,
      549: () => (w?.document ?? env?.document)?.cookie || "",
      614: () => String(w?.outerWidth ?? w?.innerWidth ?? 0),
      619: () => String(HashUtil.hashString(ctx.userAgent ?? w?.navigator?.userAgent ?? "")),
      659: () => JSON.stringify([w?.navigator?.language ?? "fr-FR"]),
      727: () => String(w?.screen?.width ?? w?.innerWidth ?? 0),
      779: () => String(w?.screen?.height ?? w?.innerHeight ?? 0),
      895: () => JSON.stringify(w?.navigator?.languages ?? ["fr-FR"]),
      959: () => Collectors.webglPayload(w?.document ?? env?.document),
      1019: () => String(w?.hardwareConcurrency ?? 8),
      1092: () => `"${ctx.referer ?? env?.referer ?? origin}/"`,
      1313: () => "false",
      1994: () => String(w?.localStorage?.length ?? 0),
      2033: () => `"-1"`,
    };

    if (table[signalKey]) return table[signalKey]();

    const h = HashUtil.hashString(`${signalKey}:${origin}:${siteKey}`) >>> 0;
    return JSON.stringify([h % 1000, (h >> 8) % 1000]);
  }
}
