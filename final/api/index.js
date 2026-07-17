export { Config } from "./Config.js";
export { HttpClient } from "./HttpClient.js";
export { HashUtil } from "./HashUtil.js";
export { CallbackGenerator } from "./CallbackGenerator.js";
export { EnterpriseBootstrapParser } from "./EnterpriseBootstrapParser.js";
export { AnchorParser } from "./AnchorParser.js";
export { ProtobufWire } from "./ProtobufWire.js";
export { ReloadBuilder } from "./ReloadBuilder.js";
export { ReloadResponseParser } from "./ReloadResponseParser.js";
export { RecaptchaEnterprise } from "./RecaptchaEnterprise.js";
export {
  TM_SITE_KEYS,
  buildTokenRequestOptions,
  ticketmasterTokenOptions,
  formatTicketmasterApiResponse,
  formatTokenApiResponse,
  validateExternalSiteRequest,
} from "./TicketmasterProfile.js";
export {
  computeReloadQualityScore,
  isReloadAcceptable,
} from "./SiteKeySupport.js";

import { Config } from "./Config.js";
import { RecaptchaEnterprise } from "./RecaptchaEnterprise.js";
import { ProtobufWire } from "./ProtobufWire.js";

export const DEFAULTS = Config.DEFAULTS;

export function googleHeaders(cfg) {
  const c = cfg instanceof Config ? cfg : Config.fromEnv(cfg);
  return c.googleHeaders();
}

export function ticketmasterHeaders(cfg) {
  const c = cfg instanceof Config ? cfg : Config.fromEnv(cfg);
  return c.ticketmasterHeaders();
}

export function encodeOriginCo(origin) {
  return Config.fromEnv({ origin }).encodeOriginCo();
}

export function buildAnchorUrl({
  apiBase,
  siteKey,
  co,
  hl,
  version,
  size,
  cb,
  anchorMs,
  executeMs,
}) {
  const p = new URLSearchParams({
    ar: "1",
    k: siteKey,
    co,
    hl,
    v: version,
    size,
    "anchor-ms": anchorMs,
    "execute-ms": executeMs,
    cb,
  });
  return `${apiBase}anchor?${p}`;
}

export function decodeProtobufMessage(buf) {
  return ProtobufWire.decodeMessage(buf);
}

export async function getToken(options = {}) {
  const client = new RecaptchaEnterprise(options);
  return client.getToken();
}
