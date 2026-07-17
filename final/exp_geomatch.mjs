// Mint via proxy US avec empreinte alignée US (en-US + America), replay direct. Si 200 → mismatch géo confirmé/corrigé.
import { fetchTmpt } from "./tmpt.mjs";
import { HttpClient } from "./api/HttpClient.js";
const PROXY = "http://fBs9M6aL:6FbvX5bw-039319509@tickets-us-s.reserve2.resi.unknownproxies.com:14004";
const PAGE = "https://www.ticketmaster.com/event/1E0064620FE4DD7A";
const KEY = "6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV";
async function replay(d) {
  try {
    await HttpClient.fetchBuffer(PAGE, { method: "GET", headers: {
      "user-agent": d.user_agent, "accept-language": d.accept_lang, "sec-ch-ua": d.sec_ch_ua,
      "sec-ch-ua-mobile": d.sec_ch_ua_mobile, "sec-ch-ua-platform": d.sec_ch_ua_platform,
      accept: "text/html,*/*;q=0.8", "sec-fetch-dest":"document","sec-fetch-mode":"navigate",
      "sec-fetch-site":"none","upgrade-insecure-requests":"1", cookie: "tmpt=" + d.tmpt } }, null, null);
    return 200;
  } catch (e) { const m = String(e.message).match(/HTTP (\d+)/); return m?Number(m[1]):0; }
}
async function trial(label, env, hl) {
  for (const k of ["RC_TZ","RC_LOCALE","RC_LANGUAGES"]) delete process.env[k];
  Object.assign(process.env, env);
  const d = await fetchTmpt({ url: PAGE, action: "Event", siteKey: KEY, isEnterprise: true, proxy: PROXY, hl, warm: false });
  const st = await replay(d);
  console.log(`${label.padEnd(42)} tmpt=${d.tmpt.slice(0,16)}…  replay HTTP ${st}  ${st===403?"❌ BLOCK":"✅ OK"}`);
}
await trial("A. via proxy US, empreinte fr-FR/Paris",  { RC_TZ:"Europe/Paris", RC_LOCALE:"fr-FR", RC_LANGUAGES:"fr-FR,fr,en-US,en" }, "fr");
await trial("B. via proxy US, empreinte en-US/LA",     { RC_TZ:"America/Los_Angeles", RC_LOCALE:"en-US", RC_LANGUAGES:"en-US,en" }, "en");
process.exit(0);
