import { createHash } from "node:crypto";
import { VmDisassembler, OPCODES_TABLE } from "./VmDisassembler.js";
import { VmValue } from "./VmValue.js";
import { WindowBridge } from "./WindowBridge.js";
import { VmRuntimeOps } from "./VmRuntimeOps.js";
import { lcgScrambleBytes, bytesToVmPayload } from "./VmLcgScramble.js";

/**
 * Interprète le bytecode config + main (sauts, LCG, SEND, 05AL).
 */
export class VmExecutor extends VmDisassembler {
  constructor(
    bytecode,
    { env = null, maxInstructions = 120_000, trace = false, stopIp = null } = {},
  ) {
    super(bytecode);
    this.env = env;
    this.bridge = env ? new WindowBridge(env) : null;
    this.maxInstructions = maxInstructions;
    this.trace = trace;
    this.sends = [];
    this.halted = false;
    this.execCtx = { xorKey: 0, modKey: 0 };
    this._lastPerfDest = null;
    this.stopIp = stopIp;
  }

  static run(bytecode, env, opts = {}) {
    const ex = new VmExecutor(bytecode, { env, ...opts });
    ex.run();
    return ex;
  }

  static runConfigThenMain(configInner, mainBytecode, env, opts = {}) {
    const ex = new VmExecutor(configInner?.length ? configInner : mainBytecode, { env, ...opts });
    if (configInner?.length) {
      ex.run();
      ex.with(mainBytecode);
      ex.instructions = [];
    }
    return ex.run();
  }

  with(bytecode) {
    this.bytecode = bytecode;
    this.size = bytecode.length;
    this.ip = 0;
    this.halted = false;
    return this;
  }

  run() {
    const maxInsn = Number(process.env.VM_MAX_INSTRUCTIONS) || this.maxInstructions;
    while (this.ip < this.size && !this.halted) {
      if (this.instructions.length >= maxInsn) break;
      const offset = this.ip;
      const argCount = this.readByte();
      const opIndex = this.readVariant();
      const op = OPCODES_TABLE.get(opIndex) ?? `OP_${opIndex}`;
      try {
        if (this.bridge) {
          this.#execute(op, argCount, offset);
        } else {
          this.execInstruction(argCount, offset, op);
        }
      } catch (err) {
        if (this.trace) {
          this.pushInstr("ERROR", offset, { message: err.message, failedOp: op });
        }
        break;
      }
      if (this.ip <= offset) this.ip = offset + 1;
      if (this.stopIp != null && this.ip > this.stopIp) break;
    }
    return {
      instructions: this.instructions,
      sends: this.sends,
      registers: this.registers,
      encryption: this.parseEncryption(),
    };
  }

