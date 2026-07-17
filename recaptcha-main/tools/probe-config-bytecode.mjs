import { Config } from "../api/Config.js";
import { HttpClient } from "../api/HttpClient.js";
import { CookieJar } from "../api/CookieJar.js";
import { CallbackGenerator } from "../api/CallbackGenerator.js";
import { EnterpriseBootstrapParser } from "../api/EnterpriseBootstrapParser.js";
import { AnchorParser } from "../api/AnchorParser.js";
import { decryptConfigBytecode } from "../api/vm/BytecodeDecoder.js";

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

console.log("encryptionKey", anchor.encryptionKey);
console.log("bft", anchor.config?.bftSignature?.slice(0, 48));
console.log("bytecode len", anchor.configBytecode?.length);

if (anchor.configBytecode) {
  const dec = decryptConfigBytecode(anchor.configBytecode);
  const text = dec.toString("latin1");
  const idx05 = text.indexOf("05AL");
  const idx03 = text.indexOf("03AF");
  console.log("decrypted bytes", dec.length);
  console.log("05AL at", idx05);
  console.log("03AF at", idx03);
  if (idx05 >= 0) console.log("05AL sample", text.slice(idx05, idx05 + 80));
}
