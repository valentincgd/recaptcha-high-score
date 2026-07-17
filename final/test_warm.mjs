/**
 * test_warm.mjs — Valide le service à session chaude : boot une fois, N tokens à la demande.
 * Mesure le temps du 1er token (froid, inclut le bootstrap) vs les suivants (chauds).
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "vendor", "rcjsdom");
const PORT = 3900;
const KEY = "6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV";

function get(port, pathname) {
  return new Promise((resolve, reject) => {
    const r = http.get({ host: "127.0.0.1", port, path: pathname, timeout: 30000 }, (res) => {
      let d = ""; res.on("data", c => d += c); res.on("end", () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error("bad json: " + d.slice(0, 80))); } });
    });
    r.on("error", reject); r.on("timeout", () => { r.destroy(); reject(new Error("timeout")); });
  });
}

const env = { ...process.env, RC_WARM_PORT: String(PORT), RC_SITEKEY: KEY, RC_ORIGIN: "https://www.ticketmaster.com", RC_MODE: "enterprise", RC_PAGE_URL: "https://www.ticketmaster.com/event/020064BAD9B8236F", RC_HL: "fr", RC_MOUSE_MS: "700" };
const t0 = Date.now();
const child = spawn(process.execPath, ["field16_jsdom.js"], { cwd: ROOT, env });
let ready = false;
child.stdout.on("data", d => { if (String(d).includes("__WARM_READY__")) ready = true; });
child.stderr.on("data", () => {});

console.log("[warm] démarrage du service (boot unique)…");
await new Promise((res, rej) => { const iv = setInterval(() => { if (ready) { clearInterval(iv); res(); } }, 200); setTimeout(() => { clearInterval(iv); rej(new Error("boot timeout")); }, 60000); });
console.log(`[warm] service prêt en ${((Date.now() - t0) / 1000).toFixed(1)}s (boot)\n`);

for (let i = 1; i <= 3; i++) {
  const s = Date.now();
  const r = await get(PORT, "/?action=Event");
  console.log(`[warm] token #${i}: ${r.token ? r.token.length + "o" : "NULL"}  reload=${r.reloadStatus}  champ16=${r.field16Len}  → ${((Date.now() - s) / 1000).toFixed(1)}s`);
}
child.kill("SIGKILL");
console.log("\n[warm] 1er token = froid (boot amorti) ; #2/#3 = chauds (fenêtre réutilisée).");
process.exit(0);
