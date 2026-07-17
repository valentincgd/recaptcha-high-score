import { fetchTmpt } from "./tmpt.mjs";
import { HttpClient } from "./api/HttpClient.js";
const PROXY = "http://kyzenpro:0637fd1ce4a6b5f3_country-France_session-WWWFIX7@proxy.packetstream.io:31112";
const AUTH="https://auth.ticketmaster.com/as/authorization.oauth2?client_id=8bf7204a7e97.web.ticketmaster.us&response_type=code&scope=openid%20profile%20phone%20email%20tm&redirect_uri=https://identity.ticketmaster.com/exchange&visualPresets=tm&lang=en-us&placementId=mytmlogin";
const AUTH_KEY="6LdoaXQrAAAAADQviABd-eByJu6kPL8awKDyc1zb";
const PAGE="https://www.ticketmaster.com/event/1E0064620FE4DD7A";
const KEY="6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV";
async function get(url,cookie,proxy,h){ try{ await HttpClient.fetchBuffer(url,{method:"GET",headers:{"user-agent":h.user_agent,"accept-language":h.accept_lang,accept:"text/html,*/*;q=0.8","sec-ch-ua":h.sec_ch_ua,"sec-ch-ua-mobile":h.sec_ch_ua_mobile,"sec-ch-ua-platform":h.sec_ch_ua_platform,"sec-fetch-dest":"document","sec-fetch-mode":"navigate","sec-fetch-site":"none","upgrade-insecure-requests":"1",cookie}},null,proxy); return 200; }catch(e){ const m=String(e.message).match(/HTTP (\d+)/); return m?Number(m[1]):"ERR"; } }
async function mint(url,key,action,ex){ for(let i=1;i<=6;i++){ try{ return await fetchTmpt({url,action,siteKey:key,proxy:PROXY,hl:"fr",warm:false,executeTimes:ex}); }catch(e){} } return null; }
try{ const j=JSON.parse(await HttpClient.fetchText("https://ipinfo.io/json",{"user-agent":"curl/8"},null,PROXY)); console.log(`IP sticky = ${j.ip} (${j.country}, ${j.city})\n`);}catch{}
const a = await mint(AUTH,AUTH_KEY,"LoginPage",2);
console.log(`AUTH (6Ldo) sur cette IP → ${a?await get(AUTH,"tmpt="+a.tmpt,PROXY,a):"mint KO"}`);
for (const ex of [2,4,6]) {
  const d = await mint(PAGE,KEY,"Event",ex);
  if(!d){ console.log(`WWW executeTimes=${ex}  mint KO`); continue; }
  console.log(`WWW (6Lcv) executeTimes=${ex}  champ16=${d.field16_len}  → ${await get(PAGE,"tmpt="+d.tmpt,PROXY,d)}`);
}
process.exit(0);
