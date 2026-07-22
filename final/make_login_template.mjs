/**
 * make_login_template.mjs — fige la capture genuine LoginPage (XV) en template de payload pour le tmpt.
 * Sauve : field16 raw (encrypted), slots decodes, action, + classification stable/dynamique.
 * Sortie : api/vm/field16_login_template.json
 */
import { readFileSync, writeFileSync } from "fs";
import { Field16Builder } from "./api/vm/Field16Builder.js";
import { decodeSignalAuto } from "./api/vm/PerSignalCipher.js";

const CAP = "C:/Users/Valentin/AppData/Local/Temp/claude/C--Users-Valentin-Desktop-recaptcha-high-score/56d2f254-3735-4ce5-a15e-d9d6e34e728f/scratchpad/browser/reload_full_capture.json";
const OUT = "./api/vm/field16_login_template.json";

function pbField(buf, fieldNum) {
  let i = 0;
  const rv = () => { let s = 0, r = 0n; while (i < buf.length) { const b = buf[i++]; r |= BigInt(b & 0x7f) << BigInt(s); if (!(b & 0x80)) break; s += 7; } return r; };
  while (i < buf.length) {
    const key = Number(rv()); const fn = key >> 3, wt = key & 7; if (fn === 0) break;
    if (wt === 0) rv();
    else if (wt === 2) { const len = Number(rv()); const val = buf.slice(i, i + len); i += len; if (fn === fieldNum) return val; }
    else if (wt === 5) i += 4; else if (wt === 1) i += 8; else break;
  }
  return null;
}

const caps = JSON.parse(readFileSync(CAP, "utf8"));
const buffers = caps.filter((r) => /6Lcv/.test(r.k || "")).map((r) => Buffer.from(r.reqB64, "base64"));
// action de chaque
const actionOf = (buf) => pbField(buf, 8)?.toString("latin1");
const login = buffers.find((b) => actionOf(b) === "LoginPage") || buffers[0];
const f16buf = pbField(login, 16);
const f16 = f16buf.toString("latin1");
const rawSlots = Field16Builder.decode(f16);
const decoded = rawSlots.map((s) => {
  if (Array.isArray(s) && typeof s[0] === "string") { let d = null; try { d = decodeSignalAuto(s[0], s[1]); } catch (_) {} return { type: "signal", enc: s[0], key: s[1], timing: s[2], value: d && d.value !== undefined ? d.value : d }; }
  return { type: "raw", value: s };
});

const tmpl = {
  source: "genuine XV LoginPage (nodriver capture)", action: "LoginPage",
  field16_raw: f16,                 // field16 chiffre genuine (reference)
  slots: decoded,                    // slots decodes (valeur, key, timing)
  // classification (2 genuine LoginPage vs pageView) : STABLES = garder, DYNAMIQUES = regenerer
  stable: [4, 17, 27, 28, 29, 33, 40, 45, 47, 52, 53, 56, 60, 61, 65, 67, 70, 72],
  dynamic: [5, 16, 18, 30, 31, 32, 34, 35, 36, 37, 38, 39, 41, 42, 44, 46, 49, 50, 51, 54, 55, 57, 58, 59, 62, 63, 64, 66, 68, 69, 71, 73, 75, 78],
};
writeFileSync(OUT, JSON.stringify(tmpl, null, 1));
console.log("template ecrit:", OUT);
console.log("action:", tmpl.action, "| slots:", decoded.length, "| field16_raw:", f16.length, "o");
console.log("\nslots STABLES (valeurs a garder) :");
for (const i of tmpl.stable) console.log(`  [${i}] = ${JSON.stringify(decoded[i]?.value).slice(0, 55)}`);
