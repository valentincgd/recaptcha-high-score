import { VmDisassembler } from "./VmDisassembler.js";
import { VmValue } from "./VmValue.js";
import { bytesToVmPayload } from "./VmLcgScramble.js";
import { SignalEncryptor } from "../level2/SignalEncryptor.js";

/**
 * Complète les SEND manquants en rejouant les registres de l'exécuteur
 * et en synthétisant un buffer LCG si le registre « blob » est vide.
 */
export class VmSendCollector {
  static collect(ex, mainBytecode, { minPayloadLen = 24, encryptionKey = 0, signals = [] } = {}) {
    const dis = new VmDisassembler(mainBytecode);
    dis.dispatch();
    const sends = [...(ex.sends ?? [])];
    const seen = new Set(sends);
    const plainByKey = new Map(
      (signals ?? []).map((s) => [Number(s.signalKey), String(s.plaintext ?? "")]),
    );
    const sessionSeed = `vm-send:${encryptionKey}`;
    let sendIdx = 0;

    for (const ins of dis.instructions) {
      if (ins.op !== "SEND" || !ins.registers?.length) continue;
      const blobReg = ins.registers[1] ?? ins.registers[0];
      let v = ex.registers.get(blobReg);
      let payload = "";
      if (v?.kind === "bytes" && v.data.length >= minPayloadLen) {
        payload = bytesToVmPayload(v.data);
      } else if (v?.kind === "codepoints" && v.arr.length >= minPayloadLen) {
        payload = bytesToVmPayload(Uint8Array.from(v.arr, (n) => n & 0xff));
      } else {
        const s = VmValue.asString(v ?? VmValue.Undefined(), ex.registers);
        if (s.length >= minPayloadLen) payload = s;
      }
      if (payload.length < minPayloadLen) {
        const keyReg = ins.registers[0];
        const signalKey =
          VmValue.asNumber(ex.registers.get(keyReg) ?? VmValue.Integer(417), ex.registers) ||
          417;
        const fallbackPlain = [...plainByKey.values()].sort((a, b) => b.length - a.length)[0];
        const plain =
          plainByKey.get(signalKey) ||
          plainByKey.get(Number(signalKey)) ||
          fallbackPlain ||
          `signal:${signalKey}`;
        const enc = SignalEncryptor.encryptForSession(
          plain,
          encryptionKey,
          signalKey,
          sessionSeed,
          sendIdx++,
        );
        payload = bytesToVmPayload(enc);
      }
      if (payload.length >= minPayloadLen) {
        if (!seen.has(payload)) seen.add(payload);
        sends.push(payload);
      }
    }
    return sends;
  }
}
