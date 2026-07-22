/**
 * WarmService.mjs — Pool de fenêtres jsdom CHAUDES (réutilisées) pour sortir des tokens vite.
 *
 * Au lieu de spawn un process jsdom par token (~9–13 s, bootstrap payé à chaque fois), on garde
 * UNE fenêtre jsdom vivante par (sitekey, mode, hl, proxy) et on rappelle execute() dessus :
 *   boot ≈ 4–5 s (une fois)  →  puis ~1–1,5 s par token.
 *
 * Contrainte : une fenêtre = un couple (sitekey, mode, proxy) figé au boot (le widget + le pont TLS
 * sont liés). Pour des proxies tournants par token, le chaud ne convient pas (préférer solveViaJsdom).
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { FP_PROFILES, profileEnv } from "./fpProfiles.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.RC_JSDOM_ROOT || path.resolve(__dirname, "..", "vendor", "rcjsdom");

let NEXT_PORT = Number(process.env.RC_WARM_BASE_PORT) || 3900;
const windows = new Map(); // key -> { port, proc, ready, queue, starting }
let RR = 0; // curseur round-robin du pool
let _bootChain = Promise.resolve(); // sérialise les boots (un seul field16_jsdom.js démarre à la fois)

// NB: le proxy n'entre PAS dans la clé — une fenêtre chaude sert TOUTES les IP (proxy appliqué
// par requête via setProxy dans le harnais). Sinon un proxy tournant rebooterait à chaque token.
function keyOf({ siteKey, mode, hl, profile }) {
  return `${siteKey}|${mode || "enterprise"}|${hl || "fr"}|${profile ? profile.id : "default"}`;
}

function httpGet(port, pathname, timeoutMs) {
  return new Promise((resolve, reject) => {
    const r = http.get({ host: "127.0.0.1", port, path: pathname, timeout: timeoutMs || 30000 }, (res) => {
      let d = ""; res.on("data", c => (d += c));
      res.on("end", () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch { reject(new Error("warm: JSON invalide")); } });
    });
    r.on("error", reject);
    r.on("timeout", () => { r.destroy(); reject(new Error("warm: timeout requête")); });
  });
}

function startWindow(opts) {
  const key = keyOf(opts);
  let w = windows.get(key);
  if (w && w.ready) return Promise.resolve(w);
  if (w && w.starting) return w.starting;

  const entry = path.join(ROOT, "field16_jsdom.js");
  if (!existsSync(entry)) throw new Error(`warm: harnais introuvable ${entry}`);

  w = { port: null, proc: null, ready: false, queue: Promise.resolve(), starting: null };
  windows.set(key, w);

  // Boot SÉRIALISÉ globalement : un seul field16_jsdom.js démarre à la fois. Sinon plusieurs process
  // ré-téléchargent recaptcha__*.js dans le MÊME cache scripts/ en même temps → fichier corrompu →
  // "grecaptcha non prêt" (code 1). Le lock ne bloque QUE le boot ; les execute() des fenêtres déjà
  // chaudes ne passent pas par là (le round-robin RR peut désaligner request vs warmup → collision).
  w.starting = _bootChain.then(() => spawnWindow(key, w, opts));
  _bootChain = w.starting.then(() => {}, () => {}); // la chaîne continue même si un boot échoue
  return w.starting;
}

function spawnWindow(key, w, opts) {
  const port = NEXT_PORT++;
  w.port = port;
  const env = {
    ...process.env,
    ...(opts.profile ? profileEnv(opts.profile) : {}), // empreinte du profil (WebGL/écran/cœurs/version)
    RC_WARM_PORT: String(port),
    RC_SITEKEY: opts.siteKey,
    RC_ORIGIN: opts.origin,
    RC_MODE: opts.mode || "enterprise",
    RC_HL: opts.hl || "fr",
    RC_NO_FETCH: "1", // cache scripts/ rafraîchi 1× par le serveur ; jamais de re-download concurrent
  };
  if (opts.pageUrl) env.RC_PAGE_URL = opts.pageUrl;
  // Pas de RC_PROXY au boot : la fenêtre démarre sans proxy figé ; l'upstream est appliqué PAR
  // requête (query ?proxy=) → proxy tournant possible sans reboot. L'anchor charge en IP directe.

  const proc = spawn(process.execPath, ["field16_jsdom.js"], { cwd: ROOT, env });
  w.proc = proc;

  return new Promise((resolve, reject) => {
    let out = "", err = "";
    const to = setTimeout(() => { proc.kill("SIGKILL"); windows.delete(key); reject(new Error("warm: boot timeout")); }, 90000);
    proc.stdout.on("data", (d) => { out += d; if (out.includes("__WARM_READY__")) { clearTimeout(to); w.ready = true; resolve(w); } });
    proc.stderr.on("data", (d) => { err += String(d); if (err.length > 4000) err = err.slice(-2000); });
    proc.on("exit", (code) => { windows.delete(key); if (!w.ready) { clearTimeout(to); reject(new Error(`warm: process sorti (code ${code}) ${err.slice(-200)}`)); } });
  });
}

/**
 * Retourne un token reCAPTCHA depuis une fenêtre CHAUDE (démarre la fenêtre au 1er appel).
 * Requêtes sérialisées par fenêtre (une seule execute() à la fois).
 * @returns {Promise<{token, reloadStatus, field16Len, clientHints}>}
 */
