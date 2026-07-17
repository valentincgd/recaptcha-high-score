/**
 * exp_isolate.mjs — Le score reCAPTCHA est 0.9 même via proxy, pourtant TM bloque via proxy.
 * On isole OÙ le proxy casse : au MINT du tmpt (POST /epsf) ou au REPLAY de la requête cible.
 *
 * Matrice : { tmpt minté via proxy | proxyless } × { rejoué via proxy | proxyless }.
 *   - si "minté via proxy" bloque quel que soit le replay → le tmpt naît "bloqué" (contexte de mint)
 *   - si "rejoué via proxy" bloque quel que soit le mint  → c'est le contexte du replay
 *
 *   $env:T_PROXY='135.132.106.226:16446:7V0w1:1g7hArVI'; node exp_isolate.mjs
 */
import { fetchTmpt } from "./tmpt.mjs";
import { HttpClient } from "./api/HttpClient.js";
import { CookieJar } from "./api/CookieJar.js";
import { stopWarm } from "./api/WarmService.mjs";

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

const EVENT_ID = "1E0064620FE4DD7A";
const URL = "https://www.ticketmaster.com/event/" + EVENT_ID;

async function mint(proxy) {
  return fetchTmpt({
    url: URL, action: "Event",
    siteKey: "6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV", isEnterprise: true,
    proxy, warm: false,
  });
}

async function replay(d, proxy) {
  const jar = new CookieJar();
  jar.setRaw?.("tmpt", d.tmpt); // best effort ; sinon header manuel ci-dessous
  const headers = {
    "user-agent": d.user_agent, "accept-language": d.accept_lang,
    "sec-ch-ua": d.sec_ch_ua, "sec-ch-ua-mobile": d.sec_ch_ua_mobile, "sec-ch-ua-platform": d.sec_ch_ua_platform,
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", "sec-fetch-site": "none",
    "sec-fetch-user": "?1", "upgrade-insecure-requests": "1",
    cookie: "tmpt=" + d.tmpt,
  };
  try {
    await HttpClient.fetchBuffer(URL, { method: "GET", headers }, null, proxy);
    return { status: 200, blocked: false };
  } catch (e) {
    const m = String(e.message).match(/HTTP (\d+)/);
    const status = m ? Number(m[1]) : 0;
    return { status, blocked: status === 403 };
  }
}

console.log(`Proxy = ${PROXY || "PROXYLESS"}\n`);
console.log("Mint des deux tmpt…");
const tProxy = PROXY ? await mint(PROXY) : null;
const tDirect = await mint(null);
console.log(`  tmpt(proxy)   = ${tProxy ? tProxy.tmpt.slice(0, 24) + "…  score/reload=" + tProxy.reload_status : "—"}`);
console.log(`  tmpt(direct)  = ${tDirect.tmpt.slice(0, 24)}…  reload=${tDirect.reload_status}\n`);

const combos = [
  ["mint PROXY   → replay PROXY  ", tProxy, PROXY],
  ["mint PROXY   → replay DIRECT ", tProxy, null],
  ["mint DIRECT  → replay PROXY  ", tDirect, PROXY],
  ["mint DIRECT  → replay DIRECT ", tDirect, null],
];
for (const [label, d, rproxy] of combos) {
  if (!d) { console.log(`${label}  (skip)`); continue; }
  const r = await replay(d, rproxy);
  console.log(`${label}  HTTP ${r.status}  ${r.blocked ? "❌ BLOCK" : "✅ ok"}`);
}
stopWarm();
process.exit(0);
