import { HttpClient } from "./api/HttpClient.js";
import { ProtobufWire } from "./api/ProtobufWire.js";
import { Config } from "./api/Config.js";
import { RecaptchaEnterprise } from "./api/RecaptchaEnterprise.js";

const orig = HttpClient.fetchBuffer.bind(HttpClient);
let captured = null;
HttpClient.fetchBuffer = async (url, init, jar) => {
  if (String(url).includes("/reload") && init?.body)
    captured = Buffer.isBuffer(init.body) ? init.body : Buffer.from(init.body);
  return orig(url, init, jar);
};

const cfg = new Config({
  siteKey: "6LdKlZEpAAAAAAOQjzC2v_d36tWxCl6dWsozdSy9",
  action: "examples/v3scores",
  origin: "https://recaptcha-demo.appspot.com",
  referer: "https://recaptcha-demo.appspot.com/recaptcha-v3-request-scores.php",
  mode: "api2",
  preserveOrigin: true,
});
cfg.fingerprint = {
  id: "custom-demo",
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
  platform: "Win32", language: "fr-FR", languages: ["fr-FR", "fr"],
  width: 1920, height: 1080, devicePixelRatio: 1,
  webgl: { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)", extensionCount: 47 },
  title: "reCAPTCHA demo", scrollY: 0, localStorageLength: 1, inputIds: [],
};
cfg.userAgent = cfg.fingerprint.userAgent;

const res = await new RecaptchaEnterprise(cfg).getToken();
if (!captured) { console.log("pas de body capturé"); process.exit(1); }
const fields = ProtobufWire.decodeMessage(captured);
const names = { 1: "version", 2: "anchorToken", 5: "hash", 6: "challenge", 7: "f7(trust)", 8: "action", 14: "siteKey", 16: "CHAMP16(fp)", 20: "telemetry", 21: "aux(21)", 22: "binary(22)", 25: "events(25)", 28: "anchor-ms", 29: "execute-ms" };
console.log("\nbody:", captured.length, "octets | success:", res.success);
console.log("champs top-level générés (Voie B) :");
for (const f of fields) {
  const len = f.value?.length ?? String(f.value).length;
  console.log(`  #${f.fieldNumber} (${names[f.fieldNumber] || "?"}) wire=${f.wireType} len=${len}`);
}
