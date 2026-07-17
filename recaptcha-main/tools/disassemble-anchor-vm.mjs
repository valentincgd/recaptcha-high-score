#!/usr/bin/env node
/**
 * Désassemble le bytecode **config** extrait de GET anchor (pas recaptcha__fr.js entier).
 * Port Node de recaptcha-vm-main — le bytecode **main** est construit à l'exécution.
 *
 *   node tools/disassemble-anchor-vm.mjs
 *   node tools/disassemble-anchor-vm.mjs --out dumps/anchor-disasm.txt
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { HttpClient } from "../api/HttpClient.js";
import { Config } from "../api/Config.js";
import { CallbackGenerator } from "../api/CallbackGenerator.js";
import { EnterpriseBootstrapParser } from "../api/EnterpriseBootstrapParser.js";
import { AnchorParser } from "../api/AnchorParser.js";
import { VmDisassembler } from "../api/vm/VmDisassembler.js";
import { decryptConfigWithKeyCandidates } from "../api/vm/VmBytecodeKeys.js";

const siteKey =
  process.argv.find((a) => a.startsWith("--site-key="))?.split("=")[1] ??
  "6LdoaXQrAAAAADQviABd-eByJu6kPL8awKDyc1zb";
const outArg = process.argv.find((a) => a.startsWith("--out="))?.split("=")[1];
const enterprise = !process.argv.includes("--api2");

const cfg = Config.fromEnv({
  siteKey,
  enterprise,
  mode: enterprise ? "enterprise" : "api2",
  action: "login",
});
const h = cfg.googleHeaders();

console.log("=== Anchor VM config disassembler ===");
console.log("siteKey:", siteKey);
console.log("mode:", enterprise ? "enterprise" : "api2");

const bootUrl = enterprise
  ? `https://www.google.com/recaptcha/enterprise.js?render=${siteKey}`
  : `https://www.google.com/recaptcha/api.js?render=${siteKey}`;
const bootJs = await HttpClient.fetchText(bootUrl, h);
const bootstrap = EnterpriseBootstrapParser.parse(bootJs);
const anchorUrl = cfg.buildAnchorUrl({
  apiBase: bootstrap.apiBase,
  version: bootstrap.version,
  cb: CallbackGenerator.generate(),
});
const anchorHtml = await HttpClient.fetchText(anchorUrl, h);
const anchor = AnchorParser.parse(anchorHtml);

if (!anchor.configBytecode) {
  console.error("Pas de configBytecode dans anchor — impossible de désassembler.");
  process.exit(1);
}

const keys = anchor.config?.vmBytecodeKeys ?? [[176, 170, 107], [76]];
let decrypted;
let inner;
let seed;
let usedKeys;
try {
  ({ decrypted, inner, seed, keys: usedKeys } = decryptConfigWithKeyCandidates(
    anchor.configBytecode,
    keys,
  ));
} catch (err) {
  console.error("Déchiffrement config VM:", err.message);
  console.error(
    "Le format anchor a peut‑être changé — encryptionKey session:",
    anchor.encryptionKey,
  );
  process.exit(1);
}
console.log("encryptionKey anchor:", anchor.encryptionKey);
console.log("VM seed xor_fold:", seed, "keys:", JSON.stringify(usedKeys));
console.log("config decrypted:", decrypted.length, "o | inner bytecode:", inner.length, "o");

const dis = new VmDisassembler(inner, { showInstructions: true });
try {
  dis.dispatch();
} catch (err) {
  console.error("Désassemblage interrompu:", err.message);
  process.exit(1);
}

const sends = dis.collectSends();
const enc = dis.parseEncryption();
console.log("\n--- Résumé VM config ---");
console.log("instructions:", dis.instructions.length);
console.log("encryptionKey (reg 586):", enc.encryptionKey ?? anchor.encryptionKey);
console.log("signalKeys:", enc.signalKeys?.length ?? 0);
console.log("SEND payloads:", sends.length);
for (const s of sends.slice(0, 3)) {
  const preview = String(s).slice(0, 80);
  console.log("  SEND:", preview, s.length > 80 ? "…" : "");
}
const al05 = sends.find((s) => String(s).startsWith("05AL"));
if (al05) console.log("05AL trouvé dans config:", al05.slice(0, 60) + "…");
else console.log("05AL: absent du config (normal — vient du bytecode MAIN runtime)");

const lines = dis.instructions.slice(0, 500).map((i) => {
  const off = (i.offset ?? 0).toString(16).padStart(4, "0");
  return `0x${off}: ${i.op} ${JSON.stringify(i).slice(0, 100)}`;
});
const header = [
  `# Disassembly config bytecode — ${new Date().toISOString()}`,
  `# anchor ${anchorUrl}`,
  `# Ne pas confondre avec recaptcha__fr.js (JS obfusqué ~800k lignes)`,
  "",
].join("\n");
const body = header + lines.join("\n") + `\n\n# … ${dis.instructions.length - lines.length} instructions omitted\n`;

const outPath =
  outArg ?? join(process.cwd(), "dumps", `anchor-config-disasm-${Date.now()}.txt`);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, body, "utf8");
console.log("\nÉcrit:", outPath);
