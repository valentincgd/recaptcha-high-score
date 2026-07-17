export class VmValue {
  static Register(reg) {
    return { kind: "reg", reg };
  }
  static Integer(n) {
    return { kind: "int", n };
  }
  static Float(f) {
    return { kind: "float", f };
  }
  static String(s) {
    return { kind: "str", s };
  }
  static Boolean(b) {
    return { kind: "bool", b };
  }
  static Undefined() {
    return { kind: "undef" };
  }

  static Null() {
    return { kind: "null", v: null };
  }
  static CodePoints(arr) {
    return { kind: "codepoints", arr };
  }

  static Bytes(data) {
    const buf = data instanceof Uint8Array ? data : Uint8Array.from(data);
    return { kind: "bytes", data: buf };
  }

  static Array(items = []) {
    return { kind: "array", items: [...items] };
  }

  static fromJs(val) {
    if (val === undefined) return VmValue.Undefined();
    if (val === null) return VmValue.Null();
    if (typeof val === "number") {
      return Number.isInteger(val) ? VmValue.Integer(val) : VmValue.Float(val);
    }
    if (typeof val === "boolean") return VmValue.Boolean(val);
    if (typeof val === "string") return VmValue.String(val);
    if (val instanceof Uint8Array) return VmValue.Bytes(val);
    if (Array.isArray(val)) return VmValue.Array(val.map((x) => VmValue.fromJs(x)));
    return VmValue.String(String(val));
  }

  static toJs(v) {
    if (!v || v.kind === "undef") return undefined;
    if (v.kind === "null") return null;
    if (v.kind === "str") return v.s;
    if (v.kind === "int") return v.n;
    if (v.kind === "float") return v.f;
    if (v.kind === "bool") return v.b;
    if (v.kind === "bytes") return [...v.data];
    if (v.kind === "codepoints") {
      return String.fromCharCode(...v.arr.map((c) => c & 0xffff));
    }
    if (v.kind === "array") return v.items.map((x) => VmValue.toJs(x));
    return undefined;
  }

  static asNumber(v) {
    if (v.kind === "int" || v.kind === "float") return v.n ?? v.f;
    if (v.kind === "bool") return v.b ? 1 : 0;
    if (v.kind === "str") return Number(v.s) || 0;
    return 0;
  }

  static asString(v, regs) {
    if (!v || v.kind === "undef") return "";
    if (v.kind === "str") return v.s;
    if (v.kind === "reg") return VmValue.asString(regs.get(v.reg) ?? VmValue.Undefined(), regs);
    if (v.kind === "int") return String(v.n);
    if (v.kind === "bytes") {
      return String.fromCharCode(...[...v.data].map((b) => b & 0xff));
    }
    if (v.kind === "codepoints") return String.fromCharCode(...v.arr.map((c) => c & 0xffff));
    return "";
  }

  static resolve(v, regs) {
    if (v.kind === "reg") return regs.get(v.reg) ?? VmValue.Undefined();
    return v;
  }
}
