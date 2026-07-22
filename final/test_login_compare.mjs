/**
 * test_login_compare.mjs — isole si le TOKEN reCAPTCHA est le discriminant du gate signInSimple.
 * Même flow (tmpt+cookies), 3 variantes de recaptchaToken : (A) notre vrai token primé, (B) bidon, (C) vide.
 * Si les 3 donnent la MÊME erreur → le token n'est pas le gate (compte/env/tmpt). Sinon → le token compte.
 */
const API = "http://127.0.0.1:3848/api/captcha";
const AUTH_URL = "https://auth.ticketmaster.com/as/authorization.oauth2?client_id=8bf7204a7e97.web.ticketmaster.us&response_type=code&scope=openid%20profile%20phone%20email%20tm&redirect_uri=https%3A%2F%2Fidentity.ticketmaster.com%2Fexchange&visualPresets=tm&lang=en-us&placementId=mytmlogin&hideLeftPanel=false&integratorId=prd1741.iccp&intSiteToken=tm-us&disableAutoOptIn=false";
const ZB = "6LdoaXQrAAAAADQviABd-eByJu6kPL8awKDyc1zb";
const EMAIL = process.env.T_EMAIL || "valentincgdpro@gmail.com";
const PW = process.env.T_PW || "Valou12345!!!!!!";
const PROXY = process.env.T_PROXY || null;
const post = async (p, b) => (await fetch(API + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) })).json();

async function attempt(label, tokenOverride) {
  // tmpt + eps_sid FRAIS par tentative (comme un vrai navigateur : nouveau widget)
  const tm = await post("/tmpt", { websiteUrl: AUTH_URL, recaptchaSitekey: ZB, action: "LoginPage", isEnterprise: false, ...(PROXY ? { proxy: PROXY } : {}) });
  if (tm.status !== "success") return console.log(label, "tmpt KO", tm.error);
  const d = tm.data;
  let token = tokenOverride;
  if (token === undefined) {
    const tk = await post("/token", { url: AUTH_URL, sitekey: ZB, action: "login", ...(PROXY ? { proxy: PROXY } : {}) });
    token = tk.status === "success" ? tk.data.token : "";
  }
  const cookie = "tmpt=" + d.tmpt + (d.eps_sid ? "; eps_sid=" + d.eps_sid : "") + "; ma.LANGUAGE=en-us";
  const headers = {
    "accept": "*/*", "content-type": "application/json", "accept-language": d.accept_lang || "en-US,en;q=0.9",
    "user-agent": d.user_agent || "", "sec-ch-ua": d.sec_ch_ua || "", "sec-ch-ua-mobile": d.sec_ch_ua_mobile || "?0",
    "sec-ch-ua-platform": d.sec_ch_ua_platform || '"Windows"', "origin": "https://auth.ticketmaster.com", "referer": AUTH_URL,
    "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", "sec-fetch-site": "same-origin",
    "tm-client-id": "8bf7204a7e97.web.ticketmaster.us", "tm-integrator-id": "prd1741.iccp",
    "tm-oauth-type": "tm-auth", "tm-placement-id": "mytmlogin", "tm-site-token": "tm-us", "cookie": cookie,
  };
  const body = { email: EMAIL, password: PW, recaptchaToken: token, externalUserToken: null };
  const r = await fetch("https://auth.ticketmaster.com/json/sign-in", { method: "POST", headers, body: JSON.stringify(body), redirect: "manual" });
  const txt = await r.text();
  let j = {}; try { j = JSON.parse(txt); } catch (_) {}
  console.log(`\n[${label}] token=${token ? token.slice(0, 12) + "…(" + token.length + ")" : "VIDE"}`);
  console.log(`  HTTP ${r.status} | errorType=${j.errorType || "-"} | errorCode=${j.errorCode || "-"}`);
  console.log(`  message=${(j.message || txt.slice(0, 120)).slice(0, 120)}`);
  return { status: r.status, code: j.errorCode || "", type: j.errorType || "" };
}

const A = await attempt("A/notre-token");
const B = await attempt("B/token-bidon", "0cAFcWeA_INVALID_GARBAGE_TOKEN_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
const C = await attempt("C/token-vide", "");
console.log("\n=== VERDICT ===");
const suffix = (s) => (s.split("-").pop() || "");
console.log("A:", A?.status, suffix(A?.code || ""), "| B:", B?.status, suffix(B?.code || ""), "| C:", C?.status, suffix(C?.code || ""));
if (A && B && A.type === B.type && A.status === B.status) console.log("→ token bidon = même résultat que le nôtre : le TOKEN n'est PAS le discriminant (compte/env/tmpt/creds).");
else console.log("→ résultats DIFFÉRENTS : le token EST évalué → la qualité du payload compte.");
