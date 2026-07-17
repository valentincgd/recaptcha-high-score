#!/usr/bin/env node
/**
 * Démo : génère un reload dynamique (sans reload.bin).
 * Usage: node tools/build-flat-reload.mjs [anchorToken] [encryptionKey] [version]
 */
import { writeFileSync } from "node:fs";
import { DynamicFlatReloadBuilder } from "../api/level2/DynamicFlatReloadBuilder.js";

const anchorToken = process.argv[2];
const encryptionKey = Number(process.argv[3]);
const version =
  process.argv[4] ?? "hsFBb1u5wWWWkWP4in1ua2cQ";

if (!anchorToken || !encryptionKey) {
  console.error(
    "Usage: node tools/build-flat-reload.mjs <anchorToken> <encryptionKey> [version]",
  );
  process.exit(1);
}

const body = DynamicFlatReloadBuilder.build({
  version,
  anchorToken,
  siteKey: process.env.RECAPTCHA_SITE_KEY ?? "6LdoaXQrAAAAADQviABd-eByJu6kPL8awKDyc1zb",
  action: process.env.RECAPTCHA_ACTION ?? "login",
  encryptionKey,
  referer: "https://auth.ticketmaster.com/",
  origin: "https://auth.ticketmaster.com",
});

const out = process.argv[5];
if (out) {
  writeFileSync(out, body);
  console.log(`OK ${out} (${body.length} octets)`);
} else {
  process.stdout.write(body);
}
