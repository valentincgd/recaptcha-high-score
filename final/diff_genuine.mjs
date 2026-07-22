/**
 * diff_genuine.mjs — compare les 2 reloads GENUINE entre eux (slots dynamiques vs statiques par session).
 * Les slots qui DIFFERENT entre 2 runs genuine = a regenerer ; les STABLES = garder du template.
 */
import { readFileSync } from "fs";
import { Field16Builder } from "./api/vm/Field16Builder.js";
import { decodeSignalAuto } from "./api/vm/PerSignalCipher.js";

const CAP = "C:/Users/Valentin/AppData/Local/Temp/claude/C--Users-Valentin-Desktop-recaptcha-high-score/56d2f254-3735-4ce5-a15e-d9d6e34e728f/scratchpad/browser/reload_full_capture.json";

function pbFields(buf) {
  const out = {}; let i = 0;
  const rv = () => { let s = 0, r = 0n; while (i < buf.length) { const b = buf[i++]; r |= BigInt(b & 0x7f) << BigInt(s); if (!(b & 0x80)) break; s += 7; } return r; };
  while (i < buf.length) {
    const key = Number(rv()); const fn = key >> 3, wt = key & 7; if (fn === 0) break;
    if (wt === 0) { const v = rv(); (out[fn] ??= []).push(v); }
    else if (wt === 2) { const len = Number(rv()); const val = buf.slice(i, i + len); i += len; (out[fn] ??= []).push(val); }
    else if (wt === 5) { (out[fn] ??= []).push(buf.readUInt32LE(i)); i += 4; }
    else if (wt === 1) i += 8; else break;
  }
  return out;
}
function slots(field16Str) {
  return Field16Builder.decode(field16Str).map((s) => {
    if (Array.isArray(s) && typeof s[0] === "string") { let d = null; try { d = decodeSignalAuto(s[0], s[1]); } catch (_) {} return d && d.value !== undefined ? d.value : d; }
    return s;
  });
}

const caps = JSON.parse(readFileSync(CAP, "utf8"));
const xv = caps.filter((r) => /6Lcv/.test(r.k || ""));
console.log("reloads XV genuine:", xv.length);
if (xv.length < 2) { console.log("besoin de 2 reloads XV"); process.exit(0); }

const A = slots(pbFields(Buffer.from(xv[0].reqB64, "base64"))[16].toString("latin1"));
const B = slots(pbFields(Buffer.from(xv[1].reqB64, "base64"))[16].toString("latin1"));
const actA = pbFields(Buffer.from(xv[0].reqB64, "base64"))[8]?.[0]?.toString("latin1");
const actB = pbFields(Buffer.from(xv[1].reqB64, "base64"))[8]?.[0]?.toString("latin1");
console.log(`genuine#1 action=${actA} slots=${A.length} | genuine#2 action=${actB} slots=${B.length}\n`);

const dyn = [], stat = [];
for (let i = 0; i < Math.max(A.length, B.length); i++) {
  const a = JSON.stringify(A[i]), b = JSON.stringify(B[i]);
  if (a !== b) dyn.push(i); else if (A[i] != null) stat.push(i);
}
console.log("SLOTS DYNAMIQUES (varient entre 2 genuine, a regenerer):", dyn.join(","));
console.log("\nSLOTS STABLES (identiques, garder du template):", stat.join(","));
console.log("\n=== detail dynamiques ===");
for (const i of dyn) console.log(`  [${i}] #1=${(JSON.stringify(A[i]) || "").slice(0, 44)}  #2=${(JSON.stringify(B[i]) || "").slice(0, 44)}`);
