/**
 * Décode un fichier .bin capturé (body reload).
 *   node tools/decode-protobuf.mjs chemin/fichier.bin
 */

import { readFileSync } from "node:fs";
import { decodeProtobufMessage } from "../api.mjs";

const path = process.argv[2];
if (!path) {
  console.error("Usage: node tools/decode-protobuf.mjs <fichier.bin>");
  process.exit(1);
}

const buf = readFileSync(path);
for (const f of decodeProtobufMessage(buf)) {
  if (f.wireType === 2) {
    const s = f.value.toString("utf8");
    const preview =
      s.length > 120 ? `${s.slice(0, 120)}… (${s.length} chars)` : s;
    console.log(`field ${f.fieldNumber}: ${preview}`);
  } else {
    console.log(`field ${f.fieldNumber} varint: ${f.value}`);
  }
}
