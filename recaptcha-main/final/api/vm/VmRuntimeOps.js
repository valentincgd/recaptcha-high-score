import { VmValue } from "./VmValue.js";

/** Opérations d'exécution VM (arithmétique, sauts, bytes, LCG). */
export class VmRuntimeOps {
  static resolve(tv, registers) {
    return VmValue.resolve(tv, registers);
  }

  static toNumber(v, registers) {
    const r = VmRuntimeOps.resolve(v, registers);
    if (r.kind === "int" || r.kind === "float") return r.n ?? r.f;
    if (r.kind === "bool") return r.b ? 1 : 0;
    if (r.kind === "str") {
      const n = Number(r.s);
      return Number.isFinite(n) ? n : 0;
    }
    if (r.kind === "bytes") return r.data.length;
    if (r.kind === "codepoints") return r.arr.length;
    return 0;
  }

  static toString(v, registers) {
    return VmValue.asString(VmRuntimeOps.resolve(v, registers), registers);
  }

  static valuesEqual(lhs, rhs, registers) {
    const l = VmRuntimeOps.resolve(lhs, registers);
    const r = VmRuntimeOps.resolve(rhs, registers);
    if (l.kind === "int" && r.kind === "int") return l.n === r.n;
    if (l.kind === "str" && r.kind === "str") return l.s === r.s;
    if (l.kind === "null" && r.kind === "null") return true;
    return VmRuntimeOps.toString(lhs, registers) === VmRuntimeOps.toString(rhs, registers);
  }

  static compareLt(lhs, rhs, registers) {
    return VmRuntimeOps.toNumber(lhs, registers) < VmRuntimeOps.toNumber(rhs, registers);
  }

  static evalBinary(op, dest, lhs, rhs, registers, ctx) {
    const { decryptState, xorKey, modKey } = ctx;
    const lk = VmRuntimeOps.resolve(lhs, registers);
    const rk = VmRuntimeOps.resolve(rhs, registers);

    if (decryptState && (op === "XOR" || op === "MOD")) {
      if (op === "XOR" && !ctx.xorKey) ctx.xorKey = VmRuntimeOps.toNumber(rhs, registers);
      if (op === "MOD" && !ctx.modKey) ctx.modKey = VmRuntimeOps.toNumber(rhs, registers);
      if (lk.kind === "reg") {
        const cp = registers.get(lk.reg);
        if (cp?.kind === "codepoints" || cp?.kind === "bytes") {
          const arr = cp.kind === "bytes" ? [...cp.data] : [...cp.arr];
          if (op === "XOR") {
            for (let i = 0; i < arr.length; i++) arr[i] = (arr[i] ^ ctx.xorKey) & 0xff;
          } else {
            for (let i = 0; i < arr.length; i++) {
              arr[i] = ctx.modKey ? arr[i] % ctx.modKey : arr[i];
            }
          }
          registers.set(dest, VmValue.CodePoints(arr));
          return;
        }
      }
    }

    const a = VmRuntimeOps.toNumber(lhs, registers);
    const b = VmRuntimeOps.toNumber(rhs, registers);
    let n = 0;
    switch (op) {
      case "ADD":
        n = (a + b) | 0;
        break;
      case "SUB":
        n = (a - b) | 0;
        break;
      case "MUL":
        n = (a * b) | 0;
        break;
      case "DIV":
        n = b === 0 ? 0 : ((a / b) | 0);
        break;
      case "MOD":
        n = b === 0 ? 0 : (a % b) | 0;
        break;
      case "OR":
        n = (a | b) | 0;
        break;
      case "XOR":
        n = (a ^ b) | 0;
        break;
      default:
        n = 0;
    }
    registers.set(dest, VmValue.Integer(n));
  }

  static getProp(objTv, propTv, registers) {
    const obj = VmRuntimeOps.resolve(objTv, registers);
    const prop = VmRuntimeOps.resolve(propTv, registers);
    const key = prop.kind === "int" ? prop.n : VmValue.asString(prop, registers);
    if (obj.kind === "bytes" || obj.kind === "codepoints") {
      const idx = Number(key) | 0;
      const byte =
        obj.kind === "bytes"
          ? obj.data[idx] ?? 0
          : obj.arr[idx] ?? 0;
      return VmValue.Integer(byte & 0xff);
    }
    if (obj.kind === "str") {
      if (key === "length") return VmValue.Integer(obj.s.length);
    }
    if (obj.kind === "bytes" && key === "length") {
      return VmValue.Integer(obj.data.length);
    }
    if (obj.kind === "codepoints" && key === "length") {
      return VmValue.Integer(obj.arr.length);
    }
    if (obj.kind === "array") {
      const idx = Number(key) | 0;
      return obj.items[idx] ?? VmValue.Undefined();
    }
    const js = VmValue.toJs(obj);
    if (js != null && (typeof key === "number" || typeof key === "string")) {
      const v = js[key];
      return VmValue.fromJs(v);
    }
    return VmValue.Undefined();
  }

  static setProp(objTv, propTv, valueTv, registers) {
    const obj = VmRuntimeOps.resolve(objTv, registers);
    const prop = VmRuntimeOps.resolve(propTv, registers);
    const key = prop.kind === "int" ? prop.n : Number(VmValue.asString(prop, registers));
    const byteVal = VmRuntimeOps.toNumber(valueTv, registers) & 0xff;

    if (obj.kind === "bytes") {
      obj.data[key] = byteVal;
      return;
    }
    if (obj.kind === "codepoints") {
      obj.arr[key] = byteVal;
      return;
    }
    if (obj.kind === "array") {
      const val = VmRuntimeOps.resolve(valueTv, registers);
      obj.items[key] = val;
    }
  }

  static serialToStr(valueTv, registers) {
    const v = VmRuntimeOps.resolve(valueTv, registers);
    if (v.kind === "bytes") {
      return VmValue.String(
        String.fromCharCode(...[...v.data].map((b) => b & 0xff)),
      );
    }
    if (v.kind === "codepoints") {
      return VmValue.String(String.fromCharCode(...v.arr.map((c) => c & 0xffff)));
    }
    if (v.kind === "str") return v;
    return VmValue.String(VmValue.asString(v, registers));
  }

  static strToBytes(valueTv, registers) {
    const v = VmRuntimeOps.resolve(valueTv, registers);
    if (v.kind === "codepoints") return VmValue.CodePoints([...v.arr]);
    if (v.kind === "bytes") return VmValue.CodePoints([...v.data]);
    if (v.kind === "str") {
      return VmValue.CodePoints([...v.s].map((c) => c.charCodeAt(0) & 0xffff));
    }
    if (v.kind === "reg") {
      const inner = registers.get(v.reg);
      if (inner?.kind === "codepoints") return VmValue.CodePoints([...inner.arr]);
      if (inner?.kind === "bytes") return VmValue.CodePoints([...inner.data]);
      if (inner?.kind === "str") {
        return VmValue.CodePoints([...inner.s].map((c) => c.charCodeAt(0) & 0xffff));
      }
    }
    const s = VmRuntimeOps.toString(valueTv, registers);
    return VmValue.CodePoints([...s].map((c) => c.charCodeAt(0) & 0xffff));
  }
}
