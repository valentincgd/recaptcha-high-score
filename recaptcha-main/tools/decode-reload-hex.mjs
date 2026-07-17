#!/usr/bin/env node
/**
 * Décode un POST /reload depuis un dump hex (Charles, xxd, CyberChef…).
 *
 *   node tools/decode-reload-hex.mjs reload.hex.txt
 *   node tools/decode-reload-hex.mjs --stdin < paste.txt
 *   Get-Content reload.hex | node tools/decode-reload-hex.mjs --stdin
 *
 * Formats acceptés :
 *   00000000  0a 18 54 6e 41 37 …  |ascii|
 *   0a18546e4137… (hex continu)
 *   0a 18 54 6e (hex espacé)
 */

import { readFileSync, existsSync } from "node:fs";
import { ProtobufWire } from "../api/ProtobufWire.js";
import { ReloadStructure } from "../api/level2/ReloadStructure.js";
import { ReloadProtobufDecoder } from "../api/level2/ReloadProtobufDecoder.js";
import { SignalEncryptor } from "../api/level2/SignalEncryptor.js";
import { VmHttpSolver } from "../api/level2/VmHttpSolver.js";

const ANCHOR_RE = /^03AFcWeA[A-Za-z0-9_-]+/;
const RE_05AL = /05AL[A-Za-z0-9_-]{200,1276}/;
const LOGIN_TAG = Buffer.from([0x42, 0x05]);
const SIGNAL_KEYS = [417, 1641, 1310, 352, 360, 1628, 16, 34, 31, 3553, 291, 4, 5, 32, 1626];

const args = process.argv.slice(2);
const useStdin = args.includes("--stdin");
const jsonOut = args.includes("--json");
const keyIdx = args.indexOf("--key");
const encKeyArg = keyIdx >= 0 ? Number(args[keyIdx + 1]) : null;
const filePath = args.find((a) => !a.startsWith("--") && (keyIdx < 0 || a !== args[keyIdx + 1]));

/** Parse dump hex style Charles / xxd / brut (ignore colonne ASCII). */
export function parseHexDump(text) {
  const trimmed = String(text).trim();
  if (!trimmed) return Buffer.alloc(0);

  const lines = trimmed.split(/\r?\n/);
  const hasDumpLines = lines.some((l) =>
    /^[0-9a-fA-F]{4,16}[:\s]/i.test(l.trim()),
  );

  // Hex continu pur (sans offsets de dump)
  if (
    !hasDumpLines &&
    /^[0-9a-fA-F\s]+$/.test(trimmed.replace(/\s/g, ""))
  ) {
    const hex = trimmed.replace(/\s/g, "");
    if (hex.length % 2 !== 0) throw new Error("hex impair — octet manquant");
    return Buffer.from(hex, "hex");
  }

  const bytes = [];
  for (const rawLine of lines) {
    bytes.push(...parseHexDumpLine(rawLine));
  }

  if (!bytes.length) throw new Error("aucun octet hex détecté");
  return Buffer.from(bytes);
}

/** Une ligne Charles / xxd — s'arrête avant la colonne ASCII. */
function parseHexDumpLine(rawLine) {
  let line = rawLine.trim();
  if (!line || line.startsWith("#") || line.startsWith("//")) return [];

  const pipe = line.indexOf("|");
  if (pipe >= 0) line = line.slice(0, pipe).trim();

  // Offset : 00000000  ou 00000000:
  line = line.replace(/^[0-9a-fA-F]{4,16}:?\s+/, "").trim();
  if (!line) return [];

  // Colonne hex avant double-espace (Charles)
  const hexSection = line.split(/\s{2,}/)[0].trim();
  const out = [];

  for (const token of hexSection.split(/\s+/)) {
    if (/^[0-9a-fA-F]{2}$/i.test(token)) {
      out.push(parseInt(token, 16));
      continue;
    }
    // Bloc compact sans espaces : 0a18546e…
    if (/^[0-9a-fA-F]+$/i.test(token) && token.length % 2 === 0) {
      for (let i = 0; i < token.length; i += 2) {
        out.push(parseInt(token.slice(i, i + 2), 16));
      }
      continue;
    }
    // Premier token non-hex → colonne ASCII (ex. TnA7…)
    break;
  }
  return out;
}

