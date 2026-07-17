import { VmValue } from "./VmValue.js";

/** Résout GET_WINDOW_PROP / GET_PROP sur PureBrowserEnvironment. */
export class WindowBridge {
  constructor(env) {
    this.window = env?.window ?? env;
    this.document = env?.document ?? this.window?.document;
  }

  getWindowProperty(name) {
    const key = String(name);
    if (key in this.window) return this.window[key];
    if (key === "document") return this.document;
    return undefined;
  }

  getProperty(obj, prop) {
    if (obj == null) return undefined;
    if (typeof prop === "object" && prop.kind !== undefined) {
      const key = prop.kind === "int" ? prop.n : prop.s;
      if (Array.isArray(obj) || obj instanceof Uint8Array) return obj[key];
      if (typeof obj === "string" && key === "length") return obj.length;
      return obj[key];
    }
    const key = String(prop);
    return obj[key];
  }

  callMethod(obj, methodName, argRegs, registers) {
    if (obj == null) return undefined;
    const method = typeof methodName === "string" ? methodName : VmValue.asString(methodName, registers);
    const fn = obj[method];
    if (typeof fn !== "function") return undefined;
    const args = (argRegs ?? []).map((r) => this.#regToJs(registers.get(r)));
    try {
      return fn.apply(obj, args);
    } catch {
      return undefined;
    }
  }

  callWindowProperty(propName, argRegs, registers) {
    const key = VmValue.asString(propName, registers);
    const args = (argRegs ?? []).map((r) => this.#regToJs(registers.get(r)));

    if (key === "Array") {
      const nums = args.map((a) => Number(a) | 0);
      const len = nums.find((n) => n > 0 && n < 65536);
      if (len) return new Uint8Array(len);
      const perf = nums.find((n) => n !== 0);
      const fill = Math.max(48, Math.abs(perf ?? 64) % 512 || 64);
      return new Uint8Array(fill);
    }

    const fn = this.getWindowProperty(key);
    if (typeof fn !== "function") return undefined;
    try {
      return fn.apply(this.window, args);
    } catch {
      return undefined;
    }
  }

  static jsToVm(val) {
    return VmValue.fromJs(val);
  }

  static vmToJs(v) {
    return VmValue.toJs(v);
  }

  #regToJs(v) {
    return VmValue.toJs(v);
  }
}
