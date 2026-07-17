#!/usr/bin/env node
/**
 * CLI : npm run cli -- <url> [action] [proxy]
 *   ou RECAPTCHA_PROXY=http://user:pass@host:port
 */
import "./bootstrap.mjs";
import { generateTmAltToken } from "./TmAltTokenService.mjs";
import { formatCaptchaSolveResponse } from "./solveRequest.mjs";

const url = process.argv[2];
const action = process.argv[3] ?? "FREvent";
const proxy = process.argv[4] ?? process.env.RECAPTCHA_PROXY;

if (!url) {
  console.error("Usage: node cli.mjs <url> [action] [proxy]");
  console.error("  proxy: argument ou RECAPTCHA_PROXY");
  process.exit(1);
}
if (!proxy) {
  console.error("proxy requis (argument ou RECAPTCHA_PROXY)");
  process.exit(1);
}

const started = Date.now();
try {
  const result = await generateTmAltToken({ url, action, proxy });
  const payload = formatCaptchaSolveResponse(result, Date.now() - started, {
    method: "A",
  });
  console.log(JSON.stringify(payload, null, 2));
  process.exit(payload.status === "success" ? 0 : 1);
} catch (err) {
  console.error(JSON.stringify({ status: "error", error: err.message }, null, 2));
  process.exit(1);
}
