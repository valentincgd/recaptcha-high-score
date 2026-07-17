#!/usr/bin/env node
/**
 * Token TM : fingerprint frais + pipeline auto (JSDOM VM si TM enterprise).
 *
 *   npm run token:tm:native
 *   RECAPTCHA_JSDOM_BROWSER=0  → JS pur seulement (plus rapide, moins fidèle)
 */

import { getToken, ticketmasterTokenOptions } from "../api/index.js";

process.env.RECAPTCHA_CHROME_CAPTURE = "0";
process.env.RECAPTCHA_AUTO_DUMP = process.env.RECAPTCHA_AUTO_DUMP ?? "1";
process.env.RECAPTCHA_FINGERPRINT_PROFILE =
  process.env.RECAPTCHA_FINGERPRINT_PROFILE ?? "random";

const r = await getToken(
  ticketmasterTokenOptions({
    enterprise: true,
    mode: "enterprise",
    action: "login",
  }),
);

console.log("\n=== Résultat ===");
console.log("mode:", r.mode, "| pipeline:", r.pipeline ?? "?");
console.log("fingerprint:", process.env.RECAPTCHA_FINGERPRINT_PROFILE ?? "random (1 session/run)");
console.log("reloadBytes:", r.reloadBytes);
console.log("validForTicketmaster:", r.validForTicketmaster);
console.log("token:", r.token?.slice(0, 48) + "…");
console.log("\nDump session → captures/sessions/native-*.json");
console.log("Latest → captures/vm-runtime-latest.json");
