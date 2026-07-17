/**
 * Test VmPureReloadBuilder (sans JSDOM) sur anchor live ou tm-session.json.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { VmPureReloadBuilder } from "../api/vm/VmPureReloadBuilder.js";
import { ReloadProtobufDecoder } from "../api/level2/ReloadProtobufDecoder.js";

const sessionPath =
  process.argv[2] ?? join(process.cwd(), "captures", "tm-session.json");

if (!existsSync(sessionPath)) {
  console.error(`Session introuvable: ${sessionPath}`);
  console.error("Usage: node tools/test-pure-reload.mjs [tm-session.json]");
  process.exit(1);
}

const session = JSON.parse(readFileSync(sessionPath, "utf8"));
const anchor = session.anchor ?? session;
const anchorToken =
  anchor.anchorToken ?? session.anchorToken ?? process.env.RECAPTCHA_ANCHOR_TOKEN;
if (!anchorToken || anchor.encryptionKey == null) {
  console.error(
    "anchorToken + encryptionKey requis (npm run capture:tm-session ou token:tm complet)",
  );
  process.exit(1);
}
const version = session.version ?? session.bootstrap?.version ?? "hsFBb1u5wWWWkWP4in1ua2cQ";

const logs = [];
const built = VmPureReloadBuilder.build({
  version,
  anchorToken,
  siteKey: session.siteKey ?? "6LdoaXQrAAAAADQviABd-eByJu6kPL8awKDyc1zb",
  action: session.action ?? "login",
  encryptionKey: anchor.encryptionKey,
  anchor,
  configBytecode: anchor.configBytecode,
  vmBytecodeKeys: anchor.config?.vmBytecodeKeys,
  userAgent: session.userAgent,
  referer: session.referer,
  origin: session.origin,
  fingerprint: {
    webgl: {
      vendor: "Google Inc. (Intel)",
      renderer: "ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)",
      extensionCount: 42,
    },
    width: 1920,
    height: 1080,
  },
  onLog: (sub, detail) => logs.push(`${sub}: ${detail}`),
});

console.log("--- VmPureReloadBuilder ---");
console.log(`body: ${built.reloadBytes} octets | strategy=${built.strategy}`);
console.log(`05AL: ${built.secondarySource} | encryptionKey=${built.encryptionKey}`);
console.log(`vm signalKeys: ${built.vmAnalysis?.signalKeys?.length ?? 0}`);
if (built.vmAnalysis?.errors?.length) {
  console.log("vm errors:", built.vmAnalysis.errors.join("; "));
}

for (const line of logs) console.log(" ", line);

try {
  const dec = ReloadProtobufDecoder.decode(built.body, anchor.encryptionKey);
  console.log("\n--- Champs décodés ---");
  for (const [k, v] of Object.entries(dec.fields ?? {})) {
    const preview =
      typeof v === "string" && v.length > 80 ? `${v.slice(0, 80)}… (${v.length}c)` : v;
    console.log(`  ${k}: ${preview}`);
  }
} catch (err) {
  console.warn("decode:", err.message);
}
