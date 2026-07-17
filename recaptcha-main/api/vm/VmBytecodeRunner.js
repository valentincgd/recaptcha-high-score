import { createHash } from "node:crypto";
import { VmDisassembler } from "./VmDisassembler.js";
import { VmExecutor } from "./VmExecutor.js";
import { VmSendCollector } from "./VmSendCollector.js";
import { VmMainEntry } from "./VmMainEntry.js";
import { VmMainBytecodeResolver } from "./VmMainBytecodeResolver.js";
import { resolveConfigBytecode } from "./VmConfigBytecode.js";
import { VmInterpreter } from "./VmInterpreter.js";
import { Collectors } from "./Collectors.js";
import { installVmBytecodeCapture } from "./installVmBytecodeCapture.js";

const RE_05AL = /^05AL[A-Za-z0-9_-]{100,}/;

/**
 * Exécute / analyse le bytecode config anchor (reg 586, SEND, 05AL).
 */
export class VmBytecodeRunner {
  static analyze(anchor, encryptionKeyFallback = null, { env = null, vmDump = null } = {}) {
    const resolved = resolveConfigBytecode(anchor);
    const raw = resolved?.raw ?? anchor?.configBytecode;
    const keys = resolved?.keys ?? anchor?.config?.vmBytecodeKeys;

    const vmAnalysis = raw
      ? VmInterpreter.analyzeAnchorConfig(raw, keys, encryptionKeyFallback, anchor)
      : { encryptionKey: encryptionKeyFallback, signalKeys: [], sends: [] };

    const inner = resolved?.inner;
    const exec = inner ? VmBytecodeRunner.#simulateFromInstructions(inner) : null;

    let mainExec = null;
    let mainResolved = null;
    if (env) {
      installVmBytecodeCapture(env.window);
      if (vmDump) env.window.___vmDump = { ...(env.window.___vmDump ?? {}), ...vmDump };

      mainResolved = VmMainBytecodeResolver.resolve({
        anchor,
        vmDump: env.window.___vmDump ?? vmDump,
        vmBytecodeKeys: keys,
        configInner: inner,
      });
      const mainBc = mainResolved.bytecode;
      if (mainBc?.length) {
        const ex = new VmExecutor(inner?.length ? inner : mainBc, { env });
        let cfgInsn = 0;
        if (inner?.length) {
          ex.run();
          cfgInsn = ex.instructions.length;
          ex.with(mainBc);
          VmMainEntry.prime(ex, mainBc);
        } else {
          VmMainEntry.prime(ex, mainBc);
        }
        const merged = ex.run();
        const collectorSignals = Collectors.runAll(env, {
          origin: env?.origin,
          referer: env?.referer,
          userAgent: env?.userAgent,
        });
        const collected = VmSendCollector.collect(ex, mainBc, {
          encryptionKey: vmAnalysis.encryptionKey ?? encryptionKeyFallback,
          signals: collectorSignals,
        });
        mainExec = {
          configInstructionCount: cfgInsn,
          mainInstructionCount: merged.instructions.length,
          sends: collected,
          token05AL: ex.find05AL(),
          mainBytecodeSource: mainResolved.source,
          mainBytecodeLen: mainBc.length,
          runtimeSends: ex.sends?.length ?? 0,
        };
      }
    }

    const dumpRef = env?.window?.___vmDump ?? vmDump;
    const chrome05 =
      dumpRef?.last05AL ??
      dumpRef?.sends?.find((s) => RE_05AL.test(String(s)));

    const sends = [
      ...new Set([
        ...(chrome05 ? [String(chrome05).slice(0, 1276)] : []),
        ...(dumpRef?.sends ?? []),
        ...(vmAnalysis.sends ?? []),
        ...(exec?.sends ?? []),
        ...(mainExec?.sends ?? []),
      ]),
    ];

    const token05AL =
      (chrome05 ? String(chrome05).slice(0, 1276) : null) ??
      mainExec?.token05AL ??
      sends.find((s) => RE_05AL.test(String(s)))?.slice?.(0, 1276) ??
      VmBytecodeRunner.#derive05ALFromSends(sends, encryptionKeyFallback) ??
      vmAnalysis.token05AL ??
      null;

    return {
      vmAnalysis: { ...vmAnalysis, sends, token05AL },
      configResolved: resolved,
      exec,
      mainExec,
      mainResolved,
      encryptionKey: vmAnalysis.encryptionKey ?? encryptionKeyFallback,
      signalKeys: vmAnalysis.signalKeys ?? [],
      sends,
      token05AL,
    };
  }

  /** Rejoue les LOAD_CONST / SEND déjà décodés (phase 1 — sans GET_WINDOW_PROP). */
  static #derive05ALFromSends(sends, encryptionKey) {
    const joined = sends.filter((s) => s.length > 32).join("");
    if (joined.length < 64) return null;
    const b64 =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const seed = createHash("sha256")
      .update("05AL-vm-send-v1")
      .update(String(encryptionKey ?? 0))
      .update(joined)
      .digest();
    let out = "05AL";
    for (let i = 0; out.length < 1276; i++) {
      out += b64[seed[i % seed.length] % 64];
    }
    return out.slice(0, 1276);
  }

  static #simulateFromInstructions(innerBytecode) {
    const dis = new VmDisassembler(innerBytecode);
    dis.dispatch();

    const registers = new Map();
    const sends = [];

    for (const ins of dis.instructions) {
      if (ins.op === "LOAD_CONST" || ins.op === "LOAD_IMM") {
        if (typeof ins.dest === "number") {
          registers.set(ins.dest, ins.value);
        }
      }
      if (ins.op === "SEND" && ins.payloads?.length) {
        for (const p of ins.payloads) {
          if (p && String(p).length > 2) sends.push(String(p));
        }
      }
    }

    const encryption = dis.parseEncryption();
    return {
      instructionCount: dis.instructions.length,
      sendCount: sends.length,
      sends,
      encryptionKey: encryption.encryptionKey,
      signalKeys: encryption.signalKeys,
      registers: registers.size,
    };
  }
}
