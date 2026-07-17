import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ProtobufWire } from "../ProtobufWire.js";
import { SignalEncryptor } from "./SignalEncryptor.js";
import { VmHttpSolver } from "./VmHttpSolver.js";
import { InnerBlobPatcher } from "./InnerBlobPatcher.js";
import { DynamicFlatReloadBuilder } from "./DynamicFlatReloadBuilder.js";

const SIGNAL_KEYS = [417, 1641, 1310, 352, 360, 1628, 16, 34, 31, 3553, 291, 4, 5, 32, 1626];

/**
 * Décode / rechiffre le reload plat TM (protobuf.txt → structure → body.txt).
 */
export class ReloadProtobufDecoder {
  static decodeBuffer(buf) {
    const fields = ProtobufWire.decodeMessage(buf);
    const out = { rawFieldCount: fields.length, fields: {} };

    for (const f of fields) {
      if (f.wireType === 0) {
        out.fields[f.fieldNumber] = f.value;
        continue;
      }
      if (f.wireType !== 2) continue;

      const bytes = f.value;
      const utf8 = bytes.toString("utf8");
      const entry = {
        wireType: 2,
        length: bytes.length,
        utf8Preview: utf8.length <= 200 ? utf8 : `${utf8.slice(0, 120)}…`,
      };

      switch (f.fieldNumber) {
        case 1:
          entry.role = "version";
          entry.value = utf8;
          break;
        case 2:
          entry.role = "anchorToken";
          entry.value = utf8;
          entry.prefix = utf8.slice(0, 12);
          break;
        case 5:
          entry.role = "fingerprintHash";
          entry.value = utf8;
          break;
        case 6:
          entry.role = "challengeType";
          entry.value = utf8;
          break;
        case 7:
          entry.role = "secondaryToken";
          entry.value = utf8;
          entry.prefix = utf8.slice(0, 4);
          break;
        case 8:
          entry.role = "action";
          entry.value = utf8;
          break;
        case 14:
          entry.role = "siteKey";
          entry.value = utf8;
          break;
        case 16:
          entry.role = "encryptedFingerprintBlob";
          entry.base64 = bytes.toString("base64");
          entry.segments = InnerBlobPatcher.extractSegments(bytes);
          break;
        case 20:
          entry.role = "telemetryJson";
          entry.value = ReloadProtobufDecoder.#decodeBase64Json(utf8);
          break;
        case 21:
          entry.role = "auxToken";
          entry.value = utf8;
          break;
        case 22:
          entry.role = "binaryPayload";
          entry.base64 = bytes.toString("base64");
          entry.isPrintable = ReloadProtobufDecoder.#isMostlyPrintable(bytes);
          break;
        case 25:
          entry.role = "eventCounters";
          entry.value = ReloadProtobufDecoder.#decodeW1tb(utf8);
          break;
        default:
          entry.role = `field_${f.fieldNumber}`;
          entry.base64 = bytes.length < 500 ? bytes.toString("base64") : "(voir binaire)";
      }

      out.fields[f.fieldNumber] = entry;
    }

    return out;
  }

