import { HttpClient } from "../api/HttpClient.js";
import { Config } from "../api/Config.js";
import { CallbackGenerator } from "../api/CallbackGenerator.js";
import { EnterpriseBootstrapParser } from "../api/EnterpriseBootstrapParser.js";
import { AnchorParser } from "../api/AnchorParser.js";
import { AnchorVmRunner } from "../api/vm/AnchorVmRunner.js";

const cfg = Config.fromEnv({
  siteKey: "6LdoaXQrAAAAADQviABd-eByJu6kPL8awKDyc1zb",
  enterprise: true,
  mode: "enterprise",
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
const anchor = AnchorParser.parse(anchorHtml);

const r = await AnchorVmRunner.run({
  cfg,
  bootstrap,
  anchor,
  anchorHtml,
  anchorUrl,
  headers: h,
  onLog: (s, d) => console.log(`[${s}]`, d),
});

console.log(
  JSON.stringify(
    {
      reloadBytes: r.body?.length,
      secondarySource: r.secondarySource,
      sends: r.sendCount,
      errors: r.errors,
    },
    null,
    2,
  ),
);
