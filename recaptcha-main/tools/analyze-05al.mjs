#!/usr/bin/env node
/**
 * Analyse un token 05AL : décodage base64url, entropie, détection synthétique,
 * tentative déchiffrement LCG (SignalEncryptor).
 *
 *   node tools/analyze-05al.mjs "05AL..."
 *   node tools/analyze-05al.mjs captures/sessions/native-*.json
 *   node tools/analyze-05al.mjs --stdin < dump.json
 *   node tools/analyze-05al.mjs token.txt --key -1820553523
 *   node tools/analyze-05al.mjs --demo --key 509258817
 */

import { readFileSync, existsSync } from "node:fs";
import { SignalEncryptor } from "../api/level2/SignalEncryptor.js";
import { VmHttpSolver } from "../api/level2/VmHttpSolver.js";

const TARGET_LEN = 1276;
const SIGNAL_KEYS = [417, 1641, 1310, 352, 360, 1628, 16, 34, 31, 3553, 291, 4, 5, 32, 1626];

const args = process.argv.slice(2);
const useStdin = args.includes("--stdin");
const demo = args.includes("--demo");
const jsonOut = args.includes("--json");
const keyIdx = args.indexOf("--key");
const encKeyArg = keyIdx >= 0 ? Number(args[keyIdx + 1]) : null;
const filePath = args.find((a) => !a.startsWith("--") && (keyIdx < 0 || a !== args[keyIdx + 1]));

function readInput() {
  if (useStdin) return readFileSync(0, "utf8").trim();
  if (!filePath) return null;
  if (!existsSync(filePath)) {
    console.error("Fichier introuvable:", filePath);
    process.exit(1);
  }
  return readFileSync(filePath, "utf8").trim();
}

function extractToken(text) {
  if (!text) return { token: null, meta: {} };
  if (text.startsWith("05AL")) {
    return { token: text.replace(/\s/g, "").slice(0, TARGET_LEN), meta: { source: "argv" } };
  }
  try {
    const j = JSON.parse(text);
    const root = j.___vmDump ?? j.vmDump ?? j;
    const token =
      root.last05AL ??
      j.last05AL ??
      (Array.isArray(root.sends) ? root.sends.find((s) => String(s).startsWith("05AL")) : null) ??
      (Array.isArray(j.sends) ? j.sends.find((s) => String(s).startsWith("05AL")) : null);
    const encKey = j.encryptionKey ?? root.encryptionKey ?? null;
    return {
      token: token ? String(token).slice(0, TARGET_LEN) : null,
      meta: {
        source: j.secondarySource ?? root.secondarySource ?? "json",
        encryptionKey: encKey,
        file: filePath ?? "stdin",
      },
    };
  } catch {
    const m = text.match(/05AL[A-Za-z0-9_-]{100,1276}/);
    return { token: m?.[0] ?? null, meta: { source: "regex" } };
  }
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
  return e;
}

function mostlyPrintable(s) {
  if (!s || s.length < 4) return false;
  let ok = 0;
  const n = Math.min(s.length, 200);
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127)) ok++;
  }
  return ok / n > 0.85;
}

function repetitionScore(body, blockLen = 32) {
  if (body.length < blockLen * 2) return { repeats: 0, blocks: 1, synthetic: false };
  const head = body.slice(0, blockLen);
  let repeats = 0;
  const blocks = Math.floor((body.length - blockLen) / blockLen);
  for (let i = blockLen; i + blockLen <= body.length; i += blockLen) {
    if (body.slice(i, i + blockLen) === head) repeats++;
  }
  const unique = new Set();
  for (let i = 0; i < body.length; i += blockLen) unique.add(body.slice(i, i + blockLen));
  return {
    repeats,
    blocks,
    uniqueBlocks: unique.size,
    synthetic: repeats >= 3 || unique.size <= 3,
  };
}

