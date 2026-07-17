#!/usr/bin/env node
/**
 * Diagnostic Main.init → ErrorMain (anchor live ou captures/anchor-sample.html).
 *
 *   node tools/diagnose-errormain.mjs
 *   node tools/diagnose-errormain.mjs --html=captures/anchor-sample.html
 */

import { readFileSync, existsSync } from "node:fs";
import { AnchorParser } from "../api/AnchorParser.js";
import { AnchorVmRunner } from "../api/vm/AnchorVmRunner.js";
import { Config } from "../api/Config.js";
import { HttpClient } from "../api/HttpClient.js";
import { CallbackGenerator } from "../api/CallbackGenerator.js";
import { EnterpriseBootstrapParser } from "../api/EnterpriseBootstrapParser.js";

process.env.RECAPTCHA_ERRORMAIN_DEBUG = "1";
process.env.RECAPTCHA_ANCHOR_VM_PARENT = "0";
process.env.RECAPTCHA_ANCHOR_EXECUTE_WAIT_MS = "8000";

const htmlArg = process.argv.find((a) => a.startsWith("--html="))?.split("=")[1];

async function loadAnchor() {
  if (htmlArg && existsSync(htmlArg)) {
    const html = readFileSync(htmlArg, "utf8");
    return {
      anchor: AnchorParser.parse(html),
      anchorHtml: html,
      anchorUrl: "https://www.google.com/recaptcha/enterprise/anchor",
      bootstrap: {
        version: "hsFBb1u5wWWWkWP4in1ua2cQ",
        apiBase: "https://www.google.com/recaptcha/api2/",
        scriptUrl:
          "https://www.gstatic.com/recaptcha/releases/hsFBb1u5wWWWkWP4in1ua2cQ/recaptcha__fr.js",
      },
    };
  }
  const cfg = Config.fromEnv({
    siteKey: "6LdoaXQrAAAAADQviABd-eByJu6kPL8awKDyc1zb",
    enterprise: true,
    action: "login",
  });
  const h = cfg.googleHeaders();
  const bootJs = await HttpClient.fetchText(
    `https://www.google.com/recaptcha/enterprise.js?render=${cfg.siteKey}`,
    h,
  );
  const bootstrap = EnterpriseBootstrapParser.parse(bootJs);
  const anchorUrl = cfg.buildAnchorUrl({
    apiBase: bootstrap.apiBase,
    version: bootstrap.version,
    cb: CallbackGenerator.generate(),
  });
  const anchorHtml = await HttpClient.fetchText(anchorUrl, h);
  return {
    anchor: AnchorParser.parse(anchorHtml),
    anchorHtml,
    anchorUrl,
    bootstrap,
    cfg,
    headers: h,
  };
}

const ctx = await loadAnchor();
const cfg =
  ctx.cfg ??
  Config.fromEnv({
    siteKey: "6LdoaXQrAAAAADQviABd-eByJu6kPL8awKDyc1zb",
    enterprise: true,
    action: "login",
  });

const r = await AnchorVmRunner.run({
  cfg,
  bootstrap: ctx.bootstrap,
  anchor: ctx.anchor,
  anchorHtml: ctx.anchorHtml,
  anchorUrl: ctx.anchorUrl,
  headers: ctx.headers ?? cfg.googleHeaders(),
  onLog: (s, d) => console.log(`[${s}]`, d),
});

console.log("\n=== Rapport ErrorMain ===\n");
console.log(JSON.stringify(r.errorMainReport, null, 2));
