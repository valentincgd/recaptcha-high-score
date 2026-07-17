/**
 * test_tmpt_warm.mjs — tmpt via POOL chaud à empreinte tournante, bout en bout.
 * Pour chaque token : fetchTmpt(warm) → cookie tmpt → replay page event (IP directe).
 * Montre profil (empreinte), tmpt, statut replay, temps.
 */
import { fetchTmpt } from "./tmpt.mjs";
import { stopWarm } from "./api/WarmService.mjs";

const url = "https://www.ticketmaster.com/event/020064BAD9B8236F";
const origin = "https://www.ticketmaster.com";

async function replay(hints, tmpt) {
  const H = { "user-agent": hints.user_agent, "accept-language": hints.accept_lang, "sec-ch-ua": hints.sec_ch_ua, "sec-ch-ua-mobile": hints.sec_ch_ua_mobile, "sec-ch-ua-platform": hints.sec_ch_ua_platform, accept: "text/html,*/*;q=0.8", "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", "sec-fetch-site": "none", "upgrade-insecure-requests": "1", cookie: "tmpt=" + tmpt };
  const res = await fetch(url, { headers: H, redirect: "manual" });
  return res.status;
}

for (let i = 1; i <= 4; i++) {
  const s = Date.now();
  try {
    const d = await fetchTmpt({ url, action: "Event", warm: true, poolSize: 3 });
    const st = await replay(d, d.tmpt);
    console.log(`#${i}  profil=${(d.profile_id || "").padEnd(20)}  tmpt=${d.tmpt.slice(0, 22)}…  reload=${d.reload_status} champ16=${d.field16_len}  page=${st}${st === 200 ? " ✅" : ""}  → ${((Date.now() - s) / 1000).toFixed(1)}s`);
  } catch (e) { console.log(`#${i}  ERREUR: ${e.message}`); }
}
stopWarm();
process.exit(0);
