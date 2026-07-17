/**
 * Sauvegarde encryptionKey de l'anchor (session HTTP live).
 *
 *   node tools/capture-tm-session.mjs
 *   → captures/tm-session.json
 *
 * Puis POST /api/token/tm (reload généré en JSDOM)
 */
import { writeFileSync } from "node:fs";
import { Config } from "../api/Config.js";
import { ticketmasterTokenOptions } from "../api/TicketmasterProfile.js";
import { HttpClient } from "../api/HttpClient.js";
import { CookieJar } from "../api/CookieJar.js";
import { EnterpriseBootstrapParser } from "../api/EnterpriseBootstrapParser.js";
import { CallbackGenerator } from "../api/CallbackGenerator.js";
import { AnchorParser } from "../api/AnchorParser.js";

const cfg = new Config(ticketmasterTokenOptions({ quiet: true }));
const headers = cfg.googleHeaders();
const jar = new CookieJar();

const js = await HttpClient.fetchText(
  `https://www.google.com/recaptcha/enterprise.js?render=${cfg.siteKey}`,
  headers,
  jar,
);
const bootstrap = EnterpriseBootstrapParser.parse(js);
await HttpClient.fetchText(
  bootstrap.scriptUrl,
  { ...headers, referer: "https://www.google.com/" },
  jar,
);

const cb = CallbackGenerator.generate();
const p = new URLSearchParams({
  ar: "1",
  k: cfg.siteKey,
  co: cfg.encodeOriginCo(),
  hl: cfg.hl,
  v: bootstrap.version,
  size: cfg.size,
  "anchor-ms": cfg.anchorMs,
  "execute-ms": cfg.executeMs,
  cb,
});
const html = await HttpClient.fetchText(
  `${bootstrap.apiBase}anchor?${p}`,
  headers,
  jar,
);
const anchor = AnchorParser.parse(html);

const out = {
  encryptionKey: anchor.encryptionKey,
  version: bootstrap.version,
  siteKey: cfg.siteKey,
  anchorTokenLength: anchor.anchorToken?.length,
  capturedAt: new Date().toISOString(),
};

writeFileSync("captures/tm-session.json", JSON.stringify(out, null, 2));
console.log("captures/tm-session.json écrit — lance npm run token:tm");
