/**
 * extract_zb_plaintext.mjs — extrait le field16 PLAINTEXT genuine (ZB login) depuis la capture,
 * en brute-forcant (d+A) mod 256 via le prefixe connu. Sauve api/vm/field16_zb_plaintext.json.
 * Ce plaintext (contenu genuine) sera re-chiffre avec le DC de l'anchor flat pour le token ZB login.
 */
import { readFileSync, writeFileSync } from "fs";

const CAP = "C:/Users/Valentin/AppData/Local/Temp/claude/C--Users-Valentin-Desktop-recaptcha-high-score/56d2f254-3735-4ce5-a15e-d9d6e34e728f/scratchpad/browser/reload_full_capture.json";

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
// base64url -> bytes
function b64uDec(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Buffer.from(s, "base64"); }

const caps = JSON.parse(readFileSync(CAP, "utf8"));
const zb = caps.find((r) => /6Ldo/.test(r.k || ""));
const f16 = pbField(Buffer.from(zb.reqB64, "base64"), 16).toString("latin1");
// field16 = "0" + base64url(C) ; C = [A, ...cipher]
if (f16[0] !== "0") { console.log("prefixe inattendu:", f16[0]); }
const C = b64uDec(f16.slice(1));
const A = C[0], len = C.length - 1;
const PREFIX = '[null,null,null,null,"';
// D[i] = (C[i+1] - len - (dA)*(i+A)) mod 256 ; brute dA=(d+A)%256 in 0..255
let plaintext = null, foundDA = null;
for (let dA = 0; dA < 256; dA++) {
  let ok = true; let s = "";
  for (let i = 0; i < PREFIX.length; i++) {
    const Di = (((C[i + 1] - len - (dA * (i + A))) % 256) + 256) % 256;
    if (Di !== PREFIX.charCodeAt(i)) { ok = false; break; }
    s += String.fromCharCode(Di);
  }
  if (ok) {
    // decode tout
    let full = "";
    for (let i = 0; i < len; i++) { const Di = (((C[i + 1] - len - (dA * (i + A))) % 256) + 256) % 256; full += String.fromCharCode(Di); }
    plaintext = full; foundDA = dA; break;
  }
}
if (!plaintext) { console.log("brute-force echoue"); process.exit(1); }
console.log("(d+A)%256 =", foundDA, "| plaintext", plaintext.length, "o");
// valider JSON
let arr; try { arr = JSON.parse(plaintext); console.log("JSON OK, slots:", arr.length); } catch (e) { console.log("JSON KO:", e.message, "| head:", plaintext.slice(0, 80)); }
writeFileSync("./api/vm/field16_zb_plaintext.json", JSON.stringify({ source: "genuine ZB login", plaintext }, null, 0));
console.log("sauve -> api/vm/field16_zb_plaintext.json");
console.log("head:", plaintext.slice(0, 120));
