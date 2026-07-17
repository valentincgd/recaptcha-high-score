import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { join } from "node:path";
import { decodeBytecode, decodeBase64Custom } from "./BytecodeDecoder.js";
import { decryptConfigWithKeyCandidates } from "./VmBytecodeKeys.js";
import { VmDisassembler } from "./VmDisassembler.js";
import { scoreInnerBytecode } from "./VmBytecodeValidator.js";

const CAPTURE_PATHS = [
  join(process.cwd(), "captures", "main-bytecode.txt"),
  join(process.cwd(), "captures", "vm-runtime.json"),
];

/** Taille décodée de `recaptcha-vm-main/assets/main_bytecode.txt` (pas du runtime TM). */
export const STATIC_MAIN_DECODED_LEN = 78_464;

/** Résout le bytecode MAIN (capture runtime > anchor init > assets). */
export class VmMainBytecodeResolver {
  static isStaticAssetDecodedLen(len) {
    return len === STATIC_MAIN_DECODED_LEN;
  }

  static isStaticAssetRaw(raw, keys) {
    if (!raw || typeof raw !== "string") return false;
    for (const entry of VmMainBytecodeResolver.#decodeCandidates(raw, keys)) {
      if (VmMainBytecodeResolver.isStaticAssetDecodedLen(entry.bytecode?.length)) {
        return true;
      }
    }
    return false;
  }

