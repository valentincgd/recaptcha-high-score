/**
 * exp_geo_score.mjs — PROUVE que la discordance géo (empreinte↔IP) fait chuter le score reCAPTCHA.
 *
 * Mint le token du DÉMO Google via jsdom (le VRAI algo) à travers un proxy, dans 3 configs,
 * et lit le score réel renvoyé par l'oracle du démo. Le seul facteur qui change = locale/TZ vs IP.
 *
 *   $env:T_PROXY='135.132.106.226:16446:7V0w1:1g7hArVI'; node exp_geo_score.mjs
 */
import { solveViaJsdom } from "./api/JsdomSolver.mjs";
import { verifyDemoScore, DEMO } from "./index.mjs";

function normProxy(raw) {
  raw = (raw || "").trim();
  if (!raw) return null;
  if (raw.includes("://")) return raw;
  const p = raw.split(":");
  if (p.length === 4) return `http://${p[2]}:${p[3]}@${p[0]}:${p[1]}`;
  if (p.length === 2) return `http://${p[0]}:${p[1]}`;
  return raw;
}
const PROXY = normProxy(process.env.T_PROXY || "");

async function run(label, { proxy, tz, locale, langs, hl }) {
  // env lu par le child jsdom au spawn (JsdomSolver hérite de process.env).
  if (tz) process.env.RC_TZ = tz; else delete process.env.RC_TZ;
  if (locale) process.env.RC_LOCALE = locale; else delete process.env.RC_LOCALE;
  if (langs) process.env.RC_LANGUAGES = langs; else delete process.env.RC_LANGUAGES;

  const t0 = Date.now();
  try {
    const r = await solveViaJsdom({
      siteKey: DEMO.siteKey, action: DEMO.action, origin: DEMO.origin,
      pageUrl: DEMO.referer, proxy, hl, mode: "standard", timeoutMs: 180000,
    });
    const v = await verifyDemoScore(r.token, DEMO.action);
    const s = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`${label.padEnd(34)} score=${v.score}  success=${v.success}  reload=${r.reloadStatus}  (${s}s)`);
    return v.score;
  } catch (e) {
    console.log(`${label.padEnd(34)} ERREUR: ${e.message.slice(0, 120)}`);
    return null;
  }
}

console.log(`Proxy = ${PROXY || "PROXYLESS"}\n`);
await run("1. proxyless  fr-FR/Europe", { proxy: null, tz: "Europe/Paris", locale: "fr-FR", langs: "fr-FR,fr,en-US,en", hl: "fr" });
if (PROXY) {
  await run("2. proxy US   fr-FR/Europe (actuel)", { proxy: PROXY, tz: "Europe/Paris", locale: "fr-FR", langs: "fr-FR,fr,en-US,en", hl: "fr" });
  await run("3. proxy US   en-US/America (corrigé)", { proxy: PROXY, tz: "America/New_York", locale: "en-US", langs: "en-US,en", hl: "en" });
}
console.log("\nSi 3 >> 2, la cause du block = discordance géo (empreinte fr-FR/Europe sur IP US) → tmpt faible.");
process.exit(0);
