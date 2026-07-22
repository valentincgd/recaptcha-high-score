import { decodeBytecode } from "./BytecodeDecoder.js";
import { VmValue } from "./VmValue.js";

export const OPCODES_TABLE = new Map([
  [1, "LOAD_CONST"],
  [2, "CONCAT"],
  [3, "XOR"],
  [4, "CALL_METHOD"],
  [5, "GET_PROP"],
  [6, "SET_PROP"],
  [7, "SEND"],
  [8, "MOV"],
  [9, "NULL"],
  [10, "ADD"],
  [11, "SUB"],
  [12, "MUL"],
  [13, "DIV"],
  [14, "UNKNOWN_OP"],
  [15, "MOD"],
  [16, "SET_WINDOW_PROP"],
  [17, "GET_WINDOW_PROP"],
  [18, "CALL_WINDOW_PROP"],
  [19, "JE"],
  [20, "HASH"],
  [21, "STR_TO_B"],
  [22, "REGEXP"],
  [23, "UNKNOWN_BIN"],
  [24, "UNKNOWN_BIN"],
  [25, "NOT"],
  [27, "SERIAL_TO_STR"],
  [28, "MATH_TRUNC"],
  [30, "NEW_FUNCTION"],
  [31, "JL"],
  [32, "DISPOSER"],
  [34, "BIND_APPLY"],
  [35, "OR"],
  [36, "STR_DEC"],
  [38, "APPLY"],
  [39, "PERF"],
  [40, "LOAD_IMM"],
  [41, "TYPEOF"],
]);

/** Port du désassembleur recaptcha-vm (bytecode config / main). */
export class VmDisassembler {
  constructor(bytecode, { showInstructions = false } = {}) {
    this.bytecode = bytecode;
    this.size = bytecode.length;
    this.ip = 0;
    this.registers = new Map();
    this.instructions = [];
    this.charset = [];
    this.decryptState = false;
    this.xorKey = 0;
    this.modKey = 0;
    this.showInstructions = showInstructions;
  }

  static fromRawBase64(raw) {
    return new VmDisassembler(decodeBytecode(raw));
  }

  readByte() {
    return this.bytecode[this.ip++];
  }

  readInt32() {
    const b0 = this.readByte();
    const b1 = this.readByte();
    const b2 = this.readByte();
    const b3 = this.readByte();
    return (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) | 0;
  }

  readVariant() {
    let value = 0;
    for (let shift = 0; shift < 32; shift += 7) {
      const byte = this.readByte();
      value |= (byte & 127) << shift;
      if ((byte & 128) === 0) return value | 0;
    }
    for (let i = 0; i < 5; i++) {
      const byte = this.readByte();
      if ((byte & 128) === 0) return value | 0;
    }
    throw new Error("varint too long");
  }

  readIntFlag() {
    let value = 0;
    const limit = Math.min(this.ip + 10, this.size);
    let flag = false;
    while (this.ip < limit) {
      const byte = this.readByte();
      value |= byte;
      if ((byte & 128) === 0) {
        flag = (value & 127) !== 0;
        break;
      }
    }
    return flag;
  }

  readDestRegister() {
    this.ip += 1;
    return this.readVariant();
  }

  readPointerRegister() {
    return this.readVariant();
  }

  readRegisterIndex() {
    this.readByte();
    this.readIntFlag();
    this.readByte();
    return this.readVariant();
  }

  readCallArgs(count, sub = 0) {
    const args = [];
    for (let i = 0; i < Math.max(0, count - sub); i++) {
      args.push(this.readRegisterIndex());
    }
    return args;
  }

  readTypedValue() {
    this.readByte();
    this.readIntFlag();
    const index = this.readByte() >> 3;
    switch (index) {
      case 1:
        return VmValue.Register(this.readPointerRegister());
      case 2:
        return VmValue.Boolean(this.readIntFlag());
      case 3:
        return VmValue.Integer(this.readVariant());
      case 4:
        return VmValue.String(this.decodeStr());
      case 6:
        return VmValue.Float(this.readFloat64());
      default:
        return VmValue.Undefined();
    }
  }