/** Protobuf complet — ne s'arrête pas au premier wire type inconnu. */
function decodeMessageFull(buf) {
  const fields = [];
  let offset = 0;
  while (offset < buf.length) {
    const start = offset;
    let shift = 0;
    let tagVal = 0;
    let b;
    try {
      do {
        if (offset >= buf.length) return fields;
        b = buf[offset++];
        tagVal |= (b & 0x7f) << shift;
        shift += 7;
      } while (b & 0x80);
    } catch {
      break;
    }

    const fieldNumber = tagVal >>> 3;
    const wireType = tagVal & 7;

    if (wireType === 0) {
      shift = 0;
      let v = 0;
      do {
        if (offset >= buf.length) return fields;
        b = buf[offset++];
        v |= (b & 0x7f) << shift;
        shift += 7;
      } while (b & 0x80);
      fields.push({ fieldNumber, wireType, value: v, offset: start });
    } else if (wireType === 2) {
      shift = 0;
      let len = 0;
      do {
        if (offset >= buf.length) return fields;
        b = buf[offset++];
        len |= (b & 0x7f) << shift;
        shift += 7;
      } while (b & 0x80);
      if (offset + len > buf.length) {
        fields.push({
          fieldNumber,
          wireType,
          value: buf.subarray(offset),
          offset: start,
          truncated: true,
        });
        return fields;
      }
      fields.push({
        fieldNumber,
        wireType,
        value: buf.subarray(offset, offset + len),
        offset: start,
      });
      offset += len;
    } else if (wireType === 1) {
      if (offset + 8 > buf.length) break;
      fields.push({
        fieldNumber,
        wireType,
        value: buf.subarray(offset, offset + 8),
        offset: start,
      });
      offset += 8;
    } else if (wireType === 5) {
      if (offset + 4 > buf.length) break;
      fields.push({
        fieldNumber,
        wireType,
        value: buf.subarray(offset, offset + 4),
        offset: start,
      });
      offset += 4;
    } else {
      // group / unknown — avancer d'1 octet pour resync
      offset = start + 1;
    }
  }
  return fields;
}

function preview(str, max = 120) {
  if (!str) return "(vide)";
  const s = String(str);
  return s.length <= max ? s : `${s.slice(0, max)}… (${s.length} car.)`;
}

function b64urlDecode(body) {
  let s = body.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}

function entropy(buf) {
  const f = new Array(256).fill(0);
  for (const b of buf) f[b]++;
  let e = 0;
  const n = buf.length;
  for (const x of f) {
    if (!x) continue;
    const p = x / n;
    e -= p * Math.log2(p);
  }
  return Number(e.toFixed(3));
}

function analyze05AL(token) {
  if (!token?.startsWith("05AL")) return null;
  const body = token.slice(4);
  let bin;
  try {
    bin = b64urlDecode(body);
  } catch {
    return { token, error: "base64url invalide" };
  }
  const block32 = body.slice(0, 32);
  let repeats = 0;
  for (let i = 32; i + 32 <= body.length; i += 32) {
    if (body.slice(i, i + 32) === block32) repeats++;
  }
  return {
    length: token.length,
    preview: token.slice(0, 72) + "…",
    binaryLength: bin.length,
    hexHead: bin.subarray(0, 48).toString("hex"),
    entropy: entropy(bin),
    synthetic: repeats >= 3,
    repeatBlocks32: repeats,
  };
}

