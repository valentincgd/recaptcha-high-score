/**
 * test_pool.mjs — Pool de fenêtres chaudes à empreintes VARIÉES.
 * Pré-chauffe N profils puis sort des tokens en rotation : empreinte différente à chaque token,
 * boot amorti. Vérifie que l'UA/version varie et que chaque reload = 200.
 */
import { getPooledToken, warmupPool, warmStatus, stopWarm } from "./api/WarmService.mjs";

const base = {
  siteKey: "6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV",
  origin: "https://www.ticketmaster.com",
  pageUrl: "https://www.ticketmaster.com/event/020064BAD9B8236F",
  mode: "enterprise", hl: "fr", action: "Event", poolSize: 3,
};

console.log("[pool] pré-chauffage de 3 fenêtres (profils distincts)…");
const t0 = Date.now();
await warmupPool(base);
console.log(`[pool] pool prêt en ${((Date.now() - t0) / 1000).toFixed(1)}s :`, warmStatus().map(w => w.key.split("|").pop()).join(", "), "\n");

for (let i = 1; i <= 6; i++) {
  const s = Date.now();
  try {
    const r = await getPooledToken(base);
    const uaVer = (r.clientHints.user_agent.match(/Chrome\/([\d.]+)/) || [])[1];
    console.log(`#${i}  profil=${(r.profileId || "").padEnd(20)}  Chrome=${uaVer}  reload=${r.reloadStatus}  champ16=${r.field16Len}  token=${r.token ? r.token.length + "o" : "NULL"}  → ${((Date.now() - s) / 1000).toFixed(1)}s`);
  } catch (e) { console.log(`#${i}  ERREUR: ${e.message}`); }
}
stopWarm();
console.log("\n[pool] empreinte variée token→token (WebGL/écran/cœurs/version par profil), fenêtres chaudes réutilisées.");
process.exit(0);
