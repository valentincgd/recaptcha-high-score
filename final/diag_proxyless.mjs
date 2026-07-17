// Test tmpt PROXYLESS : mint sans proxy (IP directe), replay event page + quickpicks.
import { solveViaJsdom } from "./api/JsdomSolver.mjs";
const EID = process.env.T_EVENT_ID || "020064BAD9B8236F";
const origin = "https://www.ticketmaster.com";
const EVENT = `${origin}/event/${EID}`;
const KEY = "6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV";
const QP = `https://offeradapter.ticketmaster.com/api/ismds/event/${EID}/quickpicks?show=places+maxQuantity+sections&mode=primary:ppsectionrow+resale:ga_areas+platinum:all&qty=2&q=not(%27accessible%27)&includeStandard=true&includeResale=true&ticketTypes=061200000009%2C000000000001%2C0016000E0009&embed=area&embed=offer&embed=description&apikey=b462oi7fic6pehcdkzony5bxhe&apisecret=pquzpfrfz7zd2ylvtz3w5dtyse&resaleChannelId=internal.ecommerce.consumer.desktop.web.browser.ticketmaster.us&limit=40&offset=0&sort=noTaxTotalprice&promoted=primary`;

const r = await solveViaJsdom({ siteKey: KEY, action: "Event", origin, pageUrl: EVENT, proxy: null, mode: "enterprise", executeTimes: 2 });
console.log(`[proxyless] token=${r.token?.length}o reload=${r.reloadStatus} champ16=${r.field16Len}`);
const H = { "user-agent": r.clientHints.user_agent, "accept-language": r.clientHints.accept_lang, "sec-ch-ua": r.clientHints.sec_ch_ua, "sec-ch-ua-mobile": r.clientHints.sec_ch_ua_mobile, "sec-ch-ua-platform": r.clientHints.sec_ch_ua_platform };
const em = await fetch(origin + "/eps-mgr", { headers: { ...H, accept: "*/*", referer: EVENT } });
const emc = (em.headers.getSetCookie?.() || []).map(c => c.split(";")[0]);
const sid = (emc.find(c => c.startsWith("eps_sid=")) || "").split("=").slice(1).join("=");
const ef = await fetch(origin + "/epsf/gec/v3/Event", { method: "POST", headers: { ...H, accept: "*/*", "content-type": "application/json", origin, referer: origin + "/", cookie: emc.join("; ") }, body: JSON.stringify({ hostname: "www.ticketmaster.com", key: KEY, token: r.token }) });
const efc = (ef.headers.getSetCookie?.() || []).map(c => c.split(";")[0]);
console.log("[proxyless] epsf", ef.status, "cookies:", efc.map(c => c.split("=")[0]).join(",") || "(aucun)");
const ck = [...emc, ...efc].filter(c => /^(tmpt|SID|BID|eps_sid)=/.test(c)).join("; ");
async function hit(name, url, extra) { const res = await fetch(url, { headers: { ...H, ...extra, cookie: ck }, redirect: "manual" }); const b = await res.text(); const blk = res.status === 403 || /"response":"block"/.test(b.replace(/\s/g, "")); console.log(`[proxyless] ${name.padEnd(11)} HTTP ${res.status} ${blk ? "BLOCKED" : "OK"} (${b.length}o)`); }
await hit("event-page", EVENT, { accept: "text/html,*/*;q=0.8", "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", "sec-fetch-site": "none", "upgrade-insecure-requests": "1" });
await hit("quickpicks", QP, { accept: "*/*", origin, referer: origin + "/", "sec-fetch-site": "same-site" });
process.exit(0);