function tryLcgDecrypt(bin, encKey) {
  if (encKey == null || !Number.isFinite(encKey)) return [];
  const cands = VmHttpSolver.findEncryptedCandidates(bin, { minLen: 12, maxLen: 256 });
  const hits = [];
  const seen = new Set();
  for (const cand of cands) {
    for (const sk of SIGNAL_KEYS) {
      try {
        const plain = SignalEncryptor.decrypt(cand.bytes, encKey, sk);
        if (!mostlyPrintable(plain) || plain.length < 6) continue;
        const k = `${sk}:${plain.slice(0, 48)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        hits.push({
          offset: cand.offset,
          length: cand.bytes.length,
          signalKey: sk,
          plaintext: plain.slice(0, 200),
        });
      } catch {
        /* ignore */
      }
    }
  }
  return hits.slice(0, 8);
}

function classifyToken(rep, ent) {
  if (rep.synthetic) return "synthétique (pattern répétitif — derived/vm-send pad)";
  if (ent >= 7.2) return "probable Chrome (haute entropie)";
  if (ent >= 5.5) return "intermédiaire (à comparer avec capture réseau)";
  return "faible entropie (template ou pad)";
}

function analyze(token, { encryptionKey = null, meta = {} } = {}) {
  const encKey = encKeyArg ?? encryptionKey ?? null;
  const out = {
    ok: false,
    meta,
    tokenLength: token?.length ?? 0,
    prefix: token?.slice(0, 4) ?? null,
    preview: token ? `${token.slice(0, 72)}…` : null,
  };

  if (!token?.startsWith("05AL")) {
    out.error = "token invalide — attendu préfixe 05AL";
    return out;
  }
  if (token.length < 200) {
    out.error = `token trop court (${token.length} car.)`;
    return out;
  }

  const body = token.slice(4);
  let bin;
  try {
    bin = b64urlDecode(body);
  } catch (e) {
    out.error = `base64url invalide: ${e.message}`;
    return out;
  }

  const ent = entropy(bin);
  const rep = repetitionScore(body);
  const lcgHits = tryLcgDecrypt(bin, encKey);

  out.ok = true;
  out.binaryLength = bin.length;
  out.hexHead = bin.subarray(0, 48).toString("hex");
  out.entropy = Number(ent.toFixed(3));
  out.repetition = rep;
  out.classification = classifyToken(rep, ent);
  out.encryptionKey = encKey;
  out.lcgDecryptHits = lcgHits;
  out.lcgDecryptOk = lcgHits.length > 0;
  out.lenOk = Math.abs(token.length - TARGET_LEN) <= 20;

  if (demo && encKey != null) {
    const demoPlain = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/149";
    const demoEnc = SignalEncryptor.encryptForSession(demoPlain, encKey, 417, "analyze-05al-demo", 0);
    out.demoRoundtrip = {
      plaintext: demoPlain,
      encryptedHex: demoEnc.toString("hex").slice(0, 64) + "…",
      decrypted: SignalEncryptor.decrypt(demoEnc, encKey, 417),
      ok: SignalEncryptor.decrypt(demoEnc, encKey, 417) === demoPlain,
    };
  }

  return out;
}

function printReport(r) {
  console.log("\n=== Analyse 05AL ===\n");
  if (r.meta?.source) console.log("source:", r.meta.source);
  if (r.meta?.file) console.log("fichier:", r.meta.file);
  if (r.error) {
    console.error("erreur:", r.error);
    return;
  }
  console.log("longueur:", r.tokenLength, r.lenOk ? "✓" : `(attendu ~${TARGET_LEN})`);
  console.log("préfixe:", r.prefix);
  console.log("aperçu:", r.preview);
  console.log("\n--- Couche 1 : base64url ---");
  console.log("binaire:", r.binaryLength, "octets");
  console.log("hex (48 o):", r.hexHead);
  console.log("entropie:", r.entropy, "bits/octet (max 8.0)");
  console.log("classification:", r.classification);
  console.log(
    "répétition bloc-32:",
    `${r.repetition.repeats}/${r.repetition.blocks} blocs identiques,`,
    `${r.repetition.uniqueBlocks} blocs uniques`,
  );
  console.log("\n--- Couche 2 : SignalEncryptor (LCG) ---");
  if (r.encryptionKey != null) console.log("encryptionKey:", r.encryptionKey);
  else console.log("encryptionKey: (absente — passer --key ou JSON session)");
  console.log("hits déchiffrement:", r.lcgDecryptHits.length);
  if (r.lcgDecryptHits.length) {
    for (const h of r.lcgDecryptHits) {
      console.log(`  @${h.offset} len=${h.length} signalKey=${h.signalKey}: ${h.plaintext.slice(0, 80)}…`);
    }
  } else {
    console.log("  → aucun signal LCG lisible dans le payload 05AL");
    console.log("  (normal : le 05AL est un blob VM, pas un signal champ 16)");
  }
  if (r.demoRoundtrip) {
    console.log("\n--- Démo roundtrip LCG (même clé) ---");
    console.log("plaintext:", r.demoRoundtrip.plaintext);
    console.log("chiffré hex:", r.demoRoundtrip.encryptedHex);
    console.log("déchiffre:", r.demoRoundtrip.decrypted);
    console.log("roundtrip OK:", r.demoRoundtrip.ok ? "✓" : "✗");
  }
  console.log("");
}

const text = readInput();
if (!text && !demo) {
  console.error(`Usage:
  node tools/analyze-05al.mjs "05AL..."
  node tools/analyze-05al.mjs <session.json>
  node tools/analyze-05al.mjs --stdin
  node tools/analyze-05al.mjs --demo --key <encryptionKey>

Options:
  --key <n>   clé session anchor (int32)
  --demo      roundtrip SignalEncryptor avec la clé
  --json      sortie JSON`);
  process.exit(1);
}

const { token, meta } = text ? extractToken(text) : { token: null, meta: {} };

if (!token && !demo) {
  console.error("Aucun token 05AL trouvé dans l'entrée.");
  process.exit(1);
}

const report = analyze(token ?? "05AL", { encryptionKey: meta.encryptionKey, meta });

if (jsonOut) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printReport(report);
}

process.exit(report.ok ? 0 : 1);
