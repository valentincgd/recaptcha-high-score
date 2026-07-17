import { getToken } from "./api.mjs";

getToken().catch((err) => {
  console.error("[erreur]", err.message);
  process.exit(1);
});
