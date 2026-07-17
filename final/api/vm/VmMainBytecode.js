import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { decodeBytecode } from "./BytecodeDecoder.js";
import { VmDisassembler } from "./VmDisassembler.js";

/** Bytecode MAIN statique (recaptcha-vm-main/assets) — référence SEND / clés signal. */
export class VmMainBytecode {
  static #cache = null;

  static loadFromAssets() {
    if (VmMainBytecode.#cache) return VmMainBytecode.#cache;
    const path = join(
      process.cwd(),
      "recaptcha-vm-main",
      "assets",
      "main_bytecode.txt",
    );
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf8").trim();
    const bytecode = decodeBytecode(raw);
    const dis = new VmDisassembler(bytecode);
    dis.dispatch();
    VmMainBytecode.#cache = {
      bytecode,
      instructions: dis.instructions,
      sends: dis.collectSends(),
      encryption: dis.parseEncryption(),
      size: bytecode.length,
    };
    return VmMainBytecode.#cache;
  }
}