  /** Port decode_str → decode_string(false, hint). */
  decodeStr() {
    const lengthHint = this.readVariant();
    return this.decodeString(false, lengthHint);
  }

  /** Aligné disassemble.rs decode_string. */
  decodeString(flagUtf8, lengthHint) {
    const start = this.ip;
    const hint = lengthHint >>> 0;
    if (hint > 0 && this.bytecode.length > 0) {
      const end = start + hint;
      if (end > this.size) throw new Error("decodeString: out of bounds");
      this.ip = end;
      const sub = this.bytecode.subarray(start, end);
      if (flagUtf8) {
        return new TextDecoder("utf-8", { fatal: true }).decode(sub);
      }
      return Buffer.from(sub).toString("utf8");
    }

    const limit = start + hint;
    const runes = [];
    let i = start;
    while (i < limit) {
      const byte1 = this.bytecode[i++];
      if (byte1 < 0x80) {
        runes.push(byte1);
      } else if (byte1 < 0xe0) {
        if (i >= limit) throw new Error("decodeString: truncated 2-byte");
        const byte2 = this.bytecode[i++];
        if ((byte2 & 0xc0) !== 0x80) throw new Error("decodeString: invalid 2-byte");
        runes.push(((byte1 & 0x1f) << 6) | (byte2 & 0x3f));
      } else if (byte1 < 0xf0) {
        if (i >= limit - 1) throw new Error("decodeString: truncated 3-byte");
        const byte2 = this.bytecode[i++];
        const byte3 = this.bytecode[i++];
        if ((byte2 & 0xc0) !== 0x80 || (byte3 & 0xc0) !== 0x80) {
          throw new Error("decodeString: invalid 3-byte");
        }
        runes.push(((byte1 & 0x0f) << 12) | ((byte2 & 0x3f) << 6) | (byte3 & 0x3f));
      } else if (byte1 <= 0xf4) {
        if (i >= limit - 2) throw new Error("decodeString: truncated 4-byte");
        const byte2 = this.bytecode[i++];
        const byte3 = this.bytecode[i++];
        const byte4 = this.bytecode[i++];
        let cp =
          ((byte1 & 7) << 18) |
          ((byte2 & 0x3f) << 12) |
          ((byte3 & 0x3f) << 6) |
          (byte4 & 0x3f);
        cp -= 0x10000;
        runes.push((cp >> 10) + 0xd800, (cp & 0x3ff) + 0xdc00);
      } else {
        throw new Error("decodeString: invalid UTF-8 leading byte");
      }
      if (runes.length >= 8192) throw new Error("decodeString: too many chars");
    }
    this.ip = limit;
    return String.fromCodePoint(...runes);
  }

  /** Aligné disassemble.rs read_float_64 (pas IEEE LE brut). */
  readFloat64() {
    const lo = this.readInt32() >>> 0;
    const hi = this.readInt32() >>> 0;
    const sign = (hi >> 31) !== 0 ? -1 : 1;
    const exponent = (hi >> 20) & 0x7ff;
    const mantissa = ((hi & 0xfffff) * 0x100000000 + lo) >>> 0;
    if (exponent === 0x7ff) {
      return mantissa !== 0 ? NaN : sign * Infinity;
    }
    if (exponent === 0) {
      return sign * 2 ** -1074 * mantissa;
    }
    return sign * 2 ** (exponent - 1075) * (mantissa + 0x10000000000000);
  }

  readOffset() {
    this.readByte();
    this.readIntFlag();
    this.readByte();
    return this.readInt32();
  }

  setRegister(reg, value) {
    this.registers.set(reg, value);
  }

  getRegister(reg) {
    return this.registers.get(reg) ?? VmValue.Undefined();
  }

  pushInstr(op, offset, detail) {
    this.instructions.push({ op, offset, ...detail });
  }

  dispatch() {
    const maxInsn = Number(process.env.VM_MAX_INSTRUCTIONS) || 80_000;
    while (this.ip < this.size) {
      if (this.instructions.length >= maxInsn) break;
      const offset = this.ip;
      const argCount = this.readByte();
      const opIndex = this.readVariant();
      const op = OPCODES_TABLE.get(opIndex) ?? `OP_${opIndex}`;
      try {
        this.execInstruction(argCount, offset, op);
      } catch (err) {
        this.pushInstr("ERROR", offset, { message: err.message, failedOp: op });
        break;
      }
      if (this.ip <= offset) this.ip = offset + 1;
    }
    return this.instructions;
  }

