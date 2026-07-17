#!/usr/bin/env node
/**
 * Dump + analyse VM reCAPTCHA (JSDOM + désassembleur config bytecode).
 *
 *   node tools/dump-vm.mjs
 *   node tools/dump-vm.mjs --site-key 6LdoaXQrAAAAADQviABd-eByJu6kPL8awKDyc1zb
 */

import { VmDumper } from "../api/vm/VmDumper.js";

const siteKey =
  process.argv.find((a) => a.startsWith("--site-key="))?.split("=")[1] ??
  "6LdoaXQrAAAAADQviABd-eByJu6kPL8awKDyc1zb";

const ignoreAsync = (err) => {
  const msg = String(err?.message ?? err);
  return (
    msg.includes("Timed out") ||
    msg.includes("postMessage") ||
    msg.includes("Cannot read properties of null")
  );
};
process.on("uncaughtException", (err) => {
  if (ignoreAsync(err)) return;
});
process.on("unhandledRejection", (err) => {
  if (ignoreAsync(err)) return;
});

console.log("Dump VM — siteKey", siteKey.slice(0, 12) + "…");
const { dump, report, paths } = await VmDumper.dumpAndAnalyze({ siteKey });

console.log("\n=== Résumé ===");
console.log(JSON.stringify(report.summary, null, 2));
console.log("\n=== Recommandations ===");
for (const r of report.recommendations) console.log(" -", r);
console.log("\nFichiers:");
console.log(" ", paths.json);
console.log(" ", paths.report);
if (dump.bytecode?.encryptionKey) {
  console.log("\nencryptionKey VM:", dump.bytecode.encryptionKey);
}
if (dump.script?.enterpriseReady) {
  console.log("grecaptcha.enterprise.execute: OK");
}
