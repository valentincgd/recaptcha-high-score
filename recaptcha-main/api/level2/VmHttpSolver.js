import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SignalEncryptor } from "./SignalEncryptor.js";
import { InnerBlobPatcher } from "./InnerBlobPatcher.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Signaux HTTP Ticketmaster — clés VM courantes (recaptcha-vm / README). */
const TM_PLAINTEXT_SIGNALS = (ctx) => [
  {
    signalKey: 417,
    plaintext:
      ctx.userAgent ??
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
  },
  { signalKey: 1641, plaintext: `"${ctx.referer ?? "https://auth.ticketmaster.com/"}"` },
  { signalKey: 1641, plaintext: `"https://auth.ticketmaster.com/"` },
];

/**
 * Régénère le blob empreinte (f2088) pour la session anchor live.
 * Niveau 2 HTTP — chiffrement VM (LCG), sans navigateur TM.
 */
export class VmHttpSolver {
  static loadTemplateSessionKey() {
    const path =
      process.env.TM_SESSION_PATH ??
      join(process.cwd(), "captures", "tm-session.json");
    if (!existsSync(path)) return null;
    try {
      const j = JSON.parse(readFileSync(path, "utf8"));
      return j.encryptionKey ?? j.templateEncryptionKey ?? null;
    } catch {
      return null;
    }
  }

  static rebindEncryptedBlob(encryptedBlob, { templateKey, liveKey, ctx = {} }) {
    if (!templateKey || !liveKey || templateKey === liveKey) {
      return encryptedBlob;
    }

    let buf = Buffer.isBuffer(encryptedBlob)
      ? Buffer.from(encryptedBlob)
      : Buffer.from(encryptedBlob, "latin1");

    const signals = TM_PLAINTEXT_SIGNALS(ctx);
    const candidates = VmHttpSolver.#findEncryptedCandidates(buf);

    for (const cand of candidates) {
      for (const { signalKey, plaintext } of signals) {
        const decrypted = SignalEncryptor.decrypt(cand.bytes, templateKey, signalKey);
        if (!decrypted || decrypted.length < 8) continue;
        if (!VmHttpSolver.#looksLikePlaintext(decrypted, plaintext)) continue;

        const reenc = SignalEncryptor.encrypt(plaintext, liveKey, signalKey);
        if (reenc.length !== cand.bytes.length) continue;

        buf = Buffer.concat([
          buf.subarray(0, cand.offset),
          reenc,
          buf.subarray(cand.offset + cand.bytes.length),
        ]);
        break;
      }
    }

    return InnerBlobPatcher.patch(buf, {
      telemetry: ctx.telemetry,
      events: ctx.events,
      siteKey: ctx.siteKey,
      action: ctx.action,
    });
  }

  static #looksLikePlaintext(decrypted, expected) {
    const d = decrypted.replace(/\0/g, "").trim();
    const e = expected.replace(/^"|"$/g, "");
    return d.includes(e) || d === expected || d.includes("Mozilla");
  }

  /** Cherche sous-buffers chiffrés (seed LCG en suffixe 4 octets). */
  static findEncryptedCandidates(buf, opts) {
    return VmHttpSolver.#findEncryptedCandidates(buf, opts);
  }

  /** Cherche sous-buffers finissant par 4 octets (runtime seed LCG). */
  static #findEncryptedCandidates(buf, { minLen = 12, maxLen = 2048 } = {}) {
    const out = [];
    const maxScan = Math.min(buf.length, 12000);
    for (let offset = 0; offset < maxScan - minLen; offset += 4) {
      for (let len = minLen; len <= maxLen && offset + len <= buf.length; len += 4) {
        const slice = buf.subarray(offset, offset + len);
        if (slice.length < 8) continue;
        const tail = slice[slice.length - 4];
        if (tail === 0 && slice[slice.length - 1] === 0) continue;
        out.push({ offset, bytes: slice });
        if (out.length > 80) return out;
      }
    }
    return out.slice(0, 40);
  }
}
