import { RecaptchaEnterprise } from "./api/RecaptchaEnterprise.js";
import { Config } from "./api/Config.js";
import { setRequestProxy, clearRequestProxy } from "./api/httpProxy.js";
import { FINAL_DEFAULTS, TM_ALT_SITE_KEY } from "./config.mjs";
import { isTicketmasterHostname, parsePageUrl } from "./urlContext.mjs";
import { pickFingerprint } from "./fingerprintPool.mjs";

/**
 * Token Enterprise dynamique — JSDOM off, profil aléatoire depuis fingerprints.json, proxy obligatoire.
 */
export async function generateTmAltToken({
  url,
  siteKey = TM_ALT_SITE_KEY,
  action,
  enterprise = true,
  title = null,
  proxy,
  quiet = false,
}) {
  if (!proxy?.trim()) {
    throw new Error("proxy requis pour toutes les requêtes captcha");
  }

  const page = parsePageUrl(url);
  if (!isTicketmasterHostname(page.hostname)) {
    throw new Error(
      `hostname non Ticketmaster: ${page.hostname} — domaines *.ticketmaster.* uniquement`,
    );
  }

  const prev = {
    jsdom: process.env.RECAPTCHA_JSDOM_BROWSER,
    chrome: process.env.RECAPTCHA_CHROME_CAPTURE,
    identical: process.env.RECAPTCHA_IDENTICAL,
    template: process.env.RECAPTCHA_RELOAD_TEMPLATE,
  };
  process.env.RECAPTCHA_JSDOM_BROWSER = "0";
  process.env.RECAPTCHA_CHROME_CAPTURE = "0";
  process.env.RECAPTCHA_IDENTICAL = "0";
  delete process.env.RECAPTCHA_RELOAD_TEMPLATE;

  setRequestProxy(proxy);

  try {
    const mode = enterprise ? "enterprise" : "api2";
    const seed = `${siteKey}:${page.origin}:${action}:${Date.now()}:${Math.random()}`;
    const profile = pickFingerprint(seed);
    if (title) profile.title = title;
    profile.language = profile.acceptLang?.split(",")[0]?.split(";")[0] ?? "fr-FR";
    profile.languages = profile.acceptLang?.split(",").map((s) => s.split(";")[0]) ?? [
      "fr-FR",
      "fr",
      "en",
    ];

    const cfg = Config.fromEnv({
      ...FINAL_DEFAULTS,
      siteKey,
      enterprise,
      mode,
      action: String(action ?? FINAL_DEFAULTS.action).trim() || FINAL_DEFAULTS.action,
      origin: page.origin,
      referer: page.referer,
      preserveOrigin: true,
      reloadTemplatePath: "",
      chromeCapture: false,
      autoDump: false,
      skipScript: false,
      quiet: false,
      verbose: true,
      logResult: false,
      fingerprint: profile,
      userAgent: profile.userAgent,
    });
    cfg._fingerprintSession = profile.id;

    const client = new RecaptchaEnterprise(cfg);
    const result = await client.getToken();

    return {
      ...result,
      pageUrl: url,
      pageOrigin: page.origin,
      pageReferer: page.referer,
      siteKey,
      enterprise,
      fingerprintProfile: profile,
      proxy,
    };
  } finally {
    clearRequestProxy();
    for (const [, envKey, val] of [
      ["jsdom", "RECAPTCHA_JSDOM_BROWSER", prev.jsdom],
      ["chrome", "RECAPTCHA_CHROME_CAPTURE", prev.chrome],
      ["identical", "RECAPTCHA_IDENTICAL", prev.identical],
      ["template", "RECAPTCHA_RELOAD_TEMPLATE", prev.template],
    ]) {
      if (val === undefined) delete process.env[envKey];
      else process.env[envKey] = val;
    }
  }
}
