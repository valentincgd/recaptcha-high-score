/**
 * decrypt_diff.mjs — decrypte le field16 GENUINE (capture browser) et le compare au flat (LoginPage XV).
 * Usage: node decrypt_diff.mjs [chemin_reload_full_capture.json]
 */
import { readFileSync } from "fs";
import { Field16Builder } from "./api/vm/Field16Builder.js";
import { Field16Collector } from "./api/vm/Field16Collector.js";
import { Field16Cipher } from "./api/vm/Field16Cipher.js";
import { decodeSignalAuto } from "./api/vm/PerSignalCipher.js";
import { pickFingerprint } from "./index.mjs";

const CAP = process.argv[2] || "C:/Users/Valentin/AppData/Local/Temp/claude/C--Users-Valentin-Desktop-recaptcha-high-score/56d2f254-3735-4ce5-a15e-d9d6e34e728f/scratchpad/browser/reload_full_capture.json";

// --- protobuf : extraire un champ (wire type 2 = bytes) par numero ---
function pbField(buf, fieldNum) {
  let i = 0;
  const rv = () => { let s = 0, r = 0n; while (i < buf.length) { const b = buf[i++]; r |= BigInt(b & 0x7f) << BigInt(s); if (!(b & 0x80)) break; s += 7; } return r; };
  while (i < buf.length) {
    const key = Number(rv()); const fn = key >> 3, wt = key & 7;
    if (fn === 0) break;
    if (wt === 0) rv();
    else if (wt === 2) { const len = Number(rv()); const val = buf.slice(i, i + len); i += len; if (fn === fieldNum) return val; }
    else if (wt === 5) i += 4;
    else if (wt === 1) i += 8;
    else break;
  }
  return null;
}

function decodeSlots(field16Str) {
  const slots = Field16Builder.decode(field16Str); // [ [enc,key,timing] | raw | null ]
  return slots.map((s) => {
    if (Array.isArray(s) && s.length >= 2 && typeof s[0] === "string") {
      let dec = null; try { dec = decodeSignalAuto(s[0], s[1]); } catch (_) {}
      return { enc: s[0].slice(0, 10), key: s[1], timing: s[2], val: dec && dec.value !== undefined ? dec.value : dec };
    }
    return { raw: s };
  });
}

// 1) GENUINE — ZB login (le token du corps sign-in)
const caps = JSON.parse(readFileSync(CAP, "utf8"));
const gen = caps.find((r) => /6Ldo/.test(r.k || ""));
if (!gen) { console.log("pas de reload ZB genuine"); process.exit(1); }
const genBuf = Buffer.from(gen.reqB64, "base64");
const genF16buf = pbField(genBuf, 16);
const genAction = pbField(genBuf, 8)?.toString("latin1");
console.log("=== GENUINE (ZB action=" + genAction + ") === reload", genBuf.length, "b | field16", genF16buf ? genF16buf.length : 0, "b");
const genF16 = genF16buf.toString("latin1");
let genSlots;
try { genSlots = decodeSlots(genF16); } catch (e) { console.log("decode genuine KO:", e.message); process.exit(1); }
console.log("genuine slots:", genSlots.length);

// 2) FLAT (meme contexte : XV enterprise LoginPage sur auth.ticketmaster.com)
const profile = pickFingerprint({ id: "chrome150_win11_nvidia_rtx3060" });
const col = new Field16Collector();
// flat ZB login (siteKey 6Ldo, action login, signin=true) — meme contexte que le genuine ZB
const built = col.build({ profile, anchorToken: "03AFcWeATEST", version: "A7KpaEASfhDcK0nXxgQEyyYv", origin: "https://auth.ticketmaster.com", now: Date.now(), DC: Date.now(), signin: true });
const flatSlots = decodeSlots(built.field16);
console.log("flat slots:   ", flatSlots.length);

// 3) DIFF slot par slot (valeurs decodees)
console.log("\n=== DIFF slot-par-slot (genuine vs flat) ===");
const n = Math.max(genSlots.length, flatSlots.length);
let diffs = 0;
for (let i = 0; i < n; i++) {
  const g = genSlots[i], f = flatSlots[i];
  const gv = g ? JSON.stringify(g.val !== undefined ? g.val : g.raw) : "MANQUE";
  const fv = f ? JSON.stringify(f.val !== undefined ? f.val : f.raw) : "MANQUE";
  const same = gv === fv;
  if (!same) { diffs++; console.log(`  [${i}] G=${(gv || "").slice(0, 48)}  F=${(fv || "").slice(0, 48)}`); }
}
console.log(`\n${diffs} slots differents / ${n}`);
