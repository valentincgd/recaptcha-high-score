import { writeFileSync } from "node:fs";
import { HttpClient } from "../api/HttpClient.js";
import { Config } from "../api/Config.js";
import { CallbackGenerator } from "../api/CallbackGenerator.js";
import { EnterpriseBootstrapParser } from "../api/EnterpriseBootstrapParser.js";

const cfg = Config.fromEnv({
  siteKey: "6LdoaXQrAAAAADQviABd-eByJu6kPL8awKDyc1zb",
  enterprise: false,
});
const h = cfg.googleHeaders();
const boot = await HttpClient.fetchText(
  `https://www.google.com/recaptcha/api.js?render=${cfg.siteKey}`,
  h,
);
const b = EnterpriseBootstrapParser.parse(boot);
const url = cfg.buildAnchorUrl({
  apiBase: b.apiBase,
  version: b.version,
  cb: CallbackGenerator.generate(),
});
const html = await HttpClient.fetchText(url, h);
writeFileSync("captures/anchor-sample.html", html);
const srcs = [];
for (const m of html.matchAll(/<script\b([^>]*)>/gi)) {
  const tag = m[1];
  const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
  srcs.push({ src: src ?? "(inline)", len: src ? 0 : (html.split(m[0])[1]?.slice(0, 200)?.length ?? 0) });
}
console.log(srcs);