function parseF7(f7Buf) {
  const latin1 = f7Buf.toString("latin1");
  const m05 = latin1.match(RE_05AL);
  const loginIdx = f7Buf.indexOf(LOGIN_TAG);

  let secondaryToken = null;
  let innerStart = 0;

  if (loginIdx > 0) {
    secondaryToken = f7Buf.subarray(0, loginIdx).toString("utf8");
    innerStart = loginIdx;
  } else if (m05) {
    secondaryToken = m05[0].slice(0, 1276);
    innerStart = latin1.indexOf(m05[0]) + m05[0].length;
  }

  const inner = innerStart > 0 ? f7Buf.subarray(innerStart) : Buffer.alloc(0);
  const innerFields = inner.length ? ProtobufWire.decodeMessage(inner) : [];

  const innerParsed = {};
  for (const f of innerFields) {
    if (f.wireType === 0) innerParsed[f.fieldNumber] = f.value;
    else if (f.wireType === 2) {
      const u = f.value.toString("utf8");
      innerParsed[f.fieldNumber] =
        f.fieldNumber === 2088
          ? { length: f.value.length, base64Head: f.value.subarray(0, 48).toString("base64") + "…" }
          : u.length < 500
            ? u
            : { length: u.length, preview: preview(u, 80) };
    }
  }

  return {
    totalLength: f7Buf.length,
    secondaryToken,
    secondaryTokenAnalysis: secondaryToken ? analyze05AL(secondaryToken) : null,
    innerFields: innerParsed,
    loginMarkerAt: loginIdx >= 0 ? loginIdx : null,
  };
}

function parseField2(field2Buf) {
  const utf8 = field2Buf.toString("latin1");
  const anchor = utf8.match(ANCHOR_RE)?.[0] ?? null;
  if (!anchor) {
    return {
      anchor: preview(utf8, 80),
      anchorLength: field2Buf.length,
      note: "anchor 03AF… non trouvé — champ 2 affiché brut",
    };
  }

  const suffix = field2Buf.subarray(anchor.length);
  let suffixFields = {};
  let f7 = null;

  try {
    const parsed = ReloadStructure.parseSuffix(suffix);
    suffixFields = {
      5: parsed.f5Hash,
      6: parsed.challengeType,
      field7Bytes: parsed.f7?.length ?? 0,
    };
    f7 = parsed.f7;
  } catch (e) {
    suffixFields = { parseError: e.message, suffixLength: suffix.length };
    const m05 = utf8.match(RE_05AL);
    if (m05) {
      suffixFields.found05ALByRegex = m05[0].slice(0, 80) + "…";
    }
  }

  return {
    anchorLength: anchor.length,
    anchorPreview: anchor.slice(0, 48) + "…",
    suffixLength: suffix.length,
    suffixFields,
    f7: f7 ? parseF7(f7) : null,
  };
}

function tryDecryptField16(blobBytes, encryptionKey) {
  if (!encryptionKey || !blobBytes?.length) return [];
  return ReloadProtobufDecoder.decryptBlobField(blobBytes, encryptionKey).slice(0, 12);
}

