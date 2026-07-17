/**
 * test_score.mjs — Test du SCORE réel du token (champ 16 généré par l'algo Google via jsdom).
 * Utilise le démo officiel Google (seul oracle public qui renvoie un score numérique).
 * Prouve aussi l'auto-suffisance de final/ : solveViaJsdom → final/vendor/rcjsdom (aucun parent).
 */
import { solveViaJsdom } from "./api/JsdomSolver.mjs";
import { verifyDemoScore, DEMO } from "./index.mjs";

const t0 = Date.now();
const PROXY = process.env.T_PROXY || null;
const HL = process.env.T_HL || "fr";
if (PROXY) {
  // Géo de l'IP de sortie (un mismatch géo/langue/timezone baisse le score reCAPTCHA).
  try {
    const g = await (await fetch("https://ipwho.is/", { /* via proxy impossible ici; info indicative */ })).json().catch(() => ({}));
    console.error(`[score] proxy=${PROXY.replace(/:[^:@]*@/, ":***@")} (géo IP directe: ${g.country_code || "?"})`);
  } catch {}
}
console.error(`[score] génération token démo (sitekey ${DEMO.siteKey.slice(0, 12)}…, jsdom, hl=${HL}, proxy=${!!PROXY})`);

const r = await solveViaJsdom({
  siteKey: DEMO.siteKey,
  action: DEMO.action,
  origin: DEMO.origin,
  pageUrl: DEMO.referer,
  mode: "standard", // démo = reCAPTCHA v3 classique (api.js)
  proxy: PROXY,
  hl: HL,
  executeTimes: Number(process.env.T_EXEC) || 2,
  verbose: true,
});

console.error(`[score] token ${r.token?.length}o, reload HTTP ${r.reloadStatus}, champ16=${r.field16Len}`);
if (!r.token) { console.error("[score] pas de token"); process.exit(1); }

const v = await verifyDemoScore(r.token, DEMO.action);
console.log(JSON.stringify({
  success: v.success,
  score: v.score,
  reload_status: r.reloadStatus,
  field16_len: r.field16Len,
  hostname: v.raw?.hostname,
  action: v.raw?.action,
  ms: Date.now() - t0,
}, null, 2));
process.exit(0);
