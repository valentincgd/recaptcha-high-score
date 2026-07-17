import { fetchTmpt } from "./tmpt.mjs";
import { HttpClient } from "./api/HttpClient.js";
const PAGE="https://www.ticketmaster.com/event/1E0064620FE4DD7A";
const KEY="6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV";
const base=(id)=>`http://kyzenpro:0637fd1ce4a6b5f3_country-France_session-${id}@proxy.packetstream.io:31112`;
async function get(cookie,proxy,h){ try{ await HttpClient.fetchBuffer(PAGE,{method:"GET",headers:{"user-agent":h.user_agent,"accept-language":h.accept_lang,accept:"text/html,*/*;q=0.8","sec-ch-ua":h.sec_ch_ua,"sec-ch-ua-mobile":h.sec_ch_ua_mobile,"sec-ch-ua-platform":h.sec_ch_ua_platform,"sec-fetch-dest":"document","sec-fetch-mode":"navigate","sec-fetch-site":"none","upgrade-insecure-requests":"1",cookie}},null,proxy); return 200; }catch(e){ const m=String(e.message).match(/HTTP (\d+)/); return m?Number(m[1]):"ERR"; } }
let pass=0, tot=0;
for (const id of ["PA","PB","PC","PD","PE","PF"]) {
  const P=base(id);
  let ipinfo="?";
  try{ const j=JSON.parse(await HttpClient.fetchText("https://ipinfo.io/json",{"user-agent":"curl/8"},null,P)); ipinfo=`${j.ip} ${j.country}/${j.city}`; }catch{ ipinfo="ip KO"; }
  let res="mintKO";
  for(let i=0;i<4;i++){ try{ const d=await fetchTmpt({url:PAGE,action:"Event",siteKey:KEY,proxy:P,hl:"fr",warm:false}); res=await get("tmpt="+d.tmpt,P,d); break; }catch(e){} }
  tot++; if(res===200)pass++;
  console.log(`session ${id}  ${ipinfo.padEnd(34)} www=${res} ${res===200?"✅":"❌"}`);
}
console.log(`\nwww via France sticky : ${pass}/${tot} bonnes IP`);
process.exit(0);
