/**
 * test_zb_login.mjs — TEST DECISIF : le token ZB login avec field16 GENUINE (override) passe-t-il
 * signInSimple (sans nds-pmd) ? tmpt flat (XV LoginPage) + token ZB (genuine field16) + POST /json/sign-in.
 */
import { solveFlat } from "./flat.mjs";
import { fetchTmpt } from "./tmpt.mjs";

const AUTH = "https://auth.ticketmaster.com";
const AUTH_URL = AUTH + "/as/authorization.oauth2?client_id=8bf7204a7e97.web.ticketmaster.us&response_type=code&scope=openid%20profile%20phone%20email%20tm&redirect_uri=https%3A%2F%2Fidentity.ticketmaster.com%2Fexchange&visualPresets=tm&lang=en-us&placementId=mytmlogin&hideLeftPanel=false&integratorId=prd1741.iccp&intSiteToken=tm-us&disableAutoOptIn=false";
const XV = "6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV";
const ZB = "6LdoaXQrAAAAADQviABd-eByJu6kPL8awKDyc1zb";
const EMAIL = process.env.T_EMAIL || "valentincgdpro@gmail.com";
const PW = process.env.T_PW || "Valou12345!!!!!!";
const F16 = "./api/vm/field16_zb_plaintext.json";

// 1) tmpt (XV LoginPage) — field16 flat normal
delete process.env.RC_F16_PLAINTEXT;
console.log("1) tmpt (XV LoginPage)...");
const tm = await fetchTmpt({ url: AUTH_URL, action: "LoginPage", siteKey: XV, isEnterprise: false, flat: true }).catch((e) => ({ err: e.message }));
if (tm.err || !tm.tmpt) { console.log("tmpt KO:", tm.err || tm); process.exit(1); }
console.log("   tmpt:", tm.tmpt.slice(0, 26), "| eps_sid:", (tm.eps_sid || "").slice(0, 20));

// 2) token ZB login avec field16 GENUINE (override)
for (const mode of ["FLAT-NORMAL", "GENUINE-OVERRIDE"]) {
  if (mode === "GENUINE-OVERRIDE") process.env.RC_F16_PLAINTEXT = F16; else delete process.env.RC_F16_PLAINTEXT;
  console.log(`\n2) token ZB login [${mode}]...`);
  const zb = await solveFlat({ siteKey: ZB, action: "login", origin: AUTH, referer: AUTH_URL, mode: "api2", prime: 2 }).catch((e) => ({ err: e.message }));
  if (zb.err || !zb.token) { console.log("   ZB token KO:", zb.err); continue; }
  console.log("   ZB token:", zb.token.slice(0, 22), "len:", zb.token.length);

  // 3) POST /json/sign-in
  const cookie = "tmpt=" + tm.tmpt + (tm.eps_sid ? "; eps_sid=" + tm.eps_sid : "") + "; ma.LANGUAGE=en-us";
  const ch = zb.clientHints || {};
  const headers = {
    "accept": "*/*", "content-type": "application/json", "accept-language": ch.accept_lang || "en-US,en;q=0.9",
    "user-agent": ch.user_agent || tm.user_agent || "", "sec-ch-ua": ch.sec_ch_ua || "", "sec-ch-ua-mobile": "?0", "sec-ch-ua-platform": ch.sec_ch_ua_platform || '"Windows"',
    "origin": AUTH, "referer": AUTH_URL, "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", "sec-fetch-site": "same-origin",
    "tm-client-id": "8bf7204a7e97.web.ticketmaster.us", "tm-integrator-id": "prd1741.iccp", "tm-oauth-type": "tm-auth", "tm-placement-id": "mytmlogin", "tm-site-token": "tm-us", "cookie": cookie,
  };
  const r = await fetch(AUTH + "/json/sign-in", { method: "POST", headers, body: JSON.stringify({ email: EMAIL, password: PW, recaptchaToken: zb.token, externalUserToken: null }), redirect: "manual" });
  const txt = await r.text();
  console.log(`   >>> /json/sign-in [${mode}] HTTP ${r.status} : ${txt.slice(0, 160)}`);
}
