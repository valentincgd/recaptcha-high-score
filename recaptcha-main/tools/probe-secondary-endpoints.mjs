import { Config } from "../api/Config.js";
import { HttpClient } from "../api/HttpClient.js";
import { CookieJar } from "../api/CookieJar.js";
import { CallbackGenerator } from "../api/CallbackGenerator.js";
import { EnterpriseBootstrapParser } from "../api/EnterpriseBootstrapParser.js";
import { AnchorParser } from "../api/AnchorParser.js";

const cfg = Config.fromEnv({
  siteKey: "6LdoaXQrAAAAADQviABd-eByJu6kPL8awKDyc1zb",
  enterprise: true,
});
const jar = new CookieJar();
const headers = cfg.googleHeaders();
const js = await HttpClient.fetchText(
  `https://www.google.com/recaptcha/enterprise.js?render=${cfg.siteKey}`,
  headers,
  jar,
);
const bootstrap = EnterpriseBootstrapParser.parse(js);
const anchorUrl = cfg.buildAnchorUrl({
  apiBase: bootstrap.apiBase,
  version: bootstrap.version,
  cb: CallbackGenerator.generate(),
});
const html = await HttpClient.fetchText(anchorUrl, headers, jar);
const anchor = AnchorParser.parse(html);
const base = bootstrap.apiBase;

const paths = [
  `userverify?k=${cfg.siteKey}`,
  `clr?k=${cfg.siteKey}`,
  `bcn?k=${cfg.siteKey}`,
  `replaceimage?k=${cfg.siteKey}`,
];

for (const p of paths) {
  try {
    const text = await HttpClient.fetchText(`${base}${p}`, {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "application/x-protobuffer",
        origin: "https://www.google.com",
        referer: anchorUrl,
      },
      body: Buffer.from(anchor.anchorToken, "utf8"),
    }, jar);
    const has05 = text.includes("05AL");
    const has0c = text.includes("0cAF");
    console.log(p, "len", text.length, "05AL", has05, "0cAF", has0c, text.slice(0, 120));
  } catch (e) {
    console.log(p, "ERR", e.message.slice(0, 80));
  }
}
