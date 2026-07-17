// Le champ 16 PUR NODE (sans jsdom) passe-t-il l'enterprise Ticketmaster ?
// solve() = VmPureReloadBuilder (aucun jsdom) → tmpt → replay page event (IP directe).
import { solve } from "./index.mjs";
const PROXY = process.env.T_PROXY || null;
const EID = process.env.T_EVENT_ID || "020064BAD9B8236F";
const origin = "https://www.ticketmaster.com";
const EVENT = `${origin}/event/${EID}`;
const KEY = "6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV";

const r = await solve({ siteKey: KEY, action: "Event", origin, referer: EVENT, mode: "enterprise", proxy: PROXY });
console.log("[pure] token:", r.token ? r.token.length + "o" : "NULL", "reloadBytes:", r.reloadBytes, r.hint || "");
if (!r.token) { console.log("[pure] pas de token → reload refusé en pur-Node"); process.exit(1); }
const c = r.clientHints;
const H = { "user-agent": c.user_agent, "accept-language": c.accept_lang, "sec-ch-ua": c.sec_ch_ua, "sec-ch-ua-mobile": c.sec_ch_ua_mobile, "sec-ch-ua-platform": c.sec_ch_ua_platform };
const em = await fetch(origin + "/eps-mgr", { headers: { ...H, accept: "*/*", referer: EVENT } });
const emc = (em.headers.getSetCookie?.() || []).map(x => x.split(";")[0]);
const sid = (emc.find(x => x.startsWith("eps_sid=")) || "").split("=").slice(1).join("=");
const ef = await fetch(origin + "/epsf/gec/v3/Event", { method: "POST", headers: { ...H, accept: "*/*", "content-type": "application/json", origin, referer: origin + "/", cookie: emc.join("; ") }, body: JSON.stringify({ hostname: "www.ticketmaster.com", key: KEY, token: r.token }) });
const efc = (ef.headers.getSetCookie?.() || []).map(x => x.split(";")[0]);
console.log("[pure] epsf", ef.status, "cookies:", efc.map(x => x.split("=")[0]).join(",") || "(aucun)");
const ck = [...emc, ...efc].filter(x => /^(tmpt|SID|BID|eps_sid)=/.test(x)).join("; ");
const pg = await fetch(EVENT, { headers: { ...H, accept: "text/html,*/*;q=0.8", "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", "sec-fetch-site": "none", "upgrade-insecure-requests": "1", cookie: ck }, redirect: "manual" });
console.log("[pure] PAGE EVENT:", pg.status, pg.status === 200 ? "✅ 200 — pur-Node SUFFIT" : "❌ BLOCKED — jsdom nécessaire");
process.exit(0);
