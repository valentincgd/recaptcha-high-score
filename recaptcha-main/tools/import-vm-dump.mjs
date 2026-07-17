#!/usr/bin/env node
/**
 * Importe un dump Chrome (___vmDump / DevTools) vers captures/.
 *
 *   node tools/import-vm-dump.mjs dumps/chrome-vm.json
 *   node tools/import-vm-dump.mjs --stdin < chrome-export.json
 *   Get-Content chrome.json | node tools/import-vm-dump.mjs --stdin
 *
 * Formats acceptés :
 *   { "bytecodes": ["<b64>", …] }
 *   { "mainBytecode": "<b64>" }
 *   { "___vmDump": { "bytecodes": […] } }
 *   [ "<b64>", … ]  (tableau seul)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { VmMainBytecodeResolver } from "../api/vm/VmMainBytecodeResolver.js";

/** Reload enterprise TM valide souvent ~4–5 ko (pas les ~12 ko du flat builder / JSDOM). */
const TM_RELOAD_MIN_BYTES = Number(process.env.RECAPTCHA_TM_RELOAD_MIN_BYTES) || 2000;
const TM_05AL_LEN = 1276;
import { decodeBytecode } from "../api/vm/BytecodeDecoder.js";
import { VmDisassembler } from "../api/vm/VmDisassembler.js";

const args = process.argv.slice(2);
const useStdin = args.includes("--stdin");
const dryRun = args.includes("--dry-run");
const filePath = args.find((a) => !a.startsWith("--"));

function readInput() {
  if (useStdin) {
    return readFileSync(0, "utf8");
  }
  if (!filePath) {
    console.error(
      "Usage: node tools/import-vm-dump.mjs <fichier.json> | --stdin",
      "\n  (fichier .txt = une ligne base64 brute)",
    );
    process.exit(1);
  }
  if (!existsSync(filePath)) {
    console.error("Fichier introuvable:", filePath);
    process.exit(1);
  }
  return readFileSync(filePath, "utf8");
}

function extractBytecodes(parsed) {
  if (Array.isArray(parsed)) {
    return parsed.filter((b) => typeof b === "string" && b.length > 1000);
  }
  const root = parsed?.___vmDump ?? parsed?.vmDump ?? parsed;
  const list = [];
  if (typeof root?.mainBytecode === "string") list.push(root.mainBytecode);
  if (typeof parsed?.mainBytecode === "string") list.push(parsed.mainBytecode);
  for (const b of root?.bytecodes ?? parsed?.bytecodes ?? parsed?.mainBytecodes ?? []) {
    if (typeof b === "string" && b.length > 1000) list.push(b);
  }
  return [...new Set(list)];
}

function analyzeRaw(raw) {
  let decodedLen = 0;
  let sends = 0;
  try {
    const buf = decodeBytecode(raw.trim());
    decodedLen = buf.length;
    const dis = new VmDisassembler(buf.toString("latin1"));
    dis.dispatch();
    sends = dis.instructions.filter((i) => i.op === "SEND").length;
  } catch (e) {
    return { decodedLen: 0, sends: 0, error: e.message };
  }
  return { decodedLen, sends, isStatic: VmMainBytecodeResolver.isStaticAssetDecodedLen(decodedLen) };
}

