/** @deprecated Utiliser api.mjs ou `npm run flow` */
export { getToken, DEFAULTS, googleHeaders, ticketmasterHeaders } from "./api.mjs";

import { getToken } from "./api.mjs";

getToken().catch((err) => {
  console.error("[erreur]", err.message);
  process.exit(1);
});