function decodeReload(buf, encryptionKey = null) {
  const fields = decodeMessageFull(buf);
  const top = {};
  let field2Detail = null;
  let f7TopLevel = null;
  let token05FromBody = null;
  const parseWarnings = [];

  if (fields.length < 3 && buf.length > 500) {
    parseWarnings.push(
      "peu de champs protobuf détectés — vérifiez que le hex ne contient pas la colonne ASCII (Charles)",
    );
  }

  for (const f of fields) {
    if (f.truncated) {
      parseWarnings.push(`champ ${f.fieldNumber} tronqué (hex incomplet ?)`);
    }
    if (f.wireType === 0) {
      top[f.fieldNumber] = { type: "varint", value: f.value };
      continue;
    }
    if (f.wireType !== 2) continue;

    const bytes = f.value;
    const utf8 = bytes.toString("utf8");

    switch (f.fieldNumber) {
      case 1:
        top[1] = { role: "version", value: utf8 };
        break;
      case 2:
        field2Detail = parseField2(bytes);
        top[2] = {
          role: "anchor + suffix (5,6,7 nested)",
          totalLength: bytes.length,
          anchorLength: field2Detail.anchorLength,
          suffixLength: field2Detail.suffixLength,
        };
        break;
      case 5:
        top[5] = { role: "fingerprintHash", value: utf8 };
        break;
      case 6:
        top[6] = { role: "challengeType", value: utf8 };
        break;
      case 7:
        f7TopLevel = parseF7(bytes);
        top[7] = { role: "f7 secondary (flat builder)", ...f7TopLevel };
        break;
      case 8:
        top[8] = { role: "action", value: utf8 };
        break;
      case 14:
        top[14] = { role: "siteKey", value: utf8 };
        break;
      case 16:
        top[16] = {
          role: "encryptedFingerprintBlob",
          length: bytes.length,
          segments: ReloadProtobufDecoder.decodeBuffer(buf).fields[16]?.segments,
          decryptedSignals: tryDecryptField16(bytes, encryptionKey),
        };
        break;
      case 20:
        top[20] = {
          role: "telemetry",
          value: ReloadProtobufDecoder.decodeBuffer(buf).fields[20]?.value ?? utf8.slice(0, 200),
        };
        break;
      case 21:
        top[21] = { role: "auxToken 0aAL", preview: preview(utf8, 80), length: utf8.length };
        break;
      case 22:
        top[22] = {
          role: "binaryPayload",
          length: bytes.length,
          preview: preview(utf8, 80),
        };
        break;
      case 25:
        top[25] = {
          role: "eventCounters",
          value: utf8.startsWith("W1tb") ? ReloadProtobufDecoder.decodeBuffer(buf).fields[25]?.value : utf8,
        };
        break;
      default:
        top[f.fieldNumber] = {
          role: `field_${f.fieldNumber}`,
          length: bytes.length,
          preview: preview(utf8, 80),
        };
    }
  }

  const latin1 = buf.toString("latin1");
  const idx05 = latin1.indexOf("05AL");
  const idxAnchor = latin1.indexOf("03AFcWeA");
  const mBody = latin1.match(RE_05AL);
  if (mBody) token05FromBody = analyze05AL(mBody[0].slice(0, 1276));

  const token05 =
    f7TopLevel?.secondaryTokenAnalysis ??
    field2Detail?.f7?.secondaryTokenAnalysis ??
    token05FromBody;

  return {
    bodyLength: buf.length,
    fieldCount: fields.length,
    rawFields: fields.map((f) => ({
      n: f.fieldNumber,
      wt: f.wireType,
      len: f.wireType === 2 ? f.value.length : undefined,
      off: f.offset,
    })),
    topLevelFields: Object.keys(top).map(Number).sort((a, b) => a - b),
    fields: top,
    field2: field2Detail,
    f7TopLevel,
    token05AL: token05,
    scan: {
      anchorAt: idxAnchor >= 0 ? idxAnchor : null,
      token05At: idx05 >= 0 ? idx05 : null,
    },
    parseWarnings,
    encryptionKeyUsed: encryptionKey,
  };
}