  static decryptBlobField(blobBytes, encryptionKey) {
    if (!encryptionKey || !blobBytes?.length) return [];

    const decrypted = [];
    const candidates = VmHttpSolver.findEncryptedCandidates(blobBytes, {
      minLen: 16,
      maxLen: 512,
    });

    for (const cand of candidates) {
      for (const signalKey of SIGNAL_KEYS) {
        try {
          const plain = SignalEncryptor.decrypt(cand.bytes, encryptionKey, signalKey);
          if (!plain || plain.length < 4) continue;
          const clean = plain.replace(/\0/g, "").trim();
          if (clean.length < 4) continue;
          if (!ReloadProtobufDecoder.#isMostlyPrintable(Buffer.from(clean, "latin1"))) {
            continue;
          }
          decrypted.push({
            offset: cand.offset,
            length: cand.bytes.length,
            signalKey,
            plaintext: clean.slice(0, 500),
          });
        } catch {
          /* ignore */
        }
      }
    }

    const seen = new Set();
    return decrypted.filter((d) => {
      const k = `${d.signalKey}:${d.plaintext.slice(0, 40)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  static decodeFile(templatePath, { encryptionKey = null } = {}) {
    const key =
      encryptionKey ?? ReloadProtobufDecoder.#loadSessionKey();
    const buf = readFileSync(templatePath);
    const decoded = ReloadProtobufDecoder.decodeBuffer(buf);

    const field16 = ProtobufWire.decodeMessage(buf).find(
      (f) => f.fieldNumber === 16,
    )?.value;
    if (decoded.fields[16]?.role === "encryptedFingerprintBlob" && field16) {
      if (key) {
        decoded.fields[16].decryptedSignals =
          ReloadProtobufDecoder.decryptBlobField(field16, key);
      }
      decoded.fields[16].hexHeader = field16.subarray(0, 64).toString("hex");
      if (!decoded.fields[16].decryptedSignals?.length) {
        decoded.fields[16].decryptNote =
          "Aucun signal LCG déchiffré — encryptionKey doit être celui de la même session que le reload (captures/tm-session.json).";
      }
    }

    decoded.encryptionKeyUsed = key;
    decoded.templatePath = templatePath;
    return decoded;
  }

  static toBodyText(decoded) {
    const lines = [];
    lines.push("# reload.bin — structure protobuf décodée");
    lines.push(`# source: ${decoded.templatePath ?? "?"}`);
    if (decoded.encryptionKeyUsed) {
      lines.push(`# encryptionKey (session): ${decoded.encryptionKeyUsed}`);
    }
    lines.push("");

    const order = [1, 2, 5, 6, 7, 8, 14, 16, 20, 21, 22, 25, 28, 29];
    const keys = [...new Set([...order, ...Object.keys(decoded.fields).map(Number)])].sort(
      (a, b) => a - b,
    );

    for (const n of keys) {
      const f = decoded.fields[n];
      if (!f) continue;
      lines.push(`## Champ ${n} — ${f.role ?? "unknown"}`);
      if (f.value !== undefined) {
        if (typeof f.value === "object") {
          lines.push(JSON.stringify(f.value, null, 2));
        } else {
          lines.push(String(f.value));
        }
      }
      if (f.length) lines.push(`longueur: ${f.length} octets`);
      if (f.prefix) lines.push(`préfixe: ${f.prefix}`);
      if (f.segments) {
        lines.push("segments:");
        lines.push(JSON.stringify(f.segments, null, 2));
      }
      if (f.decryptedSignals?.length) {
        lines.push("signaux déchiffrés (LCG / SignalEncryptor):");
        for (const s of f.decryptedSignals) {
          lines.push(
            `  - signalKey=${s.signalKey} @${s.offset} len=${s.length}: ${s.plaintext}`,
          );
        }
      }
      if (f.base64 && f.role !== "encryptedFingerprintBlob") {
        lines.push(`base64 (${f.base64.length} car.):`);
        lines.push(f.base64.length > 2000 ? `${f.base64.slice(0, 2000)}…` : f.base64);
      }
      lines.push("");
    }

    lines.push("## Régénération dynamique");
    lines.push(
      "Documentation uniquement — génération réelle: DynamicFlatReloadBuilder.build()",
    );
    lines.push("npm run decode:reload <fichier.bin>  # optionnel, décoder une capture DevTools");
    return lines.join("\n");
  }

  static writeBodyTxt(templatePath, outPath = "body.txt", opts = {}) {
    const decoded = ReloadProtobufDecoder.decodeFile(templatePath, opts);
    const text = ReloadProtobufDecoder.toBodyText(decoded);
    writeFileSync(outPath, text, "utf8");
    return { decoded, outPath };
  }

  /**
   * Reconstruit le corps reload (protobuf plat) avec anchor + empreinte dynamiques.
   */
  static buildDynamic(opts) {
    return DynamicFlatReloadBuilder.build(opts);
  }

  static #loadSessionKey() {
    const path =
      process.env.TM_SESSION_PATH ??
      join(process.cwd(), "captures", "tm-session.json");
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, "utf8")).encryptionKey ?? null;
    } catch {
      return null;
    }
  }

  static #decodeBase64Json(s) {
    try {
      const raw = Buffer.from(s, "base64").toString("utf8");
      return JSON.parse(raw);
    } catch {
      try {
        return JSON.parse(s);
      } catch {
        return s;
      }
    }
  }

  static #decodeW1tb(s) {
    if (!s.startsWith("W1tb")) return s;
    try {
      const inner = Buffer.from(s.slice(4), "base64").toString("utf8");
      return JSON.parse(inner);
    } catch {
      return s;
    }
  }

  static #isMostlyPrintable(buf) {
    let ok = 0;
    for (let i = 0; i < Math.min(buf.length, 200); i++) {
      const c = buf[i];
      if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127)) ok++;
    }
    return ok / Math.min(buf.length, 200) > 0.85;
  }
}
