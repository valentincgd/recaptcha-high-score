import { readFileSync } from "node:fs";
import { ProtobufWire } from "../api/ProtobufWire.js";

function decodeAll(buf, maxFields = 20) {
  const out = [];
  let offset = 0;
  while (offset < buf.length && out.length < maxFields) {
    const slice = buf.subarray(offset);
    const fields = ProtobufWire.decodeMessage(slice);
    if (!fields.length) break;
    const f = fields[0];
    let size = 1;
    // estimate consumed bytes by re-encoding
    if (f.wireType === 0) {
      size = ProtobufWire.writeInt32(f.fieldNumber, f.value).length;
    } else if (f.wireType === 2) {
      size = ProtobufWire.writeBytes(f.fieldNumber, f.value).length;
    }
    out.push({
      field: f.fieldNumber,
      wire: f.wireType,
      len: f.wireType === 2 ? f.value.length : f.value,
      off: offset,
      preview:
        f.wireType === 2
          ? f.value.toString("utf8").slice(0, 48)
          : String(f.value),
    });
    offset += size;
  }
  return out;
}

const binPath = process.argv[2];
if (!binPath) {
  console.error("Usage: node tools/decode-field7-walk.mjs <fichier.bin>");
  process.exit(1);
}
const field2 = ProtobufWire.decodeMessage(readFileSync(binPath)).find(
  (f) => f.fieldNumber === 2,
).value;
const anchor = field2.toString("latin1").match(/^03AFcWeA[A-Za-z0-9_-]+/)[0];
const f7 = ProtobufWire.decodeMessage(field2.subarray(anchor.length)).find(
  (f) => f.fieldNumber === 7,
).value;

const loginAt = f7.indexOf(Buffer.from([0x42, 0x05]));
console.log("=== depuis login ===");
for (const row of decodeAll(f7.subarray(loginAt), 15)) {
  console.log(row);
}