async function main() {
  const text = readInput().trim();
  let bytecodes;
  if (filePath && !useStdin && !filePath.endsWith(".json") && !text.startsWith("{") && !text.startsWith("[")) {
    bytecodes = [text];
  } else {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      console.error("JSON invalide:", e.message);
      process.exit(1);
    }
    bytecodes = extractBytecodes(parsed);
  }
  const root = (() => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  })();
  const dump = root?.___vmDump ?? root?.vmDump ?? root;
  const token05 =
    dump?.last05AL ??
    (dump?.sends ?? []).find((s) => String(s).startsWith("05AL"));
  const reloadLen = dump?.lastReloadLen ?? 0;
  const reloadBodyB64 = dump?.lastReloadBodyB64 ?? root?.lastReloadBodyB64 ?? null;
  const captureSiteKey =
    dump?.captureSiteKey ??
    (dump?.lastReloadUrl?.match(/[?&]k=([^&]+)/) || [])[1] ??
    null;
  const encryptionKey =
    dump?.encryptionKey ?? root?.encryptionKey ?? root?.templateEncryptionKey ?? null;

  function saveReloadTemplate(bodyBuf) {
    const slug = (captureSiteKey ?? "6LcvL3Ur").slice(0, 8);
    const binPath = join(process.cwd(), "captures", `reload-${slug}.bin`);
    mkdirSync(join(process.cwd(), "captures"), { recursive: true });
    writeFileSync(binPath, bodyBuf);
    const meta = {
      siteKey: captureSiteKey,
      reloadBytes: bodyBuf.length,
      importedAt: new Date().toISOString(),
      source: "chrome-vm-capture",
      templateEncryptionKey: encryptionKey ?? undefined,
      encryptionKey: encryptionKey ?? undefined,
    };
    writeFileSync(
      join(process.cwd(), "captures", "reload-template-meta.json"),
      JSON.stringify(meta, null, 2),
      "utf8",
    );
    if (encryptionKey != null) {
      writeFileSync(
        join(process.cwd(), "captures", "tm-session.json"),
        JSON.stringify(
          {
            templateEncryptionKey: encryptionKey,
            encryptionKey,
            capturedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        "utf8",
      );
    }
    return binPath;
  }

  if (reloadBodyB64 && typeof reloadBodyB64 === "string" && reloadBodyB64.length > 1000) {
    try {
      const bodyBuf = Buffer.from(reloadBodyB64.replace(/\s/g, ""), "base64");
      if (bodyBuf.length >= TM_RELOAD_MIN_BYTES) {
        const binPath = saveReloadTemplate(bodyBuf);
        console.log("\nReload template Chrome:", binPath, `(${bodyBuf.length} o)`);
        if (encryptionKey != null) {
          console.log("  encryptionKey template:", encryptionKey);
        }
      }
    } catch (e) {
      console.warn("  lastReloadBodyB64 ignoré:", e.message);
    }
  }

  if (!bytecodes.length) {
    if (token05 || reloadLen > 0) {
      const partialPath = join(process.cwd(), "captures", "vm-runtime.json");
      mkdirSync(join(process.cwd(), "captures"), { recursive: true });
      const reloadOk = reloadLen >= TM_RELOAD_MIN_BYTES;
      const tokenOk =
        token05 &&
        token05.length >= TM_05AL_LEN - 20 &&
        token05.length <= TM_05AL_LEN + 20;
      const payload = {
        savedAt: new Date().toISOString(),
        partial: true,
        tmCaptureValid: !!(tokenOk && reloadOk),
        sends: dump?.sends ?? (token05 ? [token05] : []),
        last05AL: token05 ?? null,
        lastReloadLen: reloadLen,
        lastReloadUrl: dump?.lastReloadUrl ?? null,
        lastReloadBodyB64: reloadBodyB64 ?? null,
        captureSiteKey,
        encryptionKey: encryptionKey ?? null,
        reloadBytes: reloadBodyB64
          ? Buffer.from(String(reloadBodyB64).replace(/\s/g, ""), "base64").length
          : reloadLen,
        bytecodes: [],
        note:
          "Capture Chrome TM valide (05AL + reload enterprise). Bytecode MAIN optionnel (webworker).",
      };
      if (!dryRun) writeFileSync(partialPath, JSON.stringify(payload, null, 2), "utf8");
      console.log("\nImport TM (capture navigateur):", partialPath);
      console.log(
        `  05AL: ${token05?.length ?? 0} car.${tokenOk ? " ✓" : ""}`,
        `| reload: ${reloadLen} o${reloadOk ? " ✓ (enterprise TM normal)" : ""}`,
      );
      if (tokenOk && reloadOk) {
        console.log(
          "%c  → Valide pour Ticketmaster (reload direct Google, pas besoin de 12 ko).",
          "color:#0d652d",
        );
      }
      console.log(
        "\nOptionnel (interpréteur VM pur): bytecodes[] via contexte webworker.js + re-login.",
      );
      process.exit(tokenOk || reloadOk ? 0 : 1);
    }
    console.error(
      "Aucun bytecode ni 05AL. Clés attendues: bytecodes[], sends[], last05AL",
    );
    process.exit(1);
  }

  console.log(`Entrées: ${bytecodes.length} blob(s)`);
  const ranked = bytecodes
    .map((raw, i) => ({ raw, i, ...analyzeRaw(raw) }))
    .sort((a, b) => b.decodedLen - a.decodedLen);

  for (const r of ranked) {
    const tag = r.isStatic ? " [ASSET STATIQUE — ignoré pour import]" : "";
    console.log(
      `  [${r.i}] decoded=${r.decodedLen}b SEND=${r.sends}${r.error ? ` err=${r.error}` : ""}${tag}`,
    );
  }

  const best = ranked.find((r) => r.decodedLen > 8000 && !r.isStatic) ?? ranked[0];
  if (best.isStatic) {
    console.error(
      "\nRefus: seul le blob statique Rust (78464 octets décodés) détecté.",
      "Recapturez depuis Chrome pendant Main.execute (pas assets/main_bytecode.txt).",
    );
    process.exit(1);
  }

  if (dryRun) {
    console.log("\n--dry-run: rien écrit.");
    process.exit(0);
  }

  const out = VmMainBytecodeResolver.saveCapture(best.raw, {
    meta: {
      importedAt: new Date().toISOString(),
      decodedLen: best.decodedLen,
      sends: best.sends,
      captureSiteKey:
        dump?.captureSiteKey ??
        (dump?.lastReloadUrl?.match(/[?&]k=([^&]+)/) || [])[1] ??
        null,
      lastReloadUrl: dump?.lastReloadUrl ?? null,
      lastReloadLen: dump?.lastReloadLen ?? 0,
    },
  });
  console.log("\nImporté:", out);
  console.log(`  decoded=${best.decodedLen}b SEND=${best.sends}`);

  const pick = VmMainBytecodeResolver.resolve({
    vmDump: { bytecodes: [best.raw] },
  });
  console.log(
    `Resolver: source=${pick.source} score=${pick.score} runtimeOnly=${pick.runtimeOnly}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
