/**
 * Point d'entrée CLI — implémentation dans ./api/
 *
 * Usage :
 *   node api.mjs
 *   import { getToken } from "./api.mjs";
 */

export {
  DEFAULTS,
  Config,
  HttpClient,
  HashUtil,
  CallbackGenerator,
  EnterpriseBootstrapParser,
  AnchorParser,
  ProtobufWire,
  ReloadBuilder,
  ReloadResponseParser,
  RecaptchaEnterprise,
  googleHeaders,
  ticketmasterHeaders,
  encodeOriginCo,
  buildAnchorUrl,
  decodeProtobufMessage,
  getToken,
  ticketmasterTokenOptions,
  formatTicketmasterApiResponse,
  TM_SITE_KEYS,
} from "./api/index.js";

import { fileURLToPath } from "node:url";
import { getToken, ticketmasterTokenOptions } from "./api/index.js";

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const tm = process.argv.includes("--tm");
  const altKey = process.argv.includes("--alt-key");
  const tmOpts = tm ? ticketmasterTokenOptions({ variant: altKey ? "alt" : undefined }) : {};
  getToken(tm ? tmOpts : {})
    .then((r) => {
      console.log(
        JSON.stringify(
          {
            siteKey: r.siteKey,
            token: r.token,
            success: r.success,
            mode: r.mode,
            pipeline: r.pipeline,
            ticketmasterScore: r.ticketmasterScore,
            tmCookies: r.tmCookies,
            reloadError: r.reloadError,
            hint: r.hint,
          },
          null,
          2,
        ),
      );
      if (r.ticketmasterScore === "low" && r.success) process.exitCode = 2;
      if (!r.success) process.exitCode = 1;
    })
    .catch((err) => {
      console.error("[erreur]", err.message);
      process.exit(1);
    });
}
