// L'utilisateur : "même pas besoin d'eps_sid pour Event". On teste le POST /epsf minimal via proxy.
import { solveViaJsdom } from "./api/JsdomSolver.mjs";
import { HttpClient } from "./api/HttpClient.js";
import { CookieJar } from "./api/CookieJar.js";
const PROXY = "http://fBs9M6aL:6FbvX5bw-039319509@tickets-us-s.reserve2.resi.unknownproxies.com:14004";
const ORIGIN = "https://www.ticketmaster.com";
const PAGE = ORIGIN + "/event/1E0064620FE4DD7A";
const KEY = "6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV";

async function epsf(token, hints, jar, proxy) {
  const body = JSON.stringify({ hostname: "www.ticketmaster.com", key: KEY, token });
  try {
    await HttpClient.fetchBuffer(ORIGIN + "/epsf/gec/v3/Event", { method: "POST", headers: {
      "user-agent": hints.user_agent, "accept-language": hints.accept_lang, "content-type": "application/json",
      origin: ORIGIN, referer: ORIGIN + "/", "sec-ch-ua": hints.sec_ch_ua, "sec-ch-ua-mobile": hints.sec_ch_ua_mobile,
      "sec-ch-ua-platform": hints.sec_ch_ua_platform, accept: "*/*",
      "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", "sec-fetch-site": "same-origin" }, body }, jar, proxy);
  } catch {}
  return jar.get("tmpt");
}
async function replay(tmpt, hints) {
  try {
    await HttpClient.fetchBuffer(PAGE, { method: "GET", headers: {
      "user-agent": hints.user_agent, "accept-language": hints.accept_lang, "sec-ch-ua": hints.sec_ch_ua,
      "sec-ch-ua-mobile": hints.sec_ch_ua_mobile, "sec-ch-ua-platform": hints.sec_ch_ua_platform,
      accept: "text/html,*/*;q=0.8", "sec-fetch-dest":"document","sec-fetch-mode":"navigate",
      "sec-fetch-site":"none","upgrade-insecure-requests":"1", cookie: "tmpt=" + tmpt } }, null, null);
    return 200;
  } catch (e) { const m = String(e.message).match(/HTTP (\d+)/); return m?Number(m[1]):0; }
}

const r = await solveViaJsdom({ siteKey: KEY, action: "Event", origin: ORIGIN, pageUrl: PAGE, proxy: PROXY, mode: "enterprise", timeoutMs: 180000 });
const hints = r.clientHints;
console.log("token=", r.token?.length, "reload=", r.reloadStatus, "\n");

// V1 : POST /epsf SANS eps_sid (jar vide), via proxy
let jar = new CookieJar();
let t1 = await epsf(r.token, hints, jar, PROXY);
console.log("V1 sans eps_sid  tmpt=", t1 ? t1.slice(0,18)+"…" : "NULL", " replay direct HTTP", t1 ? await replay(t1, hints) : "-");

// V2 : POST /epsf SANS eps_sid via proxy, mais replay VIA PROXY
jar = new CookieJar();
let t2 = await epsf(r.token, hints, jar, PROXY);
console.log("V2 sans eps_sid  tmpt=", t2 ? t2.slice(0,18)+"…" : "NULL", " replay via proxy HTTP", t2 ? await (async()=>{try{await HttpClient.fetchBuffer(PAGE,{method:"GET",headers:{"user-agent":hints.user_agent,"accept-language":hints.accept_lang,accept:"text/html,*/*;q=0.8",cookie:"tmpt="+t2}},null,PROXY);return 200;}catch(e){const m=String(e.message).match(/HTTP (\d+)/);return m?m[1]:0;}})() : "-");
process.exit(0);