function printReport(r) {
  console.log("\n=== Reload protobuf (depuis hex) ===\n");
  console.log("taille body:", r.bodyLength, "octets");
  console.log("champs protobuf bruts:", r.fieldCount);
  console.log("champs top-level:", r.topLevelFields.join(", ") || "(aucun)");

  if (r.parseWarnings?.length) {
    console.log("\n⚠ Avertissements:");
    for (const w of r.parseWarnings) console.log(" ", w);
  }

  if (r.scan?.anchorAt != null) {
    console.log("scan anchor 03AF @ octet", r.scan.anchorAt);
  }
  if (r.scan?.token05At != null) {
    console.log("scan 05AL @ octet", r.scan.token05At);
  }

  if (r.rawFields?.length && r.fieldCount <= 4) {
    console.log("\n--- Champs bruts (debug) ---");
    for (const f of r.rawFields) {
      console.log(
        `  field ${f.n} wire=${f.wt}${f.len != null ? ` len=${f.len}` : ""} @${f.off}`,
      );
    }
  }

  console.log("\n--- Champs 1–29 ---");
  for (const n of r.topLevelFields) {
    const f = r.fields[n];
    console.log(`\n[${n}] ${f.role ?? f.type ?? "?"}`);
    if (f.value !== undefined) console.log("  ", typeof f.value === "object" ? JSON.stringify(f.value, null, 2) : f.value);
    if (f.preview) console.log("   preview:", f.preview);
    if (f.length) console.log("   longueur:", f.length, "octets");
    if (f.totalLength) console.log("   longueur:", f.totalLength, "octets");
    if (f.anchorLength) console.log("   anchor:", f.anchorLength, "o | suffix:", f.suffixLength, "o");
  }

  if (r.field2) {
    console.log("\n--- Champ 2 détaillé (anchor + suffix) ---");
    console.log("  anchor:", r.field2.anchorPreview ?? r.field2.anchor);
    console.log("  suffix:", r.field2.suffixLength, "octets");
    if (r.field2.suffixFields) {
      console.log("  suffix protobuf:", JSON.stringify(r.field2.suffixFields, null, 2));
    }
    if (r.field2.f7) {
      console.log("\n  --- f7 (dans suffix champ 2) — 05AL ---");
      printF7(r.field2.f7);
    }
  }

  if (r.f7TopLevel) {
    console.log("\n--- Champ 7 top-level (format flat) ---");
    printF7(r.f7TopLevel);
  }

  if (r.token05AL) {
    console.log("\n=== 05AL extrait ===");
    console.log(JSON.stringify(r.token05AL, null, 2));
    if (r.token05AL.synthetic) {
      console.log("  ⚠ pattern répétitif → probablement synthétique");
    } else if (r.token05AL.entropy >= 7) {
      console.log("  ✓ entropie élevée → probable token Chrome/VM");
    }
  } else {
    console.log("\n=== 05AL ===");
    console.log("  non trouvé (regex 05AL… dans le body)");
  }

  if (r.fields[16]?.decryptedSignals?.length) {
    console.log("\n--- Champ 16 — signaux LCG déchiffrés ---");
    for (const s of r.fields[16].decryptedSignals) {
      console.log(`  signalKey=${s.signalKey} @${s.offset}: ${preview(s.plaintext, 100)}`);
    }
  } else if (r.fields[16] && r.encryptionKeyUsed) {
    console.log("\n--- Champ 16 ---");
    console.log("  aucun signal LCG déchiffré (clé incorrecte ou blob différent)");
  } else if (r.fields[16]) {
    console.log("\n--- Champ 16 ---");
    console.log("  passe --key <encryptionKey> pour tenter le déchiffrement LCG");
  }

  console.log("");
}

function printF7(f7) {
  console.log("  f7 total:", f7.totalLength, "octets");
  if (f7.loginMarkerAt != null) console.log("  marqueur login @", f7.loginMarkerAt);
  if (f7.secondaryToken) {
    console.log("  05AL longueur:", f7.secondaryToken.length);
    console.log("  05AL début:", f7.secondaryToken.slice(0, 72) + "…");
  }
  if (f7.secondaryTokenAnalysis) {
    console.log("  entropie binaire:", f7.secondaryTokenAnalysis.entropy);
    console.log("  hex head:", f7.secondaryTokenAnalysis.hexHead);
  }
  if (Object.keys(f7.innerFields ?? {}).length) {
    console.log("  inner f7:", JSON.stringify(f7.innerFields, null, 2));
  }
}

function readInput() {
  if (useStdin) return readFileSync(0, "utf8");
  if (!filePath) return null;
  if (!existsSync(filePath)) {
    console.error("Fichier introuvable:", filePath);
    process.exit(1);
  }
  return readFileSync(filePath, "utf8");
}

const text = readInput();
if (!text) {
  console.error(`Usage:
  node tools/decode-reload-hex.mjs <fichier.hex.txt>
  node tools/decode-reload-hex.mjs --stdin < paste.txt

Collez un dump hex Charles / xxd :
  00000000  0a 18 54 6e 41 37 …     TnA7HacJFoBWt9
  (la colonne ASCII à droite est ignorée automatiquement)

Options:
  --key <n>   encryptionKey anchor (déchiffre champ 16)
  --json      sortie JSON`);
  process.exit(1);
}

let buf;
try {
  buf = parseHexDump(text);
} catch (e) {
  console.error("Parse hex échoué:", e.message);
  process.exit(1);
}

if (buf.length < 16) {
  console.error("Body trop court (", buf.length, "octets) — hex incomplet ?");
  process.exit(1);
}

const report = decodeReload(buf, encKeyArg);
if (jsonOut) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printReport(report);
}
