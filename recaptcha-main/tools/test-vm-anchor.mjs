#!/usr/bin/env node
/**
 * Diagnostic VM anchor (api2 / enterprise) — sans fallback flat.
 *
 *   RECAPTCHA_TLS_INSECURE=1 node tools/test-vm-anchor.mjs
 *   RECAPTCHA_TLS_INSECURE=1 node tools/test-vm-anchor.mjs --enterprise
 */
import { Config } from "../api/Config.js";
import { HttpClient } from "../api/HttpClient.js";
import { CallbackGenerator } from "../api/CallbackGenerator.js";
import { EnterpriseBootstrapParser } from "../api/EnterpriseBootstrapParser.js";
import { AnchorParser } from "../api/AnchorParser.js";
import { AnchorVmRunner } from "../api/vm/AnchorVmRunner.js";
import { decryptConfigWithKeyCandidates } from "../api/vm/VmBytecodeKeys.js";
import { scoreInnerBytecode } from "../api/vm/VmBytecodeValidator.js";
import { VmDisassembler } from "../api/vm/VmDisassembler.js";

const enterprise = process.argv.includes("--enterprise");

const siteKey = "6LdoaXQrAAAAADQviABd-eByJu6kPL8awKDyc1zb";
const cfg = Config.fromEnv({
  siteKey,
  enterprise,
  mode: enterprise ? "enterprise" : "api2",
  action: "login",
});
const h = cfg.googleHeaders();

console.log("=== Test VM anchor ===");
console.log("mode:", cfg.mode, "| enterprise:", cfg.enterprise);

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

console.log("\n--- Anchor HTTP ---");
console.log("token:", anchor.anchorToken?.length, "chars");
console.log("encryptionKey:", anchor.encryptionKey);
console.log("configBytecode:", anchor.configBytecode?.length, "chars");
console.log("vmKeys:", JSON.stringify(anchor.config?.vmBytecodeKeys));

const bg = anchor.initPayload?.[1];
console.log("bgdata[4]:", bg?.[4]?.length ?? 0, "chars");

console.log("\n--- Déchiffrement config VM ---");
for (const raw of [anchor.configBytecode, bg?.[4]].filter(Boolean)) {
  try {
    const { inner, seed, keys, quality } = decryptConfigWithKeyCandidates(
      raw,
      [[176, 170, 107], [76], ...(anchor.config?.vmBytecodeKeys ?? [])],
    );
    const dis = new VmDisassembler(inner);
    dis.dispatch();
    const enc = dis.parseEncryption();
    console.log({
      rawLen: raw.length,
      seed,
      keys,
      innerLen: inner.length,
      quality,
      score: scoreInnerBytecode(inner),
      instructions: dis.instructions.length,
      sends: dis.collectSends().length,
      enc586: enc.encryptionKey,
    });
  } catch (e) {
    console.log("fail", raw.length, e.message.slice(0, 80));
  }
}

console.log("\n--- JSDOM VM (pas de fallback) ---");
process.env.RECAPTCHA_ALLOW_FLAT_FALLBACK = "0";
process.env.RECAPTCHA_ANCHOR_VM_PARENT = "0";

const t0 = Date.now();
try {
  const vm = await AnchorVmRunner.run({
    cfg,
    bootstrap,
    anchor,
    anchorHtml,
    anchorUrl,
    headers: h,
    onLog: (a, b) => console.log(`  [${a}] ${b}`),
  });
  console.log("\n--- Résultat VM ---");
  console.log(JSON.stringify({
    ms: Date.now() - t0,
    bodyLen: vm.body?.length ?? 0,
    source: vm.secondarySource,
    executeType: vm.vmDump?.executeType,
    sends: vm.sendCount,
    errors: vm.errors,
  }, null, 2));
  if ((vm.body?.length ?? 0) < 8000) {
    process.exitCode = 1;
  }
} catch (e) {
  console.error("\nÉCHEC VM:", e.message);
  process.exitCode = 1;
}