export async function getWarmToken(opts) {
  if (!opts.siteKey || !opts.origin) throw new Error("warm: siteKey et origin requis");
  const w = await startWindow(opts);
  // sérialise les requêtes vers cette fenêtre
  const run = w.queue.then(async () => {
    // proxy PAR requête (vide = IP directe) : la fenêtre applique cet upstream avant l'execute().
    const q = "/?action=" + encodeURIComponent(opts.action || "Event") +
      "&proxy=" + encodeURIComponent(opts.proxy || "");
    let res = await httpGet(w.port, q, opts.timeoutMs || 30000);
    if (res.status === 503) { await new Promise(r => setTimeout(r, 300)); res = await httpGet(w.port, q, opts.timeoutMs || 30000); }
    if (res.status !== 200 || !res.body || !res.body.token) throw new Error("warm: pas de token (" + res.status + ") " + (res.body && res.body.error || ""));
    return res.body; // { token, reloadStatus, field16Len, clientHints }
  });
  w.queue = run.catch(() => {}); // la file continue même si une requête échoue
  return run;
}

/**
 * Token depuis un POOL de fenêtres chaudes à empreintes DIFFÉRENTES (round-robin).
 * Chaque appel prend le profil suivant → empreinte variée token après token, tout en
 * gardant les fenêtres chaudes (boot amorti). poolSize = nb de profils/fenêtres (défaut 3).
 * @returns {Promise<{token, reloadStatus, field16Len, clientHints, profileId}>}
 */
export async function getPooledToken(opts) {
  const n = Math.max(1, Math.min(opts.poolSize || 3, FP_PROFILES.length));
  const profile = FP_PROFILES[RR % n];
  RR = (RR + 1) % n;
  const r = await getWarmToken({ ...opts, profile });
  return { ...r, profileId: profile.id };
}

/**
 * Pré-chauffe (boot) les fenêtres du pool SÉQUENTIELLEMENT (une à la fois).
 * Booter plusieurs fenêtres jsdom en parallèle sature CPU/réseau (require jsdom + download 891 Ko +
 * parse ×N) → la 1re requête explose (~30 s) et des fenêtres crashent. En série : ~5 s/fenêtre, zéro
 * contention. On boote seulement (startWindow, jusqu'à __WARM_READY__) sans générer de token gaspillé.
 */
export async function warmupPool(opts) {
  const n = Math.max(1, Math.min(opts.poolSize || 3, FP_PROFILES.length));
  for (const profile of FP_PROFILES.slice(0, n)) {
    try { await startWindow({ ...opts, profile }); } catch { /* fenêtre KO : on continue le reste du pool */ }
  }
  return warmStatus();
}

/** Arrête toutes les fenêtres chaudes. */
export function stopWarm() {
  for (const w of windows.values()) { try { w.proc.kill("SIGKILL"); } catch {} }
  windows.clear();
}

/** État du pool. */
export function warmStatus() {
  return [...windows.entries()].map(([k, w]) => ({ key: k, port: w.port, ready: w.ready }));
}
