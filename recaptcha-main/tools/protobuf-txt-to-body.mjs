#!/usr/bin/env node
/**
 * Fusionne protobuf.txt (export manuel) + fichier .bin → body.txt
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ReloadProtobufDecoder } from "../api/level2/ReloadProtobufDecoder.js";

const txtPath = process.argv[2] ?? join(process.cwd(), "protobuf.txt");
const binPath = process.argv[3];
if (!binPath) {
  console.error("Usage: node tools/protobuf-txt-to-body.mjs [protobuf.txt] <fichier.bin>");
  process.exit(1);
}
const outPath = process.argv[4] ?? join(process.cwd(), "body.txt");

const manual = readFileSync(txtPath, "utf8");
const { decoded } = ReloadProtobufDecoder.writeBodyTxt(binPath, outPath);

let extra = "\n\n# --- Référence manuelle (protobuf.txt) ---\n\n";
for (const line of manual.split(/\r?\n/)) {
  const m = line.match(/^(\d+):\s*(.*)$/);
  if (!m) continue;
  const n = Number(m[1]);
  const binField = decoded.fields[n];
  extra += `## protobuf.txt champ ${n}\n`;
  extra += `${m[2]}\n`;
  if (binField?.role && binField.role !== "unknown") {
    extra += `(reload.bin: ${binField.role}`;
    if (binField.value && String(binField.value) !== m[2].slice(0, 80)) {
      extra += " — valeur différente de la capture binaire actuelle";
    }
    extra += ")\n";
  }
  extra += "\n";
}

writeFileSync(outPath, readFileSync(outPath, "utf8") + extra);
console.log(`body.txt mis à jour (${outPath})`);