  static hasRuntimeVmDump(vmDump) {
    return (vmDump?.bytecodes ?? []).some(
      (b) => typeof b === "string" && b.length > 8000,
    );
  }
  static resolve({
    anchor = null,
    vmDump = null,
    vmBytecodeKeys = null,
    configInner = null,
    preferAssets = false,
  } = {}) {
    const keys =
      vmBytecodeKeys ?? anchor?.config?.vmBytecodeKeys ?? [[176, 170, 107], [76]];
    const candidates = [];
    const rejected = [];
    const hasRuntime = VmMainBytecodeResolver.hasRuntimeVmDump(vmDump);
    const allowStatic =
      preferAssets || process.env.RECAPTCHA_ALLOW_STATIC_MAIN === "1";

    const push = (raw, source, meta = {}) => {
      if (!raw || typeof raw !== "string" || raw.length < 2000) return;
      const fromCapture =
        source.startsWith("file:") ||
        source.startsWith("vmDump") ||
        meta.fromCapture === true;
      const isStaticFile =
        !hasRuntime &&
        !fromCapture &&
        VmMainBytecodeResolver.isStaticAssetRaw(raw, keys);
      if (isStaticFile) {
        rejected.push({
          source,
          reason: "static-asset-78464b",
          hint: "vmDump.bytecodes vide — fichier = assets Rust, pas runtime Chrome",
        });
        return;
      }
      for (const entry of VmMainBytecodeResolver.#decodeCandidates(raw, keys)) {
        if (
          !allowStatic &&
          !fromCapture &&
          VmMainBytecodeResolver.isStaticAssetDecodedLen(entry.bytecode?.length)
        ) {
          rejected.push({
            source,
            reason: "static-asset-78464b",
            decodedLen: entry.bytecode.length,
          });
          continue;
        }
        candidates.push({
          ...entry,
          source,
          fromCapture,
          score: VmMainBytecodeResolver.#scoreMain(entry.bytecode, configInner, {
            tag: entry.tag,
            fromCapture,
          }),
          ...meta,
        });
      }
    };

    if (!preferAssets) {
      for (const b of vmDump?.bytecodes ?? []) {
        push(b, "vmDump", { fromCapture: true });
      }
      if (vmDump?.mainBytecode) {
        push(vmDump.mainBytecode, "vmDump.main", { fromCapture: true });
      }

      if (hasRuntime || allowStatic) {
        for (const p of CAPTURE_PATHS) {
          if (!existsSync(p)) continue;
          if (p.endsWith(".json")) {
            try {
              const j = JSON.parse(readFileSync(p, "utf8"));
              for (const b of j.bytecodes ?? j.mainBytecodes ?? []) {
                push(b, `file:${p}`);
              }
              if (j.mainBytecode) push(j.mainBytecode, `file:${p}`);
            } catch {
              /* ignore */
            }
          } else {
            push(readFileSync(p, "utf8").trim(), `file:${p}`);
          }
        }
      } else {
        rejected.push({
          source: "captures/*",
          reason: "skipped-no-runtime",
          hint: "importez un dump Chrome: npm run import:vm-dump -- <json>",
        });
      }

      VmMainBytecodeResolver.#walkInit(anchor?.initPayload, (raw, path) =>
        push(raw, path),
      );
    }

    if (allowStatic) {
      const assets = VmMainBytecodeResolver.#loadAssets();
      if (assets) {
        candidates.push({
          bytecode: assets.bytecode,
          raw: assets.raw,
          source: "assets:main_bytecode.txt",
          fromCapture: false,
          score: VmMainBytecodeResolver.#scoreMain(assets.bytecode, configInner, {
            tag: "assets",
          }),
        });
      }
    } else if (!hasRuntime) {
      rejected.push({
        source: "assets:main_bytecode.txt",
        reason: "static-asset-disabled",
        hint: "RECAPTCHA_ALLOW_STATIC_MAIN=1 pour forcer l'asset Rust",
      });
    }

    const ranked = candidates
      .filter((c) => c.bytecode?.length > 4096 && c.score > 0)
      .sort((a, b) => b.score - a.score);

    const best = ranked[0] ?? null;
    return {
      bytecode: best?.bytecode ?? null,
      raw: best?.raw ?? null,
      source: best?.source ?? null,
      score: best?.score ?? 0,
      runtimeOnly: hasRuntime && !allowStatic,
      hasRuntimeBytecodes: hasRuntime,
      rejected: rejected.slice(0, 8),
      candidates: ranked.slice(0, 6).map((c) => ({
        source: c.source,
        score: c.score,
        bytecodeLen: c.bytecode.length,
        staticAsset: VmMainBytecodeResolver.isStaticAssetDecodedLen(c.bytecode.length),
      })),
    };
  }

  static #walkInit(payload, onString, path = "init") {
    if (typeof payload === "string" && payload.length > 5000) {
      onString(payload, path);
      return;
    }
    if (Array.isArray(payload)) {
      for (let i = 0; i < payload.length; i++) {
        VmMainBytecodeResolver.#walkInit(payload[i], onString, `${path}[${i}]`);
      }
    }
  }

  static #decodeCandidates(raw, keys) {
    const out = [];
    const trimmed = raw.trim();

    const tryPush = (buf, tag) => {
      if (!buf?.length) return;
      const bytecode = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
      out.push({ bytecode, raw: trimmed, tag });
    };

    try {
      tryPush(decodeBytecode(trimmed), "b64-6");
    } catch {
      /* ignore */
    }

    for (const shift of [8, 4]) {
      try {
        tryPush(decodeBase64Custom(trimmed, shift), `b64-${shift}`);
      } catch {
        /* ignore */
      }
    }

    if (keys?.length) {
      try {
        const { inner } = decryptConfigWithKeyCandidates(trimmed, keys);
        if (inner?.length > 8000) {
          tryPush(Buffer.from(inner, "latin1"), "config-decrypt");
        }
      } catch {
        /* ignore */
      }
    }

    return out;
  }

  static #scoreMain(bytecodeBuf, configInner, { tag = "", fromCapture = false } = {}) {
    const bytecode =
      typeof bytecodeBuf === "string"
        ? bytecodeBuf
        : Buffer.from(bytecodeBuf).toString("latin1");
    let score = scoreInnerBytecode(bytecode);
    if (!score) return 0;

    const len = bytecode.length;
    if (VmMainBytecodeResolver.isStaticAssetDecodedLen(len) && !fromCapture) {
      return 0;
    }
    if (len > 70_000) score += 200;
    else if (len > 55_000) score += 140;
    else if (len > 40_000) score += 80;
    else if (len < 35_000) score -= 120;

    try {
      const dis = new VmDisassembler(bytecode);
      if (configInner?.length) {
        const cfg = new VmDisassembler(configInner);
        cfg.dispatch();
        dis.charset = [...cfg.charset];
        dis.registers = new Map(cfg.registers);
      }
      dis.dispatch();
      const sends = dis.instructions.filter((i) => i.op === "SEND").length;
      if (len > 50_000) {
        score += sends * 2;
        if (sends >= 20) score += 30;
      }
    } catch {
      score *= 0.5;
    }

    if (tag === "config-decrypt") score -= 200;
    if (fromCapture && len > 50_000) score += 100;
    if (fromCapture && len > 70_000) score += 80;

    return score;
  }

  static #loadAssets() {
    const path = join(
      process.cwd(),
      "recaptcha-vm-main",
      "assets",
      "main_bytecode.txt",
    );
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf8").trim();
    const bytecode = decodeBytecode(raw);
    return { raw, bytecode };
  }

  /** Persiste le meilleur blob capturé pour le mode JS pur. */
  static saveCapture(raw, { path = CAPTURE_PATHS[0], meta = {} } = {}) {
    if (!raw || typeof raw !== "string") return null;
    const trimmed = raw.trim();
    let decodedLen = 0;
    try {
      decodedLen = decodeBytecode(trimmed).length;
    } catch {
      /* ignore */
    }
    if (VmMainBytecodeResolver.isStaticAssetDecodedLen(decodedLen)) {
      throw new Error(
        `Refus saveCapture: blob statique Rust (${STATIC_MAIN_DECODED_LEN} octets décodés)`,
      );
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, trimmed, "utf8");
    const metaPath = join(process.cwd(), "captures", "vm-runtime.json");
    writeFileSync(
      metaPath,
      JSON.stringify(
        {
          savedAt: new Date().toISOString(),
          mainBytecode: trimmed,
          bytecodes: [trimmed],
          decodedLen,
          runtime: true,
          ...meta,
        },
        null,
        2,
      ),
      "utf8",
    );
    return path;
  }
}
