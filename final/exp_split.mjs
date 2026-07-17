// Sépare l'IP du mint reCAPTCHA (token) de l'IP du mint /epsf (tmpt). Replay toujours DIRECT.
import { solveViaJsdom } from "./api/JsdomSolver.mjs";
import { HttpClient } from "./api/HttpClient.js";
import { CookieJar } from "./api/CookieJar.js";
const PROXY = "http://fBs9M6aL:6FbvX5bw-039319509@tickets-us-s.reserve2.resi.unknownproxies.com:14004";
const ORIGIN = "https://www.ticketmaster.com";
const PAGE = ORIGIN + "/event/1E0064620FE4DD7A";
const KEY = "6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV";
async function tokenVia(proxy) {
  const r = await solveViaJsdom({ siteKey: KEY, action: "Event", origin: ORIGIN, pageUrl: PAGE, proxy, mode: "enterprise", timeoutMs: 180000 });
  return r;
}
async function tmptVia(token, hints, proxy) {
  const jar = new CookieJar();
  try { await HttpClient.fetchText(ORIGIN + "/eps-mgr", { "user-agent": hints.user_agent, "accept-language": hints.accept_lang, referer: PAGE, accept: "*/*", "sec-fetch-dest":"script","sec-fetch-mode":"no-cors","sec-fetch-site":"same-origin" }, jar, proxy); } catch {}
  const body = JSON.stringify({ hostname: "www.ticketmaster.com", key: KEY, token });
  try { await HttpClient.fetchBuffer(ORIGIN + "/epsf/gec/v3/Event", { method: "POST", headers: { "user-agent": hints.user_agent, "accept-language": hints.accept_lang, "content-type":"application/json", origin: ORIGIN, referer: ORIGIN+"/", accept:"*/*", "sec-fetch-dest":"empty","sec-fetch-mode":"cors","sec-fetch-site":"same-origin" }, body }, jar, proxy); } catch {}
  return jar.get("tmpt");
}
async function replay(tmpt, hints) {
  try { await HttpClient.fetchBuffer(PAGE, { method:"GET", headers: { "user-agent":hints.user_agent, "accept-language":hints.accept_lang, accept:"text/html,*/*;q=0.8", cookie:"tmpt="+tmpt } }, null, null); return 200; }
  catch (e) { const m=String(e.message).match(/HTTP (\d+)/); return m?Number(m[1]):0; }
}
// Mint les deux tokens une fois
console.log("mint token reCAPTCHA direct + via proxy…");
const tkD = await tokenVia(null);
const tkP = await tokenVia(PROXY);
console.log(`  token direct reload=${tkD.reloadStatus}  token proxy reload=${tkP.reloadStatus}\n`);
for (const [lbl, tk, epsProxy] of [
  ["recaptcha DIRECT + epsf DIRECT", tkD, null],
  ["recaptcha DIRECT + epsf PROXY ", tkD, PROXY],
  ["recaptcha PROXY  + epsf DIRECT", tkP, null],
  ["recaptcha PROXY  + epsf PROXY ", tkP, PROXY],
]) {
  const tmpt = await tmptVia(tk.token, tk.clientHints, epsProxy);
  const st = tmpt ? await replay(tmpt, tk.clientHints) : "-";
  console.log(`${lbl}  tmpt=${tmpt?tmpt.slice(0,14)+"…":"NULL"}  replay direct HTTP ${st}  ${st===403?"❌":st===200?"✅":""}`);
}
process.exit(0);
