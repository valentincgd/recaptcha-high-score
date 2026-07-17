import { VmInterpreter } from "./VmInterpreter.js";
import { VmMainBytecodeResolver } from "./VmMainBytecodeResolver.js";

const RE_05AL = /05AL[A-Za-z0-9_-]{200,1276}/;

/** Fusionne ___vmDump + corps POST /reload → analyse VM utilisable par le flat builder. */
export class VmRuntimeCapture {
  static extract05AL(text) {
    if (!text) return null;
    const s = Buffer.isBuffer(text) ? text.toString("latin1") : String(text);
    const m = s.match(RE_05AL);
    return m?.[0]?.slice(0, 1276) ?? null;
  }

  static mergeAnalysis({
    vmAnalysis = null,
    vmDump = null,
    reloadBody = null,
    configBytecode = null,
    vmBytecodeKeys = null,
    encryptionKey = null,
  }) {
    const out = {
      ...(vmAnalysis ?? {}),
      sends: [...(vmAnalysis?.sends ?? [])],
      errors: [...(vmAnalysis?.errors ?? [])],
    };

    const fromReload = VmRuntimeCapture.extract05AL(reloadBody);
    if (fromReload) out.sends.push(fromReload);

    for (const s of vmDump?.sends ?? []) {
      if (s && !out.sends.includes(s)) out.sends.push(s);
    }
    if (vmDump?.last05AL && !out.sends.includes(vmDump.last05AL)) {
      out.sends.push(vmDump.last05AL);
    }

    if (
      (!out.instructions?.length || out.innerBytecodeLen < 500) &&
      configBytecode &&
      vmBytecodeKeys?.length
    ) {
      try {
        const fresh = VmInterpreter.analyzeAnchorConfig(
          configBytecode,
          vmBytecodeKeys,
          encryptionKey,
        );
        if ((fresh.innerBytecodeLen ?? 0) > (out.innerBytecodeLen ?? 0)) {
          Object.assign(out, fresh);
          out.sends = [...new Set([...(out.sends ?? []), ...(fresh.sends ?? [])])];
        }
      } catch (err) {
        out.errors.push(err.message);
      }
    }

    const mainPick = VmMainBytecodeResolver.resolve({
      vmDump,
      vmBytecodeKeys,
      configBytecode,
    });
    if (mainPick.bytecode?.length) {
      out.mainBytecodeSource = mainPick.source;
      out.mainBytecodeLen = mainPick.bytecode.length;
    }

    out.token05AL =
      out.sends?.find((s) => String(s).startsWith("05AL")) ?? fromReload ?? null;

    return out;
  }
}
