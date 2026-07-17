import { VmDisassembler } from "./VmDisassembler.js";

/** Score un inner bytecode (évite de choisir un « meilleur » decrypt qui est du bruit). */
export function scoreInnerBytecode(inner) {
  if (!inner?.length || inner.length < 64) return 0;
  try {
    const dis = new VmDisassembler(inner);
    try {
      dis.dispatch();
    } catch {
      /* analyse partielle */
    }
    if (!dis.instructions.length) return 0;
    let score = 0;
    for (const ins of dis.instructions) {
      if (ins.op === "ERROR") return 0;
      if (String(ins.op).startsWith("OP_")) continue;
      score += 1;
    }
    if (score < 3) return 0;
    return score + Math.min(inner.length / 500, 40);
  } catch {
    return 0;
  }
}
