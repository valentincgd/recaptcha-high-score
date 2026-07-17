#!/usr/bin/env node
/**
 * Worker JSON ligne par ligne (stdin → stdout) pour l'API Go.
 * Une requête = une ligne JSON → une ligne JSON réponse.
 */
import "./bootstrap.mjs";
import { createInterface } from "node:readline";
import { generateTmAltToken } from "./TmAltTokenService.mjs";
import { formatCaptchaSolveResponse } from "./solveRequest.mjs";

process.env.RECAPTCHA_SKIP_SCRIPT = "1";
process.env.RECAPTCHA_JSDOM_BROWSER = "0";
process.env.RECAPTCHA_CHROME_CAPTURE = "0";
process.env.RECAPTCHA_IDENTICAL = "0";

function reply(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  const started = Date.now();
  try {
    const req = JSON.parse(trimmed);
    const result = await generateTmAltToken({
      url: req.url,
      siteKey: req.sitekey ?? req.siteKey,
      action: req.action,
      proxy: req.proxy,
      title: req.title,
      enterprise: req.enterprise !== false,
    });
    reply(
      formatCaptchaSolveResponse(result, Date.now() - started, {
        method: req.method ?? "A",
      }),
    );
  } catch (err) {
    reply({
      status: "error",
      method: "A",
      error: err.message,
      durationMs: Date.now() - started,
    });
  }
});

rl.on("close", () => process.exit(0));

process.stderr.write("[worker] ready\n");
