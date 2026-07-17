#!/usr/bin/env node
/**
 * Test 100 % Google (anchor + reload) — aucune requête Ticketmaster, aucun navigateur.
 */
import { getToken, ticketmasterTokenOptions } from "../api/index.js";

const opts = ticketmasterTokenOptions({ quiet: false });
const started = Date.now();
const result = await getToken(opts);
const ms = Date.now() - started;

console.log(
  JSON.stringify(
    {
      success: result.success,
      tokenLen: result.token?.length,
      pipeline: result.pipeline,
      reloadBytes: result.reloadBytes,
      durationMs: ms,
      hint: result.hint,
    },
    null,
    2,
  ),
);

if (result.token?.startsWith("0cAFcWeA")) {
  console.log("\nOK token Google:", result.token.slice(0, 72) + "…");
  process.exit(0);
}
process.exit(1);
