/**
 * test_login_tls.mjs — flux login COMPLET via TLS Chrome (node-tls-client), pour tester l'hypothèse
 * "TM détecte le TLS Node sur le minting tmpt / le POST sign-in".
 * 1) token reCAPTCHA (solveFlat, Chrome TLS interne)  2) eps-mgr + epsf/gec via tls_bridge  3) sign-in via tls_bridge.
 */
import { createRequire } from "module";
import { solveFlat } from "./flat.mjs";
const require = createRequire(import.meta.url);
const tls = require("./vendor/rcjsdom/tools/tls_bridge.js");

const AUTH = "https://auth.ticketmaster.com";
const AUTH_URL = AUTH + "/as/authorization.oauth2?client_id=8bf7204a7e97.web.ticketmaster.us&response_type=code&scope=openid%20profile%20phone%20email%20tm&redirect_uri=https%3A%2F%2Fidentity.ticketmaster.com%2Fexchange&visualPresets=tm&lang=en-us&placementId=mytmlogin&hideLeftPanel=false&integratorId=prd1741.iccp&intSiteToken=tm-us&disableAutoOptIn=false";
const ZB = "6LdoaXQrAAAAADQviABd-eByJu6kPL8awKDyc1zb";
const EMAIL = process.env.T_EMAIL || "valentincgdpro@gmail.com";
const PW = process.env.T_PW || "Valou12345!!!!!!";
const PROXY = process.env.T_PROXY || undefined;

const getSetCookie = (h) => { const v = h && (h["set-cookie"] || h["Set-Cookie"]); return Array.isArray(v) ? v : (v ? [v] : []); };
const pickCk = (arr, name) => { for (const c of arr) { const m = new RegExp(name + "=([^;]+)").exec(c); if (m) return m[1]; } return null; };

tls.setProxy(PROXY);
await tls.ensureSession(PROXY, "chrome_150");

console.log("=== 1) token reCAPTCHA LoginPage (flat, Chrome TLS, primé) ===");
process.env.RC_FLAT_TLS = "1";
const fr = await solveFlat({ siteKey: ZB, action: "LoginPage", origin: AUTH, referer: AUTH_URL, mode: "api2", proxy: PROXY || null, prime: 2 });
console.log("token:", fr.token ? fr.token.slice(0, 20) + "…(" + fr.token.length + ")" : "KO");
const hints = fr.clientHints;

console.log("\n=== 2) eps-mgr + epsf/gec via TLS Chrome ===");
const baseH = { "accept-language": hints.accept_lang, "user-agent": hints.user_agent, "sec-ch-ua": hints.sec_ch_ua, "sec-ch-ua-mobile": hints.sec_ch_ua_mobile, "sec-ch-ua-platform": hints.sec_ch_ua_platform };
const rEps = await tls.tlsFetch(AUTH + "/eps-mgr", { method: "GET", headers: { ...baseH, accept: "*/*", referer: AUTH_URL, "sec-fetch-dest": "script", "sec-fetch-mode": "no-cors", "sec-fetch-site": "same-origin", "sec-gpc": "1" } });
let epsSid = pickCk(getSetCookie(rEps.headers), "eps_sid");
console.log("eps-mgr status:", rEps.status, "| eps_sid:", epsSid ? epsSid.slice(0, 20) + "…" : "ABSENT");

const gecBody = JSON.stringify({ hostname: "auth.ticketmaster.com", key: ZB, token: fr.token });
const rGec = await tls.tlsFetch(AUTH + "/epsf/gec/v3/LoginPage", { method: "POST", headers: { ...baseH, accept: "*/*", "content-type": "application/json", origin: AUTH, referer: AUTH + "/", "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", "sec-fetch-site": "same-origin" }, body: gecBody });
let tmpt = pickCk(getSetCookie(rGec.headers), "tmpt");
console.log("epsf/gec status:", rGec.status, "| tmpt:", tmpt ? tmpt.slice(0, 24) + "…(" + tmpt.length + ")" : "ABSENT");
if (!tmpt) { console.log("tmpt absent → stop. body:", (await rGec.text()).slice(0, 200)); process.exit(1); }

console.log("\n=== 3) POST /json/sign-in via TLS Chrome ===");
const cookieHdr = "tmpt=" + tmpt + (epsSid ? "; eps_sid=" + epsSid : "") + "; ma.LANGUAGE=en-us";
const rLogin = await tls.tlsFetch(AUTH + "/json/sign-in", {
  method: "POST", followRedirects: false,
  headers: { ...baseH, accept: "*/*", "content-type": "application/json", origin: AUTH, referer: AUTH_URL, "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", "sec-fetch-site": "same-origin", "tm-client-id": "8bf7204a7e97.web.ticketmaster.us", "tm-integrator-id": "prd1741.iccp", "tm-oauth-type": "tm-auth", "tm-placement-id": "mytmlogin", "tm-site-token": "tm-us", cookie: cookieHdr },
  body: JSON.stringify({ email: EMAIL, password: PW, recaptchaToken: fr.token, externalUserToken: null }),
});
const txt = await rLogin.text();
console.log("SIGN-IN status:", rLogin.status);
console.log("body:", txt.slice(0, 300));
