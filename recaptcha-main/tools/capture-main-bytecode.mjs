#!/usr/bin/env node
/**
 * Capture le bytecode MAIN via JSDOM (Main.execute) et le sauve dans captures/.
 *
 *   npm run capture:main-bytecode
 *   node tools/capture-main-bytecode.mjs --legacy   (anchor seul, sans iframe TM)
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { AnchorParser } from "../api/AnchorParser.js";
import { AnchorVmRunner, installAsyncGuard } from "../api/vm/AnchorVmRunner.js";
import { ParentAnchorVmRunner } from "../api/vm/ParentAnchorVmRunner.js";
import { VmMainBytecodeResolver } from "../api/vm/VmMainBytecodeResolver.js";
import { resolveConfigBytecode } from "../api/vm/VmConfigBytecode.js";
import { VmBytecodeRunner } from "../api/vm/VmBytecodeRunner.js";
import { BrowserSimulator } from "../api/vm/BrowserSimulator.js";

const htmlPath =
  process.argv.find((a) => a.startsWith("--html="))?.split("=")[1] ??
  join(process.cwd(), "captures", "anchor-sample.html");

const useLegacy = process.argv.includes("--legacy");

installAsyncGuard();

async function captureLive() {
  const { Config } = await import("../api/Config.js");
  const { HttpClient } = await import("../api/HttpClient.js");
  const { CallbackGenerator } = await import("../api/CallbackGenerator.js");
  const { EnterpriseBootstrapParser } = await import("../api/EnterpriseBootstrapParser.js");

  const cfg = Config.fromEnv({
    siteKey: "6LdoaXQrAAAAADQviABd-eByJu6kPL8awKDyc1zb",
    enterprise: true,
    action: "login",
  });
  const h = cfg.googleHeaders();
  const bootJs = await HttpClient.fetchText(
    `https://www.google.com/recaptcha/enterprise.js?render=${cfg.siteKey}`,
    h,
  );
  const bootstrap = EnterpriseBootstrapParser.parse(bootJs);
  const anchorUrl = cfg.buildAnchorUrl({
    apiBase: bootstrap.apiBase,
    version: bootstrap.version,
    cb: CallbackGenerator.generate(),
  });
  const anchorHtml = await HttpClient.fetchText(anchorUrl, h);
  const anchor = AnchorParser.parse(anchorHtml);

  process.env.RECAPTCHA_VM_CAPTURE_MS =
    process.env.RECAPTCHA_VM_CAPTURE_MS || "25000";
  process.env.RECAPTCHA_JSDOM_VM_MAX_MS =
    process.env.RECAPTCHA_JSDOM_VM_MAX_MS || "45000";
  process.env.RECAPTCHA_ANCHOR_EXECUTE_WAIT_MS =
    process.env.RECAPTCHA_ANCHOR_EXECUTE_WAIT_MS || "20000";

  const runner = useLegacy ? AnchorVmRunner : ParentAnchorVmRunner;
  const mode = useLegacy ? "anchor seul" : "parent+iframe TM";
  console.log(`Mode capture: ${mode}`);

  const vm = await runner.run({
    cfg,
    bootstrap,
    anchor,
    anchorHtml,
    anchorUrl,
    headers: h,
    onLog: (s, d) => console.log(`[${s}]`, d),
  });

  return { anchor, vmDump: vm.vmDump, vmAnalysis: vm.vmAnalysis, bodyLen: vm.body?.length };
}

async function main() {
  let anchor;
  let vmDump = null;
  let bodyLen = 0;

  if (existsSync(htmlPath) && !process.argv.includes("--live")) {
    console.log("HTML local:", htmlPath);
    anchor = AnchorParser.parse(readFileSync(htmlPath, "utf8"));
  } else {
    console.log("Capture live anchor + Main.execute…");
    const live = await captureLive();
    anchor = live.anchor;
    vmDump = live.vmDump;
    bodyLen = live.bodyLen ?? 0;
  }

  const bcFromDump = (vmDump?.bytecodes ?? []).filter((b) => b?.length > 8000);
  console.log(
    "\n___vmDump:",
    `bytecodes=${bcFromDump.length}`,
    `sends=${vmDump?.sends?.length ?? 0}`,
    `05AL=${vmDump?.last05AL ? "oui" : "non"}`,
    `reloadBody=${bodyLen}b`,
    `executeType=${vmDump?.executeType ?? "?"}`,
  );

  const resolved = resolveConfigBytecode(anchor);
  const pick = VmMainBytecodeResolver.resolve({
    anchor,
    vmDump,
    vmBytecodeKeys: anchor.config?.vmBytecodeKeys,
    configInner: resolved?.inner,
  });

  if (pick.rejected?.length) {
    console.log("\nRejetés (resolver):");
    for (const r of pick.rejected) {
      console.log(`  ${r.source}: ${r.reason}${r.hint ? ` — ${r.hint}` : ""}`);
    }
  }

  console.log("\nCandidats MAIN:");
  for (const c of pick.candidates.slice(0, 6)) {
    const tag = c.staticAsset ? " [STATIC]" : "";
    console.log(`  ${c.source} → ${c.bytecodeLen}b score=${c.score}${tag}`);
  }

  const runtimeRaw =
    bcFromDump.sort((a, b) => b.length - a.length)[0] ?? null;

  if (!runtimeRaw) {
    console.error(
      "\nAucun bytecode MAIN runtime dans ___vmDump.",
      "\nEssayer: $env:RECAPTCHA_PARENT_GEXECUTE='1'; npm run capture:main-bytecode",
      "\nOu: npm run dump:vm puis extraire bytecodes du JSON dumps/",
    );
    process.exit(1);
  }

  const out = VmMainBytecodeResolver.saveCapture(runtimeRaw);
  console.log("\nSauvegardé (runtime):", out);

  const { env } = BrowserSimulator.createEnvironment({
    origin: "https://auth.ticketmaster.com",
  });
  const run = VmBytecodeRunner.analyze(anchor, anchor.encryptionKey, {
    env,
    vmDump: { bytecodes: [runtimeRaw] },
  });
  console.log(
    "Rejeu pur:",
    `source=${run.mainExec?.mainBytecodeSource}`,
    `SEND=${run.sends.length}`,
    `max=${Math.max(0, ...run.sends.map((s) => s.length))}`,
    `05AL=${run.token05AL?.length ?? 0}`,
    `runtimeSEND=${run.mainExec?.runtimeSends ?? 0}`,
  );
  env.close?.();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
