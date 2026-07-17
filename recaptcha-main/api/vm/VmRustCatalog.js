import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Catalogue extrait de recaptcha-vm-main/output/disassembled.txt (désassemblage Rust fiable).
 */
export const VM_CONFIG_SIGNAL_KEYS = [
  352, 417, 545, 1313, 291, 1092, 549, 614, 41, 1994, 779, 43, 619, 2033, 659, 727,
  1019, 1310, 959, 895,
];

/** Clés documentées README + XOR dans disassembled (R586 ^ signalKey). */
export const VM_README_SIGNAL_KEYS = [
  417, 727, 545, 779, 659, 959, 895, 1092, 41, 43, 549, 352,
];

/** Registre clé LCG (parse.rs + disassembled.txt LOAD_IMM R586). */
export const VM_ENCRYPTION_REG = 586;
export const VM_LCG_MODULUS = 94906238;
export const VM_LCG_MULTIPLIER = 13558035;
export const VM_LCG_INCREMENT = 13037;

/** Opcodes VM (recaptcha-vm-main README). */
export const VM_OPCODES = {
  1: "LOAD_CONST",
  2: "CONCAT",
  3: "XOR",
  4: "CALL_METHOD",
  5: "GET_PROP",
  6: "SET_PROP",
  7: "SEND",
  8: "MOV",
  9: "NULL",
  10: "ADD",
  11: "SUB",
  12: "MUL",
  13: "DIV",
  15: "MOD",
  16: "SET_WINDOW_PROP",
  17: "GET_WINDOW_PROP",
  18: "CALL_WINDOW_PROP",
  19: "JE",
  20: "HASH",
  21: "STR_TO_B",
  22: "REGEXP",
  25: "NOT",
  27: "SERIAL_TO_STR",
  28: "MATH_TRUNC",
  30: "NEW_FUNCTION",
  31: "JL",
  32: "DISPOSER",
  34: "BIND_APPLY",
  35: "OR",
  36: "STR_DEC",
  38: "APPLY",
  39: "PERF",
  40: "LOAD_IMM",
  41: "TYPEOF",
};

export class VmRustCatalog {
  static #cache = null;

  static loadFromDisassembledTxt() {
    if (VmRustCatalog.#cache) return VmRustCatalog.#cache;
    const path = join(
      process.cwd(),
      "recaptcha-vm-main",
      "output",
      "disassembled.txt",
    );
    if (!existsSync(path)) {
      return {
        signalKeys: [...VM_CONFIG_SIGNAL_KEYS],
        sendSites: 0,
        encryptionKeyExample: -940896859,
      };
    }
    const text = readFileSync(path, "utf8");
    const signalKeys = [];
    const re = /LOAD_CONST\s+R(\d+),\s+"1"/g;
    let m;
    while ((m = re.exec(text))) signalKeys.push(Number(m[1]));

    const sendSites = (text.match(/^\s*SEND\s+/gm) ?? []).length;
    const imm586 = text.match(/LOAD_IMM\s+R586,\s+(-?\d+)/);
    VmRustCatalog.#cache = {
      signalKeys: [...new Set(signalKeys)].sort((a, b) => a - b),
      sendSites,
      encryptionKeyExample: imm586 ? Number(imm586[1]) : null,
      instructionLines: text.split(/\r?\n/).length,
    };
    return VmRustCatalog.#cache;
  }

  static allSignalKeys() {
    const rust = VmRustCatalog.loadFromDisassembledTxt();
    return [
      ...new Set([
        ...rust.signalKeys,
        ...VM_README_SIGNAL_KEYS,
        ...VM_CONFIG_SIGNAL_KEYS,
      ]),
    ].sort((a, b) => a - b);
  }
}
