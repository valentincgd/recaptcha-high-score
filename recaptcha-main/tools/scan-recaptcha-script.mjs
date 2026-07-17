#!/usr/bin/env node
/**
 * Scan recaptcha__fr.js (minifié) — repères utiles, pas une désobfuscation complète.
 *
 *   node tools/scan-recaptcha-script.mjs
 *   node tools/scan-recaptcha-script.mjs --url https://www.gstatic.com/.../recaptcha__fr.js
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { HttpClient } from "../api/HttpClient.js";
import { VmScriptLoader } from "../api/vm/VmScriptLoader.js";

const urlArg = process.argv.find((a) => a.startsWith("--url="))?.split("=")[1];

let source;
let from = "cache";
if (urlArg) {
  source = await HttpClient.fetchText(urlArg, {});
  from = urlArg;
} else {
  const { source: s } = await VmScriptLoader.fetchRecaptchaBundle({
    scriptUrl:
      "https://www.gstatic.com/recaptcha/releases/hsFBb1u5wWWWkWP4in1ua2cQ/recaptcha__fr.js",
    headers: {},
  });
  source = s;
}

const patterns = [
  ["recaptcha.anchor.Main.init", /recaptcha\.anchor\.Main\.init/g],
  ["recaptcha.anchor.Main.execute", /recaptcha\.anchor\.Main\.execute/g],
  ["05AL token prefix", /05AL[A-Za-z0-9_-]{20}/g],
  ["grecaptcha.enterprise.execute", /grecaptcha\.enterprise\.execute/g],
  ["POST reload path", /\/recaptcha\/[^"']+\/reload/g],
  ["opcode SEND (minified rare)", /\bSEND\b/g],
  ["register 586 / encryption", /R586|,586,/g],
];

const report = {
  source: from,
  bytes: source.length,
  lines: source.split("\n").length,
  hits: {},
};

for (const [name, re] of patterns) {
  const m = source.match(re);
  report.hits[name] = m ? Math.min(m.length, 20) : 0;
  if (m?.length) report[`sample_${name}`] = m.slice(0, 3).map((x) => x.slice(0, 120));
}

console.log(JSON.stringify(report, null, 2));

const out = join(process.cwd(), "dumps", `recaptcha-script-scan-${Date.now()}.json`);
mkdirSync(join(process.cwd(), "dumps"), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 2), "utf8");
console.log("\nRapport:", out);

console.log(`
Note: recaptcha__fr.js n'est pas "chiffré" — il est packé/obfusqué (webpack).
Babel/beautify ne révèle pas la VM. recaptcha-vm-main cible le BYTECODE dans anchor (config + main runtime).
`);
