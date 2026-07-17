import { decryptConfigWithKeyCandidates } from "./VmBytecodeKeys.js";
import { scoreInnerBytecode } from "./VmBytecodeValidator.js";

/** Trouve le meilleur blob config VM dans init (bgdata[4] ≫ conf[23]). */
export function resolveConfigBytecode(anchor) {
  const keys = anchor.config?.vmBytecodeKeys ?? [[176, 170, 107], [76]];
  const candidates = new Set();
  if (anchor.configBytecode) candidates.add(anchor.configBytecode);

  const visit = (x) => {
    if (typeof x === "string" && x.length > 100 && x.length < 80_000) {
      candidates.add(x);
    } else if (Array.isArray(x)) {
      for (const v of x) visit(v);
    }
  };
  visit(anchor.initPayload);

  let best = null;
  for (const raw of candidates) {
    try {
      const entry = decryptConfigWithKeyCandidates(raw, keys);
      const score = entry.quality ?? scoreInnerBytecode(entry.inner);
      if (!best || score > best.score) {
        best = { raw, ...entry, score };
      }
    } catch {
      /* ignore */
    }
  }
  return best;
}
