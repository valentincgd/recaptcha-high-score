#!/usr/bin/env node
/**
 * Décode un fichier reload protobuf → body.txt (outil debug, hors API).
 *
 *   node tools/decode-reload-to-body.mjs chemin/reload.bin body.txt
 */
import { join } from "node:path";
import { ReloadProtobufDecoder } from "../api/level2/ReloadProtobufDecoder.js";

const templatePath = process.argv[2];
const outPath = process.argv[3] ?? join(process.cwd(), "body.txt");

if (!templatePath) {
  console.error("Usage: node tools/decode-reload-to-body.mjs <fichier.bin> [body.txt]");
  process.exit(1);
}

const { decoded, outPath: written } = ReloadProtobufDecoder.writeBodyTxt(
  templatePath,
  outPath,
);

console.log(`Décodé → ${written}`);
console.log(
  `  champs: ${Object.keys(decoded.fields).length} | signaux f16: ${
    decoded.fields[16]?.decryptedSignals?.length ?? 0
  }`,
);