  execInstruction(argCount, offset, op) {
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
        this.pushInstr(op, offset, {
          dest,
          value: VmDisassembler.#serializeValue(value),
        });
        break;
      }
      case "SEND": {
        const regs = [];
        for (let i = 0; i < argCount; i++) {
          regs.push(this.readRegisterIndex());
        }
        const payloads = regs.map((r) =>
          VmValue.asString(this.getRegister(r), this.registers),
        );
        this.pushInstr(op, offset, { registers: regs, payloads });
        break;
      }
      case "HASH": {
        const dest = this.readDestRegister();
        const value = this.readTypedValue();
        let seed = VmValue.Undefined();
        if (argCount > 1) seed = this.readTypedValue();
        this.pushInstr(op, offset, {
          dest,
          value: VmDisassembler.#serializeValue(value),
          seed: VmDisassembler.#serializeValue(seed),
        });
        break;
      }
      case "ADD":
      case "SUB":
      case "MUL":
      case "DIV":
      case "OR":
      case "XOR":
      case "MOD":
      case "UNKNOWN_BIN": {
        const dest = this.readDestRegister();
        const lhs = this.readTypedValue();
        const rhs = this.readTypedValue();
        if (this.decryptState && (op === "XOR" || op === "MOD")) {
          const rk = VmValue.resolve(rhs, this.registers);
          const lk = VmValue.resolve(lhs, this.registers);
          if (op === "XOR" && !this.xorKey) this.xorKey = VmValue.asNumber(rk);
          if (op === "MOD" && !this.modKey) this.modKey = VmValue.asNumber(rk);
          if (lk.kind === "reg") {
            const cp = this.getRegister(lk.reg);
            if (cp.kind === "codepoints") {
              const arr =
                op === "XOR"
                  ? cp.arr.map((u) => u ^ this.xorKey)
                  : cp.arr.map((u) => u % this.modKey);
              this.setRegister(dest, VmValue.CodePoints(arr));
            }
          }
        }
        this.pushInstr(op, offset, {
          dest,
          lhs: VmDisassembler.#serializeValue(lhs),
          rhs: VmDisassembler.#serializeValue(rhs),
        });
        break;
      }
      case "STR_TO_B": {
        const dest = this.readDestRegister();
        const value = this.readTypedValue();
        this.decryptState = true;
        const s = VmValue.asString(VmValue.resolve(value, this.registers), this.registers);
        this.setRegister(dest, VmValue.CodePoints([...s].map((c) => c.charCodeAt(0))));
        this.pushInstr(op, offset, { dest, str: s.slice(0, 80) });
        break;
      }
      case "STR_DEC": {
        const dest = this.readDestRegister();
        this.readTypedValue();
        const decrypted = this.readTypedValue();
        let str = "";
        const decReg = VmValue.resolve(decrypted, this.registers);
        if (decReg.kind === "reg") {
          const cp = this.getRegister(decReg.reg);
          if (cp.kind === "codepoints" && this.charset.length) {
            str = cp.arr.map((pos) => this.charset[pos] ?? "").join("");
            this.decryptState = false;
            this.setRegister(dest, VmValue.String(str));
          }
        }
        this.pushInstr(op, offset, { dest, str: str.slice(0, 120) });
        break;
      }
      case "MOV": {
        const dest = this.readDestRegister();
        const value = this.readTypedValue();
        const resolved = VmValue.resolve(value, this.registers);
        this.setRegister(dest, resolved);
        this.pushInstr(op, offset, {
          dest,
          value: VmDisassembler.#serializeValue(value),
        });
        break;
      }
      case "GET_WINDOW_PROP": {
        const dest = this.readDestRegister();
        const prop = this.readTypedValue();
        this.pushInstr(op, offset, {
          dest,
          prop: VmDisassembler.#serializeValue(prop),
        });
        break;
      }
      case "GET_PROP": {
        const dest = this.readDestRegister();
        const obj = this.readTypedValue();
        const prop = this.readTypedValue();
        this.pushInstr(op, offset, {
          dest,
          obj: VmDisassembler.#serializeValue(obj),
          prop: VmDisassembler.#serializeValue(prop),
        });
        break;
      }
      case "CALL_METHOD": {
        const dest = this.readDestRegister();
        const fn = this.readTypedValue();
        const method = this.readTypedValue();
        const args = this.readCallArgs(argCount, 2);
        this.pushInstr(op, offset, {
          dest,
          args,
          method: VmDisassembler.#serializeValue(method),
        });
        break;
      }
      case "CALL_WINDOW_PROP": {
        const dest = this.readDestRegister();
        const prop = this.readTypedValue();
        const args = this.readCallArgs(argCount, 1);
        this.pushInstr(op, offset, {
          dest,
          prop: VmDisassembler.#serializeValue(prop),
          args,
        });
        break;
      }
      case "CONCAT": {
        const dest = this.readDestRegister();
        const lhs = this.readTypedValue();
        const rhs = this.readTypedValue();
        const l = VmValue.asString(VmValue.resolve(lhs, this.registers), this.registers);
        const r = VmValue.asString(VmValue.resolve(rhs, this.registers), this.registers);
        this.setRegister(dest, VmValue.String(l + r));
        this.pushInstr(op, offset, { dest });
        break;
      }
      case "SET_PROP": {
        const obj = this.readTypedValue();
        const prop = this.readTypedValue();
        const value = this.readTypedValue();
        this.pushInstr(op, offset, {
          obj: VmDisassembler.#serializeValue(obj),
          prop: VmDisassembler.#serializeValue(prop),
          value: VmDisassembler.#serializeValue(value),
        });
        break;
      }
      case "SET_WINDOW_PROP": {
        const prop = this.readTypedValue();
        const value = this.readTypedValue();
        this.pushInstr(op, offset, {
          prop: VmDisassembler.#serializeValue(prop),
          value: VmDisassembler.#serializeValue(value),
        });
        break;
      }
      case "REGEXP": {
        const dest = this.readDestRegister();
        const pattern = this.readTypedValue();
        const flags = this.readTypedValue();
        this.pushInstr(op, offset, {
          dest,
          pattern: VmDisassembler.#serializeValue(pattern),
          flags: VmDisassembler.#serializeValue(flags),
        });
        break;
      }
      case "NEW_FUNCTION": {
        const dest = this.readDestRegister();
        const targetOffset = this.readOffset();
        const argsReg = this.readRegisterIndex();
        this.pushInstr(op, offset, {
          dest,
          argsReg,
          target: this.ip + targetOffset,
        });
        break;
      }
      case "DISPOSER": {
        const targetOffset = this.readOffset();
        const funcReg = this.readRegisterIndex();
        this.pushInstr(op, offset, {
          funcReg,
          target: this.ip + targetOffset,
        });
        break;
      }
      case "APPLY": {
        const dest = this.readDestRegister();
        const fn = this.readTypedValue();
        const args = this.readCallArgs(argCount, 1);
        this.pushInstr(op, offset, {
          dest,
          fn: VmDisassembler.#serializeValue(fn),
          args,
        });
        break;
      }
      case "BIND_APPLY": {
        const dest = this.readDestRegister();
        const thisVal = this.readTypedValue();
        const args = this.readCallArgs(argCount, 1);
        this.pushInstr(op, offset, {
          dest,
          thisVal: VmDisassembler.#serializeValue(thisVal),
          args,
        });
        break;
      }
      case "NOT": {
        const dest = this.readDestRegister();
        const value = this.readTypedValue();
        this.pushInstr(op, offset, {
          dest,
          value: VmDisassembler.#serializeValue(value),
        });
        break;
      }
      case "UNKNOWN_OP": {
        const value = this.readTypedValue();
        this.pushInstr(op, offset, {
          value: VmDisassembler.#serializeValue(value),
        });
        break;
      }
      case "TYPEOF": {
        const dest = this.readDestRegister();
        const value = this.readTypedValue();
        this.pushInstr(op, offset, {
          dest,
          value: VmDisassembler.#serializeValue(value),
        });
        break;
      }
      case "SERIAL_TO_STR": {
        const dest = this.readDestRegister();
        const value = this.readTypedValue();
        this.pushInstr(op, offset, {
          dest,
          value: VmDisassembler.#serializeValue(value),
        });
        break;
      }
      case "PERF":
      case "MATH_TRUNC": {
        const dest = this.readDestRegister();
        this.pushInstr(op, offset, { dest });
        break;
      }
      case "JE": {
        const targetOffset = this.readOffset();
        const lhs = this.readTypedValue();
        const rhs = this.readTypedValue();
        const target = this.ip + targetOffset;
        const li = VmValue.resolve(lhs, this.registers);
        const ri = VmValue.resolve(rhs, this.registers);
        const isJmp =
          li.kind === "int" &&
          ri.kind === "int" &&
          li.n === ri.n &&
          ((li.n === 0 && ri.n === 0) || (li.n === 1 && ri.n === 1));
        this.pushInstr(isJmp ? "JMP" : "JE", offset, {
          target,
          lhs: VmDisassembler.#serializeValue(lhs),
          rhs: VmDisassembler.#serializeValue(rhs),
        });
        break;
      }
      case "JL": {
        const targetOffset = this.readOffset();
        const lhs = this.readTypedValue();
        const rhs = this.readTypedValue();
        this.pushInstr(op, offset, {
          target: this.ip + targetOffset,
          lhs: VmDisassembler.#serializeValue(lhs),
          rhs: VmDisassembler.#serializeValue(rhs),
        });
        break;
      }
      case "NULL": {
        const dest = this.readDestRegister();
        this.setRegister(dest, VmValue.Null());
        this.pushInstr(op, offset, { dest });
        break;
      }
      default:
        this.skipArgs(argCount, op);
        this.pushInstr(op, offset, { argCount, unknown: true });
    }
  }

  skipArgs(argCount, op) {
    try {
      if (op === "JE" || op === "JL") {
        this.readOffset();
        this.readTypedValue();
        this.readTypedValue();
        return;
      }
      if (op === "SEND") {
        for (let i = 0; i < argCount; i++) this.readRegisterIndex();
        return;
      }
      if (op === "CALL_METHOD") {
        this.readDestRegister();
        this.readTypedValue();
        this.readTypedValue();
        this.readCallArgs(argCount, 2);
        return;
      }
      if (op === "CALL_WINDOW_PROP") {
        this.readDestRegister();
        this.readTypedValue();
        this.readCallArgs(argCount, 1);
        return;
      }
      if (op === "STR_DEC") {
        this.readDestRegister();
        this.readTypedValue();
        this.readTypedValue();
        return;
      }
      for (let i = 0; i < Math.max(1, argCount); i++) {
        this.readDestRegister();
        this.readTypedValue();
      }
    } catch {
      /* partial skip */
    }
  }

  static #serializeValue(v) {
    if (!v) return null;
    if (v.kind === "str") return v.s;
    if (v.kind === "int") return v.n;
    if (v.kind === "float") return v.f;
    if (v.kind === "reg") return `R${v.reg}`;
    if (v.kind === "bool") return v.b;
    return v.kind;
  }

  parseEncryption() {
    let encryptionKey = null;
    const signalKeys = [];
    for (const ins of this.instructions) {
      if (ins.op === "LOAD_CONST" && ins.dest === 586) {
        if (typeof ins.value === "number") encryptionKey = ins.value;
        else if (typeof ins.value === "string" && /^-?\d+$/.test(ins.value)) {
          encryptionKey = Number(ins.value);
        }
      }
      if (
        ins.op === "LOAD_CONST" &&
        ins.value === "1" &&
        typeof ins.dest === "number" &&
        ins.offset > 760 &&
        ins.offset < 1700
      ) {
        signalKeys.push(ins.dest);
      }
    }
    return { encryptionKey, signalKeys };
  }

  collectSends() {
    return this.instructions
      .filter((i) => i.op === "SEND")
      .flatMap((i) => i.payloads ?? []);
  }
}
