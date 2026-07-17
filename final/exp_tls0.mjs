// Le token via proxy est mauvais. Seule diff vs direct : le pont node-tls-client. Test RC_TLS=0 (undici via proxy).
import { HttpClient } from "./api/HttpClient.js";
import { CookieJar } from "./api/CookieJar.js";
import { spawn } from "node:child_process";
import path from "node:path";
const ROOT = path.resolve("vendor/rcjsdom");
const PROXY = "http://fBs9M6aL:6FbvX5bw-039319509@tickets-us-s.reserve2.resi.unknownproxies.com:14004";
const ORIGIN = "https://www.ticketmaster.com";
const PAGE = ORIGIN + "/event/1E0064620FE4DD7A";
const KEY = "6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV";

function mintToken(env) {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, ["final_bridge.cjs"], { cwd: ROOT, env: { ...process.env, RC_SITEKEY: KEY, RC_ACTION: "Event", RC_ORIGIN: ORIGIN, RC_PAGE_URL: PAGE, RC_MODE: "enterprise", RC_HL: "en", RC_PROXY: PROXY, ...env } });
    let out = ""; child.stdout.on("data", d => out += d); child.stderr.on("data", () => {});
    child.on("close", () => { const m = out.match(/__FINAL_JSON__([\s\S]*?)__END__/); if (!m) return rej(new Error("no json")); res(JSON.parse(m[1])); });
    setTimeout(() => { child.kill(); rej(new Error("timeout")); }, 180000);
  });
}
async function tmptDirect(token, hints) {
  const jar = new CookieJar();
  try { await HttpClient.fetchText(ORIGIN + "/eps-mgr", { "user-agent": hints.user_agent, "accept-language": hints.accept_lang, referer: PAGE, accept: "*/*", "sec-fetch-dest":"script","sec-fetch-mode":"no-cors","sec-fetch-site":"same-origin" }, jar, null); } catch {}
  const body = JSON.stringify({ hostname: "www.ticketmaster.com", key: KEY, token });
  try { await HttpClient.fetchBuffer(ORIGIN + "/epsf/gec/v3/Event", { method: "POST", headers: { "user-agent": hints.user_agent, "accept-language": hints.accept_lang, "content-type":"application/json", origin: ORIGIN, referer: ORIGIN+"/", accept:"*/*", "sec-fetch-dest":"empty","sec-fetch-mode":"cors","sec-fetch-site":"same-origin" }, body }, jar, null); } catch {}
  return jar.get("tmpt");
}
async function replay(tmpt, hints) {
  try { await HttpClient.fetchBuffer(PAGE, { method:"GET", headers: { "user-agent":hints.user_agent, "accept-language":hints.accept_lang, accept:"text/html,*/*;q=0.8", cookie:"tmpt="+tmpt } }, null, null); return 200; }
  catch (e) { const m=String(e.message).match(/HTTP (\d+)/); return m?Number(m[1]):0; }
}
for (const [lbl, env] of [["proxy + PONT TLS Chrome (défaut)", {}], ["proxy + RC_TLS=0 (undici Node)", { RC_TLS: "0" }]]) {
  try {
    const r = await mintToken(env);
    const tmpt = await tmptDirect(r.token, r.clientHints);
    const st = tmpt ? await replay(tmpt, r.clientHints) : "-";
    console.log(`${lbl.padEnd(36)} token=${r.token?.length}o reload=${r.reloadStatus}  tmpt=${tmpt?tmpt.slice(0,14)+"…":"NULL"}  replay ${st} ${st===200?"✅":st===403?"❌":""}`);
  } catch (e) { console.log(`${lbl.padEnd(36)} ERREUR ${e.message}`); }
}
process.exit(0);
