import { readFileSync } from "node:fs";
import { ProtobufWire } from "../api/ProtobufWire.js";

const binPath = process.argv[2];
if (!binPath) {
  console.error("Usage: node tools/decode-field7.mjs <fichier.bin>");
  process.exit(1);
}
const field2 = ProtobufWire.decodeMessage(readFileSync(binPath)).find(
  (f) => f.fieldNumber === 2,
).value;
const anchor = field2.toString("latin1").match(/^03AFcWeA[A-Za-z0-9_-]+/)[0];
const rest = field2.subarray(anchor.length);
const f7 = ProtobufWire.decodeMessage(rest).find((f) => f.fieldNumber === 7).value;

const loginTag = Buffer.from([0x42, 0x05]);
const idx = f7.indexOf(loginTag);
console.log("f7 len", f7.length, "login idx", idx);
console.log("prefix token", f7.subarray(0, idx).toString("utf8").slice(0, 60) + "…");

const fields = ProtobufWire.decodeMessage(f7.subarray(idx));
for (const f of fields) {
  if (f.wireType === 2) {
    const t = f.value.toString("utf8");
    console.log(
      `f${f.fieldNumber}`,
      t.length > 120 ? `${t.slice(0, 80)}… (${t.length})` : t,
    );
  } else {
    console.log(`f${f.fieldNumber}`, "varint", f.value);
  }
}
