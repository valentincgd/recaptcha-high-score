#!/usr/bin/env node
/**
 * Inventaire complet VM / reload / anchor (local + live optionnel).
 *   node tools/discover-all-vm.mjs
 *   node tools/discover-all-vm.mjs --live --api2
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { AnchorParser } from "../api/AnchorParser.js";
import { VmDisassembler } from "../api/vm/VmDisassembler.js";
import { decryptConfigWithKeyCandidates } from "../api/vm/VmBytecodeKeys.js";
import { resolveConfigBytecode } from "../api/vm/VmConfigBytecode.js";
import { VmBytecodeRunner } from "../api/vm/VmBytecodeRunner.js";
import { decodeBytecode } from "../api/vm/BytecodeDecoder.js";
import { VmMainBytecode } from "../api/vm/VmMainBytecode.js";
import { COLLECTOR_SIGNAL_KEYS } from "../api/vm/VmSignalCatalog.js";
import { VmRustCatalog, VM_OPCODES } from "../api/vm/VmRustCatalog.js";
import { ReloadProtobufDecoder } from "../api/level2/ReloadProtobufDecoder.js";
import { ProtobufWire } from "../api/ProtobufWire.js";

const live = process.argv.includes("--live");
const api2 = process.argv.includes("--api2");

const report = {
  generatedAt: new Date().toISOString(),
  sources: [],
  anchorLocal: null,
  anchorLive: null,
  assets: {},
  protobufReference: null,
  collectors: { keys: COLLECTOR_SIGNAL_KEYS },
  rustCatalog: VmRustCatalog.loadFromDisassembledTxt(),
  vmOpcodes: VM_OPCODES,
  codebase: {},
  gaps: [],
};

function section(title, data) {
  report.sources.push({ title, ...data });
}

// --- anchor-sample.html ---
const anchorPath = join(process.cwd(), "captures", "anchor-sample.html");
if (existsSync(anchorPath)) {
  const html = readFileSync(anchorPath, "utf8");
  const anchor = AnchorParser.parse(html);
  const resolved = resolveConfigBytecode(anchor);
  const vmRun = VmBytecodeRunner.analyze(anchor, anchor.encryptionKey);

  let innerDis = null;
  if (resolved?.inner) {
    const dis = new VmDisassembler(resolved.inner);
    dis.dispatch();
    innerDis = {
      instructions: dis.instructions.length,
      encryption: dis.parseEncryption(),
      sends: dis.collectSends(),
      opcodeHistogram: histogram(dis.instructions.map((i) => i.op)),
    };
  }

  const init = anchor.initPayload;
  const bg = Array.isArray(init)
    ? init.find((x) => Array.isArray(x) && x[0] === "bgdata")
    : null;

  report.anchorLocal = {
    anchorTokenLen: anchor.anchorToken?.length,
    encryptionKey: anchor.encryptionKey,
    configBytecodeLen: anchor.configBytecode?.length,
    conf23Len: anchor.configBytecode?.length,
    bgdata4Len: bg?.[4]?.length ?? 0,
    vmBytecodeKeys: anchor.config?.vmBytecodeKeys,
    collectorIndexes: anchor.config?.collectorIndexes,
    bftLen: anchor.config?.bftSignature?.length,
    resolvedConfig: resolved
      ? {
          score: resolved.score,
          innerLen: resolved.inner?.length,
          seed: resolved.seed,
          keys: resolved.keys,
        }
      : null,
    vmRun: {
      encryptionKey: vmRun.encryptionKey,
      signalKeys: vmRun.signalKeys,
      sendCount: vmRun.sends.length,
      sendsPreview: vmRun.sends.slice(0, 8).map((s) => ({
        len: String(s).length,
        head: String(s).slice(0, 72),
        is05AL: String(s).startsWith("05AL"),
      })),
      token05AL: vmRun.token05AL ? `${vmRun.token05AL.length} chars` : null,
      exec: vmRun.exec,
    },
    disassembly: innerDis,
  };
  section("anchor-sample.html", { path: anchorPath });
}

// --- recaptcha-vm-main assets ---
for (const name of ["config_bytecode.txt", "main_bytecode.txt"]) {
  const p = join(process.cwd(), "recaptcha-vm-main", "assets", name);
  if (!existsSync(p)) continue;
  const raw = readFileSync(p, "utf8").trim();
  try {
    const bytecode = decodeBytecode(raw);
    const dis = new VmDisassembler(bytecode);
    dis.dispatch();
    const enc = dis.parseEncryption();
    const sends = dis.collectSends();
    report.assets[name] = {
      rawLen: raw.length,
      bytecodeLen: bytecode.length,
      instructions: dis.instructions.length,
      encryptionKeyReg586: enc.encryptionKey,
      signalKeys: enc.signalKeys,
      signalKeyCount: enc.signalKeys.length,
      sendCount: sends.length,
      sends05AL: sends.filter((s) => String(s).startsWith("05AL")).length,
      sendsLong: sends.filter((s) => String(s).length > 200).length,
      opcodeHistogram: histogram(dis.instructions.map((i) => i.op)),
      sendSamples: sends.slice(0, 5).map((s) => String(s).slice(0, 100)),
    };
  } catch (e) {
    report.assets[name] = { error: e.message };
  }
}

const mainRef = VmMainBytecode.loadFromAssets();
if (mainRef) {
  report.assets.main_loaded = {
    size: mainRef.size,
    sendCount: mainRef.sends?.length,
    signalKeys: mainRef.encryption?.signalKeys?.length,
  };
}

// --- protobuf.txt reference ---
const protoPath = join(process.cwd(), "protobuf.txt");
if (existsSync(protoPath)) {
  const lines = readFileSync(protoPath, "utf8").split(/\r?\n/);
  const fields = {};
  for (const line of lines) {
    const m = line.match(/^(\d+):\s*(.*)$/);
    if (m) fields[m[1]] = { len: m[2].length, preview: m[2].slice(0, 60) };
  }
  report.protobufReference = fields;
}

// --- Live anchor ---
if (live) {
  try {
    const { Config } = await import("../api/Config.js");
    const { HttpClient } = await import("../api/HttpClient.js");
    const { CallbackGenerator } = await import("../api/CallbackGenerator.js");
    const { EnterpriseBootstrapParser } = await import("../api/EnterpriseBootstrapParser.js");

    const cfg = Config.fromEnv({
      siteKey: "6LdoaXQrAAAAADQviABd-eByJu6kPL8awKDyc1zb",
      enterprise: !api2,
      mode: api2 ? "api2" : "enterprise",
      action: "login",
    });
    const h = cfg.googleHeaders();
    const bootUrl = api2
      ? `https://www.google.com/recaptcha/api.js?render=${cfg.siteKey}`
      : `https://www.google.com/recaptcha/enterprise.js?render=${cfg.siteKey}`;
    const bootJs = await HttpClient.fetchText(bootUrl, h);
    const bootstrap = EnterpriseBootstrapParser.parse(bootJs);
    const anchorUrl = cfg.buildAnchorUrl({
      apiBase: bootstrap.apiBase,
      version: bootstrap.version,
      cb: CallbackGenerator.generate(),
    });
    const html = await HttpClient.fetchText(anchorUrl, h);
    const anchor = AnchorParser.parse(html);
    const vmRun = VmBytecodeRunner.analyze(anchor, anchor.encryptionKey);
    report.anchorLive = {
      mode: api2 ? "api2" : "enterprise",
      encryptionKey: anchor.encryptionKey,
      anchorTokenLen: anchor.anchorToken?.length,
      signalKeys: vmRun.signalKeys,
      sends: vmRun.sends.length,
      token05AL: !!vmRun.token05AL,
      collectorIndexes: anchor.config?.collectorIndexes,
      bgdata4: resolveConfigBytecode(anchor)?.inner?.length,
    };
    section("anchor live", { url: anchorUrl });
  } catch (e) {
    report.anchorLive = { error: e.message };
  }
}

// --- Gaps checklist ---
report.gaps = [
  {
    id: "main-bytecode-runtime",
    status: "missing",
    detail: "Bytecode MAIN construit à l'exécution — assets/main_bytecode.txt = référence statique seulement",
  },
  {
    id: "vm-interpreter-window",
    status: "partial",
    detail: "GET_WINDOW_PROP / CALL_METHOD / HASH non exécutés — seulement LOAD_CONST + SEND rejoués",
  },
  {
    id: "05AL",
    status: report.anchorLocal?.vmRun?.token05AL ? "found-config" : "synthetic",
    detail: "05AL ~1276c produit par MAIN runtime ou SecondaryTokenGenerator",
  },
  {
    id: "reload-size",
    status: "partial",
    detail: "Cible navigateur ~12–20 ko ; pur JS ~6–9 ko sans main VM",
  },
  {
    id: "opcodes-total",
    status: "documented",
    detail: "42 opcodes, ~36–38 utilisés (recaptcha-vm-main README)",
  },
];

report.codebase = {
  purePipeline: [
    "api/vm/BrowserSimulator.js",
    "api/vm/PureBrowserEnvironment.js",
    "api/vm/VmBytecodeRunner.js",
    "api/vm/VmSignalMapper.js",
    "api/vm/EnterpriseSignalStream.js",
    "api/vm/VmPureReloadBuilder.js",
    "api/level2/SignalEncryptor.js",
  ],
  jsdomCapture: [
    "api/vm/AnchorVmRunner.js",
    "api/vm/ParentAnchorVmRunner.js",
    "api/vm/NetworkCapture.js",
    "api/fresh/IdenticalReload.js",
  ],
  rustReference: [
    "recaptcha-vm-main/src/disassembler/disassemble.rs",
    "recaptcha-vm-main/src/encryption/parse.rs",
    "recaptcha-vm-main/src/encryption/mod.rs",
    "recaptcha-vm-main/src/bytecode/mod.rs",
  ],
  tools: [
    "tools/discover-all-vm.mjs",
    "tools/disassemble-anchor-vm.mjs",
    "tools/dump-vm.mjs",
    "tools/test-vm-anchor.mjs",
    "tools/test-fingerprint-profiles.mjs",
    "tools/decode-reload-to-body.mjs",
    "tools/compare-reload.mjs",
  ],
};

function histogram(ops) {
  const h = {};
  for (const o of ops) h[o] = (h[o] ?? 0) + 1;
  return Object.fromEntries(
    Object.entries(h).sort((a, b) => b[1] - a[1]),
  );
}

const outJson = join(process.cwd(), "dumps", "vm-discovery-report.json");
const outMd = join(process.cwd(), "dumps", "VM-DISCOVERY.md");
mkdirSync(join(process.cwd(), "dumps"), { recursive: true });
writeFileSync(outJson, JSON.stringify(report, null, 2), "utf8");

const md = renderMarkdown(report);
writeFileSync(outMd, md, "utf8");

console.log(md);
console.log("\nÉcrit:", outJson);
console.log("Écrit:", outMd);

function renderMarkdown(r) {
  const lines = [
    "# Inventaire VM reCAPTCHA — tout trouvé",
    "",
    `Généré: ${r.generatedAt}`,
    "",
    "## Pipeline JS pur (repo)",
    "",
    ...r.codebase.purePipeline.map((p) => `- \`${p}\``),
    "",
    "## Capture navigateur",
    "",
    ...r.codebase.jsdomCapture.map((p) => `- \`${p}\``),
    "",
    "## Référence Rust",
    "",
    ...r.codebase.rustReference.map((p) => `- \`${p}\``),
    "",
    "## Outils CLI",
    "",
    ...r.codebase.tools.map((p) => `- \`${p}\``),
    "",
  ];

  if (r.anchorLocal) {
    const a = r.anchorLocal;
    lines.push("## Anchor local (`captures/anchor-sample.html`)", "");
    lines.push(`| Champ | Valeur |`);
    lines.push(`|-------|--------|`);
    lines.push(`| anchorToken | ${a.anchorTokenLen} chars |`);
    lines.push(`| encryptionKey | ${a.encryptionKey} |`);
    lines.push(`| conf bytecode | ${a.configBytecodeLen} chars |`);
    lines.push(`| bgdata[4] | ${a.bgdata4Len} chars |`);
    lines.push(`| vmBytecodeKeys | ${JSON.stringify(a.vmBytecodeKeys)} |`);
    lines.push(`| collectorIndexes conf[7] | ${JSON.stringify(a.collectorIndexes)} |`);
    if (a.resolvedConfig) {
      lines.push(`| inner bytecode | ${a.resolvedConfig.innerLen} o (score ${a.resolvedConfig.score}) |`);
    }
    if (a.vmRun) {
      lines.push(`| signalKeys VM | ${a.vmRun.signalKeys?.length ?? 0} |`);
      lines.push(`| SEND payloads | ${a.vmRun.sendCount} |`);
      lines.push(`| 05AL dans config | ${a.vmRun.token05AL ?? "non"} |`);
    }
    if (a.disassembly?.encryption) {
      lines.push(`| reg 586 (parse.rs) | ${a.disassembly.encryption.encryptionKey} |`);
      lines.push(`| signalKeys reg "1" | ${a.disassembly.encryption.signalKeys?.slice(0, 24).join(", ")}${a.disassembly.encryption.signalKeys?.length > 24 ? "…" : ""} |`);
    }
    lines.push("");
  }

  for (const [name, data] of Object.entries(r.assets)) {
    if (name === "main_loaded" || data.error) continue;
    lines.push(`## Asset \`${name}\``, "");
    lines.push(`- bytecode: ${data.bytecodeLen} octets, ${data.instructions} instructions`);
    lines.push(`- encryptionKey reg 586: **${data.encryptionKeyReg586}**`);
    lines.push(`- signalKeys: **${data.signalKeyCount}** — ${(data.signalKeys || []).slice(0, 20).join(", ")}`);
    lines.push(`- SEND: ${data.sendCount} (05AL: ${data.sends05AL}, long: ${data.sendsLong})`);
    lines.push(`- opcodes: ${JSON.stringify(data.opcodeHistogram)}`);
    lines.push("");
  }

  if (r.anchorLive) {
    lines.push("## Anchor live", "");
    lines.push("```json");
    lines.push(JSON.stringify(r.anchorLive, null, 2));
    lines.push("```", "");
  }

  if (r.rustCatalog) {
    lines.push("## Catalogue Rust (`disassembled.txt`)", "");
    lines.push(`- instructions: ~${r.rustCatalog.instructionLines} lignes`);
    lines.push(`- signalKeys (LOAD_CONST \"1\"): **${r.rustCatalog.signalKeys.length}**`);
    lines.push(`- ${r.rustCatalog.signalKeys.join(", ")}`);
    lines.push(`- SEND sites: ${r.rustCatalog.sendSites}`);
    lines.push(`- encryptionKey exemple reg 586: ${r.rustCatalog.encryptionKeyExample}`);
    lines.push("");
  }
  lines.push("## Signal keys README", "");
  lines.push("`[417, 727, 545, 779, 659, 959, 895, 1092, 41, 43, 549, 352]`");
  lines.push("");
  lines.push("## Collecteurs actuels (`Collectors.js`)", "");
  lines.push(COLLECTOR_SIGNAL_KEYS.join(", "));
  lines.push("");
  lines.push("## Lacunes pour 100 % byte-identique", "");
  for (const g of r.gaps) {
    lines.push(`- **${g.id}** (${g.status}): ${g.detail}`);
  }
  lines.push("");
  lines.push("## Champs protobuf reload (référence)", "");
  if (r.protobufReference) {
    for (const [n, v] of Object.entries(r.protobufReference)) {
      lines.push(`- **${n}**: ${v.len} chars — \`${v.preview}…\``);
    }
  }
  return lines.join("\n");
}
