import { Config } from "../api/Config.js";
import { HttpClient } from "../api/HttpClient.js";
import { CookieJar } from "../api/CookieJar.js";
import { EnterpriseBootstrapParser } from "../api/EnterpriseBootstrapParser.js";
import { BrowserEnvironment } from "../api/vm/BrowserEnvironment.js";
import { VmScriptLoader } from "../api/vm/VmScriptLoader.js";

const cfg = Config.fromEnv({
  siteKey: "6LdoaXQrAAAAADQviABd-eByJu6kPL8awKDyc1zb",
  enterprise: true,
});
const headers = cfg.googleHeaders();
const jar = new CookieJar();
const js = await HttpClient.fetchText(
  `https://www.google.com/recaptcha/enterprise.js?render=${cfg.siteKey}`,
  headers,
  jar,
);
const bootstrap = EnterpriseBootstrapParser.parse(js);
const { source } = await VmScriptLoader.fetchRecaptchaBundle({
  scriptUrl: bootstrap.scriptUrl,
  headers,
});

const env = new BrowserEnvironment({ origin: cfg.origin, referer: cfg.referer });
env.injectRecaptchaCfg({
  siteKey: cfg.siteKey,
  version: bootstrap.version,
  apiBase: bootstrap.apiBase,
});

try {
  env.runScript(source, bootstrap.scriptUrl);
  console.log("OK script loaded");
  console.log("grecaptcha?", typeof env.window.grecaptcha);
  console.log("enterprise?", typeof env.window.grecaptcha?.enterprise?.execute);
} catch (e) {
  console.log("FAIL", e.message.slice(0, 500));
}
env.close();
