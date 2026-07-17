import { VmDisassembler } from "./VmDisassembler.js";
import { VmValue } from "./VmValue.js";

/** Prépare le registre attendu par le JE d'entrée du main (0x0). */
export class VmMainEntry {
  static prime(ex, mainBytecode) {
    const dis = new VmDisassembler(mainBytecode);
    dis.dispatch();
    const je = dis.instructions.find((i) => i.op === "JE" && i.offset === 0);
    if (!je?.lhs || !je?.rhs) return;

    const m = String(je.lhs).match(/^R(\d+)$/);
    if (!m) return;
    const reg = Number(m[1]);
    const cur = ex.registers.get(reg);
    const curStr = cur ? VmValue.asString(cur, ex.registers) : "";
    if (curStr === je.rhs) return;

    ex.setRegister(reg, VmValue.String(je.rhs));
  }
}