  #jump(target) {
    if (target >= 0 && target < this.size) this.ip = target;
  }

  #execute(op, argCount, offset) {
    const R = VmRuntimeOps;
    const ctx = this.execCtx;

    switch (op) {
      case "LOAD_CONST":
      case "LOAD_IMM": {
        const dest = this.readDestRegister();
        const value = this.readTypedValue();
        if (!this.charset.length && value.kind === "str") {
          this.charset = [...value.s];
        } else {
          this.setRegister(dest, value);
        }
        break;
      }
      case "NULL": {
        const dest = this.readDestRegister();
        this.setRegister(dest, VmValue.Null());
        break;
      }
      case "MOV": {
        const dest = this.readDestRegister();
        const value = this.readTypedValue();
        this.setRegister(dest, R.resolve(value, this.registers));
        break;
      }
      case "STR_TO_B": {
        const dest = this.readDestRegister();
        const value = this.readTypedValue();
        this.decryptState = true;
        this.setRegister(dest, R.strToBytes(value, this.registers));
        break;
      }
      case "STR_DEC": {
        const dest = this.readDestRegister();
        this.readTypedValue();
        const decrypted = this.readTypedValue();
        const decReg = R.resolve(decrypted, this.registers);
        let str = "";
        if (decReg.kind === "reg") {
          const cp = this.getRegister(decReg.reg);
          if (cp?.kind === "codepoints" && this.charset.length) {
            str = cp.arr.map((pos) => this.charset[pos] ?? "").join("");
            this.decryptState = false;
          } else if (cp?.kind === "bytes" && this.charset.length) {
            str = [...cp.data].map((pos) => this.charset[pos] ?? "").join("");
            this.decryptState = false;
          }
        }
        this.setRegister(dest, VmValue.String(str));
        break;
      }
      case "SERIAL_TO_STR": {
        const dest = this.readDestRegister();
        const value = this.readTypedValue();
        const v = R.resolve(value, this.registers);
        if (v.kind === "bytes" && v.data.length > 0) {
          const mod = R.toNumber({ kind: "reg", reg: 1454 }, this.registers) || 94906238;
          const mul = R.toNumber({ kind: "reg", reg: 1846 }, this.registers) || 13558035;
          const inc = R.toNumber({ kind: "reg", reg: 1213 }, this.registers) || 13037;
          let state =
            R.toNumber({ kind: "reg", reg: 1634 }, this.registers) ||
            R.toNumber({ kind: "reg", reg: 1775 }, this.registers) ||
            1;
          const cp = [...v.data];
          for (let i = 0; i < cp.length; i++) {
            state = (state * mul + inc) % mod;
            cp[i] = (cp[i] + state) % 256;
          }
          this.setRegister(dest, VmValue.CodePoints(cp));
        } else if (v.kind === "codepoints" && v.arr.length > 0) {
          const mod = R.toNumber({ kind: "reg", reg: 1454 }, this.registers) || 94906238;
          const mul = R.toNumber({ kind: "reg", reg: 1846 }, this.registers) || 13558035;
          const inc = R.toNumber({ kind: "reg", reg: 1213 }, this.registers) || 13037;
          let state =
            R.toNumber({ kind: "reg", reg: 1634 }, this.registers) ||
            R.toNumber({ kind: "reg", reg: 1775 }, this.registers) ||
            1;
          const cp = [...v.arr];
          for (let i = 0; i < cp.length; i++) {
            state = (state * mul + inc) % mod;
            cp[i] = (cp[i] + state) % 256;
          }
          this.setRegister(dest, VmValue.CodePoints(cp));
        } else {
          this.setRegister(dest, R.serialToStr(value, this.registers));
        }
        break;
      }
      case "CONCAT": {
        const dest = this.readDestRegister();
        const lhs = this.readTypedValue();
        const rhs = this.readTypedValue();
        const l = R.toString(lhs, this.registers);
        const r = R.toString(rhs, this.registers);
        this.setRegister(dest, VmValue.String(l + r));
        break;
      }
      case "ADD":
      case "SUB":
      case "MUL":
      case "DIV":
      case "MOD":
      case "OR":
      case "XOR":
      case "UNKNOWN_BIN": {
        const dest = this.readDestRegister();
        const lhs = this.readTypedValue();
        const rhs = this.readTypedValue();
        R.evalBinary(op, dest, lhs, rhs, this.registers, ctx);
        if (op === "XOR" || op === "MOD") {
          this.xorKey = ctx.xorKey;
          this.modKey = ctx.modKey;
        }
        break;
      }
      case "GET_PROP": {
        const dest = this.readDestRegister();
        const obj = this.readTypedValue();
        const prop = this.readTypedValue();
        this.setRegister(dest, R.getProp(obj, prop, this.registers));
        break;
      }
      case "SET_PROP": {
        const obj = this.readTypedValue();
        const prop = this.readTypedValue();
        const value = this.readTypedValue();
        R.setProp(obj, prop, value, this.registers);
        break;
      }
      case "GET_WINDOW_PROP": {
        const dest = this.readDestRegister();
        const prop = this.readTypedValue();
        const name = R.toString(prop, this.registers);
        const val = this.bridge.getWindowProperty(name);
        this.setRegister(dest, VmValue.fromJs(val));
        break;
      }
      case "SET_WINDOW_PROP": {
        const prop = this.readTypedValue();
        const value = this.readTypedValue();
        const name = R.toString(prop, this.registers);
        const val = VmValue.toJs(R.resolve(value, this.registers));
        if (name && val !== undefined && this.bridge?.window) {
          this.bridge.window[name] = val;
        }
        break;
      }
      case "CALL_METHOD": {
        const dest = this.readDestRegister();
        const fnTv = this.readTypedValue();
        const methodTv = this.readTypedValue();
        const args = this.readCallArgs(argCount, 2);
        const obj = this.#resolveJs(fnTv);
        const method = R.resolve(methodTv, this.registers);
        const val = this.bridge.callMethod(obj, method, args, this.registers);
        this.setRegister(dest, VmValue.fromJs(val));
        break;
      }
      case "CALL_WINDOW_PROP": {
        const dest = this.readDestRegister();
        const propTv = this.readTypedValue();
        const args = this.readCallArgs(argCount, 1);
        const propName = R.toString(propTv, this.registers);
        let val = this.bridge.callWindowProperty(propTv, args, this.registers);
        if (propName === "Array" && val instanceof Uint8Array) {
          const seed =
            R.toNumber({ kind: "reg", reg: 1775 }, this.registers) ^
            R.toNumber({ kind: "reg", reg: 1634 }, this.registers);
          const scrambled = lcgScrambleBytes(val, seed || 1);
          val = scrambled;
        }
        this.setRegister(dest, VmValue.fromJs(val));
        break;
      }
      case "APPLY": {
        const dest = this.readDestRegister();
        const fnTv = this.readTypedValue();
        const args = this.readCallArgs(argCount, 1);
        const fn = this.#resolveJs(fnTv);
        if (typeof fn === "function") {
          const a = args.map((r) => VmValue.toJs(this.getRegister(r)));
          const val = fn.apply(null, a);
          this.setRegister(dest, VmValue.fromJs(val));
        }
        break;
      }
      case "BIND_APPLY": {
        const dest = this.readDestRegister();
        const thisTv = this.readTypedValue();
        const args = this.readCallArgs(argCount, 1);
        const fn = this.#resolveJs(thisTv);
        if (typeof fn === "function") {
          const a = args.map((r) => VmValue.toJs(this.getRegister(r)));
          const val = fn.apply(this.window, a);
          this.setRegister(dest, VmValue.fromJs(val));
        }
        break;
      }
      case "HASH": {
        const dest = this.readDestRegister();
        const value = this.readTypedValue();
        let seed = VmValue.Undefined();
        if (argCount > 1) seed = this.readTypedValue();
        const str = R.toString(value, this.registers);
        const seedStr = R.toString(seed, this.registers);
        const h = createHash("sha256").update(str).update(seedStr).digest("hex");
        this.setRegister(dest, VmValue.String(h.slice(0, 16)));
        break;
      }
      case "PERF": {
        const dest = this.readDestRegister();
        const t = this.bridge.getWindowProperty("performance")?.now?.() ?? Date.now();
        this._lastPerfDest = dest;
        this.setRegister(dest, VmValue.Float(t));
        break;
      }
      case "MATH_TRUNC": {
        const dest = this.readDestRegister();
        const perfReg = this._lastPerfDest;
        const n = Math.trunc(
          perfReg != null
            ? R.toNumber({ kind: "reg", reg: perfReg }, this.registers)
            : this.bridge.getWindowProperty("performance")?.now?.() ?? 0,
        );
        this.setRegister(dest, VmValue.Integer(n));
        break;
      }
      case "JMP": {
        const targetOffset = this.readOffset();
        this.readTypedValue();
        this.readTypedValue();
        this.#jump(this.ip + targetOffset);
        break;
      }
      case "JE": {
        const targetOffset = this.readOffset();
        const lhs = this.readTypedValue();
        const rhs = this.readTypedValue();
        const target = this.ip + targetOffset;
        if (R.valuesEqual(lhs, rhs, this.registers)) this.#jump(target);
        break;
      }
      case "JL": {
        const targetOffset = this.readOffset();
        const lhs = this.readTypedValue();
        const rhs = this.readTypedValue();
        const target = this.ip + targetOffset;
        if (R.compareLt(lhs, rhs, this.registers)) this.#jump(target);
        break;
      }
      case "NOT": {
        const dest = this.readDestRegister();
        const value = this.readTypedValue();
        const n = R.toNumber(value, this.registers);
        this.setRegister(dest, VmValue.Boolean(!n));
        break;
      }
      case "TYPEOF": {
        const dest = this.readDestRegister();
        const value = this.readTypedValue();
        const v = R.resolve(value, this.registers);
        let t = "undefined";
        if (v.kind === "str") t = "string";
        else if (v.kind === "int" || v.kind === "float") t = "number";
        else if (v.kind === "bool") t = "boolean";
        else if (v.kind === "null") t = "object";
        this.setRegister(dest, VmValue.String(t));
        break;
      }
      case "REGEXP": {
        const dest = this.readDestRegister();
        const pattern = this.readTypedValue();
        const flags = this.readTypedValue();
        const pat = R.toString(pattern, this.registers);
        const fl = R.toString(flags, this.registers);
        try {
          this.setRegister(dest, VmValue.fromJs(new RegExp(pat, fl)));
        } catch {
          this.setRegister(dest, VmValue.Null());
        }
        break;
      }
      case "NEW_FUNCTION":
      case "DISPOSER":
      case "UNKNOWN_OP": {
        this.skipArgs(argCount, op);
        break;
      }
      case "SEND": {
        const regs = [];
        for (let i = 0; i < argCount; i++) regs.push(this.readRegisterIndex());
        const blobReg = regs.length > 1 ? regs[1] : regs[0];
        const v = this.getRegister(blobReg);
        let p = "";
        if (v?.kind === "bytes" && v.data?.length > 0) {
          p = bytesToVmPayload(v.data);
        } else if (v?.kind === "codepoints" && v.arr?.length > 0) {
          p = bytesToVmPayload(Uint8Array.from(v.arr, (n) => n & 0xff));
        } else {
          p = VmValue.asString(v, this.registers);
        }
        if (p.length > 8) this.sends.push(p);
        break;
      }
      default:
        this.skipArgs(argCount, op);
    }
  }

  get window() {
    return this.bridge?.window ?? this.env?.window;
  }

  #resolveJs(tv) {
    const v = VmValue.resolve(tv, this.registers);
    if (v.kind === "reg") return VmValue.toJs(this.getRegister(v.reg));
    return VmValue.toJs(v);
  }

  /** Cherche un token 05AL dans les registres / SEND. */
  find05AL(maxLen = 1276) {
    const re = /05AL[A-Za-z0-9_-]{100,}/;
    for (const p of this.sends) {
      const m = String(p).match(re);
      if (m) return m[0].slice(0, maxLen);
    }
    for (const v of this.registers.values()) {
      const s = VmValue.asString(v, this.registers);
      const m = s.match(re);
      if (m) return m[0].slice(0, maxLen);
    }
    return null;
  }
}
