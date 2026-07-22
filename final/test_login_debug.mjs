/**
 * test_login_debug.mjs — login submit avec dump COMPLET de la réponse (proxyless par défaut).
 * Mint tmpt (LoginPage) + eps_sid, token (action=login, primé), POST /json/sign-in, tout afficher.
 * But : distinguer block Akamai/tmpt vs gate reCAPTCHA (signInSimple) vs cookies/session.
 */
const API = "http://127.0.0.1:3848/api/captcha";
const AUTH_URL = "https://auth.ticketmaster.com/as/authorization.oauth2?client_id=8bf7204a7e97.web.ticketmaster.us&response_type=code&scope=openid%20profile%20phone%20email%20tm&redirect_uri=https%3A%2F%2Fidentity.ticketmaster.com%2Fexchange&visualPresets=tm&lang=en-us&placementId=mytmlogin&hideLeftPanel=false&integratorId=prd1741.iccp&intSiteToken=tm-us&disableAutoOptIn=false";
const ZB = "6LdoaXQrAAAAADQviABd-eByJu6kPL8awKDyc1zb";
const EMAIL = process.env.T_EMAIL || "valentincgdpro@gmail.com";
const PW = process.env.T_PW || "Valou12345!!!!!!";
const PROXY = process.env.T_PROXY || null;

async function post(path, body) {
  const r = await fetch(API + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}

console.log("=== 1) mint tmpt (LoginPage) ===");
const tm = await post("/tmpt", { websiteUrl: AUTH_URL, recaptchaSitekey: ZB, action: "LoginPage", isEnterprise: false, ...(PROXY ? { proxy: PROXY } : {}) });
if (tm.status !== "success") { console.log("tmpt KO:", tm); process.exit(1); }
const d = tm.data;
console.log("tmpt:", d.tmpt.slice(0, 30), "| eps_sid:", (d.eps_sid || "").slice(0, 24), "| UA:", (d.user_agent || "").slice(0, 40));

console.log("\n=== 2) token reCAPTCHA (action=login, primé) ===");
const tk = await post("/token", { url: AUTH_URL, sitekey: ZB, action: "login", ...(PROXY ? { proxy: PROXY } : {}) });
if (tk.status !== "success") { console.log("token KO:", tk); process.exit(1); }
console.log("token:", tk.data.token.slice(0, 24), "| len:", tk.data.token.length, "| prime:", tk.data.prime, "| src:", tk.data.source);

console.log("\n=== 3) POST /json/sign-in ===");
const cookie = "tmpt=" + d.tmpt + (d.eps_sid ? "; eps_sid=" + d.eps_sid : "") + "; ma.LANGUAGE=en-us";
const headers = {
  "accept": "*/*", "content-type": "application/json",
  "accept-language": d.accept_lang || "en-US,en;q=0.9",
  "user-agent": d.user_agent || "",
  "sec-ch-ua": d.sec_ch_ua || "", "sec-ch-ua-mobile": d.sec_ch_ua_mobile || "?0", "sec-ch-ua-platform": d.sec_ch_ua_platform || '"Windows"',
  "origin": "https://auth.ticketmaster.com", "referer": AUTH_URL,
  "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", "sec-fetch-site": "same-origin",
  "tm-client-id": "8bf7204a7e97.web.ticketmaster.us", "tm-integrator-id": "prd1741.iccp",
  "tm-oauth-type": "tm-auth", "tm-placement-id": "mytmlogin", "tm-site-token": "tm-us",
  "cookie": cookie,
};
const loginBody = { email: EMAIL, password: PW, recaptchaToken: tk.data.token, externalUserToken: null };
console.log("cookie envoyé:", cookie.slice(0, 90), "...");
const r = await fetch("https://auth.ticketmaster.com/json/sign-in", { method: "POST", headers, body: JSON.stringify(loginBody), redirect: "manual" });
console.log("\n--- STATUS:", r.status, r.statusText, "---");
console.log("--- HEADERS ---");
for (const [k, v] of r.headers.entries()) console.log("  " + k + ": " + v.slice(0, 100));
const txt = await r.text();
console.log("\n--- BODY (" + txt.length + " o) ---");
console.log(txt.slice(0, 1500));
