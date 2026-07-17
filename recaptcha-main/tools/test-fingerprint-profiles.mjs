#!/usr/bin/env node
/**
 * Génère un reload par profil fingerprint (JS pur, sans JSDOM).
 */
import { BrowserSimulator } from "../api/vm/BrowserSimulator.js";
import { VmPureReloadBuilder } from "../api/vm/VmPureReloadBuilder.js";

const profiles = process.argv.slice(2);
const list =
  profiles.length > 0 ? profiles : BrowserSimulator.listProfiles();

const anchorToken = process.env.RECAPTCHA_ANCHOR_TOKEN ?? "03AFcWeA" + "x".repeat(1920);
const encryptionKey = Number(process.env.RECAPTCHA_ENCRYPTION_KEY ?? 1780535723201);

for (const id of list) {
  const built = VmPureReloadBuilder.build({
    version: "hsFBb1u5wWWWkWP4in1ua2cQ",
    anchorToken,
    siteKey: "6LdoaXQrAAAAADQviABd-eByJu6kPL8awKDyc1zb",
    action: "login",
    encryptionKey,
    fingerprint: id,
    onLog: (s, d) => console.log(`  [${id}] ${s}: ${d}`),
  });
  console.log(
    `${id} → ${built.reloadBytes} octets | 05AL=${built.secondarySource} | key=${built.encryptionKey}`,
  );
}
