import { readFileSync } from "node:fs";
import { ProtobufWire } from "../api/ProtobufWire.js";

const ANCHOR_RE = /^03AFcWeA[A-Za-z0-9_-]+/;

function analyze(path) {
  const buf = readFileSync(path);
  const fields = ProtobufWire.decodeMessage(buf);
  const out = { path, bytes: buf.length, fields: {} };
  for (const f of fields) {
    if (f.wireType === 0) out.fields[`f${f.fieldNumber}`] = f.value;
    if (f.wireType === 2) {
      const s = f.value.toString("utf8");
      if (f.fieldNumber === 2) {
        const m = s.match(ANCHOR_RE);
        out.fields.f2_total = s.length;
        out.fields.f2_anchor = m?.[0] ?? null;
        out.fields.f2_anchor_len = m?.[0]?.length ?? 0;
        out.fields.f2_suffix_preview = JSON.stringify(
          s.slice(m?.[0]?.length ?? 0, (m?.[0]?.length ?? 0) + 40),
        );
      } else {
        out.fields[`f${f.fieldNumber}`] =
          s.length > 80 ? `${s.slice(0, 60)}… (${s.length})` : s;
      }
    }
  }
  return out;
}

const a = process.argv[2];
if (!a) {
  console.error("Usage: node tools/compare-reload.mjs <fichier-a.bin> [fichier-b.bin]");
  process.exit(1);
}
const b = process.argv[3] || "captures/reload-new.bin";
const A = analyze(a);
const B = analyze(b);

console.log("===", A.path, "===\n", JSON.stringify(A, null, 2));
console.log("\n===", B.path, "===\n", JSON.stringify(B, null, 2));

if (A.fields.f2_anchor && B.fields.f2_anchor) {
  let i = 0;
  const sa = A.fields.f2_anchor;
  const sb = B.fields.f2_anchor;
  while (i < sa.length && i < sb.length && sa[i] === sb[i]) i++;
  console.log("\n--- anchor prefix commun ---", i, "car.");
  console.log("ancien anchor:", sa.slice(0, 48) + "…");
  console.log("nouveau anchor:", sb.slice(0, 48) + "…");
}

console.log(
  "\nΔ taille fichier:",
  B.bytes - A.bytes,
  "octets | Δ champ2:",
  B.fields.f2_total - A.fields.f2_total,
);
