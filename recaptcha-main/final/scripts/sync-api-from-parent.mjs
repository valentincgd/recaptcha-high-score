#!/usr/bin/env node
/**
 * Recopie api/ + assets VM depuis le dépôt parent (à lancer depuis final/).
 *   node scripts/sync-api-from-parent.mjs
 */
import { cpSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const FINAL = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = join(FINAL, "..");

const copies = [
  { from: join(ROOT, "api"), to: join(FINAL, "api") },
  {
    from: join(ROOT, "recaptcha-vm-main", "assets", "main_bytecode.txt"),
    to: join(FINAL, "recaptcha-vm-main", "assets", "main_bytecode.txt"),
  },
];

for (const { from, to } of copies) {
  if (!existsSync(from)) {
    console.warn("skip (absent):", from);
    continue;
  }
  if (from.endsWith("api")) {
    rmSync(to, { recursive: true, force: true });
    mkdirSync(dirname(to), { recursive: true });
  } else {
    mkdirSync(dirname(to), { recursive: true });
  }
  cpSync(from, to, { recursive: from.endsWith("api") });
  console.log("copied", from, "→", to);
}

console.log("OK — réappliquer les imports ./api/ dans TmAltTokenService.mjs si besoin.");
