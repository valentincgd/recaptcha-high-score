/**
 * JsdomSolver.mjs — Source de token reCAPTCHA v3 RÉELLE pour `final/`.
 *
 * Lance `final_bridge.cjs` (repo parent) qui exécute le VRAI recaptcha__fr.js dans jsdom :
 * le champ 16 (fingerprint chiffré) est produit par l'algo de Google lui-même — donc EXACT —
 * et le POST /reload est accepté (HTTP 200). Aucun navigateur (pas de Chromium) : jsdom + vm Node.
 *
 * Pourquoi pas une réimplémentation pure ? `deriveSignalCode` + le cipher du champ 16 vivent
 * dans du bytecode construit dynamiquement (result.md §9/§10 ; crack_dsc.js = 1/20). Non
 * réimplémentables à la main → on laisse le vrai script les exécuter.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Générateur jsdom VENDORISÉ dans final/ → aucune dépendance hors du dossier final/.
// final/api → final/vendor/rcjsdom (field16_jsdom.js + tools/ + scripts/ + node_modules/).
const PARENT_ROOT =
  process.env.RC_JSDOM_ROOT || path.resolve(__dirname, "..", "vendor", "rcjsdom");
const BRIDGE = "final_bridge.cjs";

/**
 * Génère un VRAI token reCAPTCHA v3 (champ 16 conforme, /reload HTTP 200) via jsdom.
 * @param {object} o
 * @param {string} o.siteKey
 * @param {string} o.action     action reCAPTCHA (ex "LoginPage", "Event")
 * @param {string} o.origin     ex "https://www.ticketmaster.com"
 * @param {string} [o.pageUrl]  URL exacte vue par la VM (défaut origin/event/<id>)
 * @param {string} [o.proxy]    proxy résidentiel (levier n°1 du score)
 * @param {string} [o.hl]       langue (défaut "fr")
 * @param {"enterprise"|"standard"} [o.mode]  défaut "enterprise" (Ticketmaster)
 * @param {number} [o.executeTimes]  nb d'execute() (défaut du générateur = 2 ; +score)
 * @param {number} [o.timeoutMs]     budget process (défaut 150000)
 * @param {boolean} [o.verbose]      relaie stderr du bridge
 * @returns {Promise<{token:string|null, accepted:boolean, reloadStatus:number|null, field16Len:number, clientHints:object}>}
 */
export function solveViaJsdom({
  siteKey,
  action,
  origin,
  pageUrl,
  proxy,
  hl = "fr",
  mode = "enterprise",
  executeTimes,
  timeoutMs = 150000,
  verbose = false,
}) {
  if (!siteKey) throw new Error("siteKey requis");
  if (!origin) throw new Error("origin requis");
  const bridgePath = path.join(PARENT_ROOT, BRIDGE);
  if (!existsSync(bridgePath))
    throw new Error(`bridge introuvable: ${bridgePath} (définir RC_JSDOM_ROOT)`);

  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      RC_SITEKEY: siteKey,
      RC_ACTION: action || "",
      RC_ORIGIN: origin,
      RC_HL: hl,
      RC_MODE: mode,
    };
    if (pageUrl) env.RC_PAGE_URL = pageUrl;
    if (proxy) env.RC_PROXY = proxy;
    if (executeTimes) env.RC_EXECUTE_TIMES = String(executeTimes);
    // RC_NO_FETCH laissé libre : par défaut le générateur re-télécharge le vrai script.

    const child = spawn(process.execPath, [BRIDGE], { cwd: PARENT_ROOT, env });
    let out = "";
    let err = "";
    const to = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`solveViaJsdom timeout après ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => {
      err += d;
      if (verbose) process.stderr.write(d);
    });
    child.on("error", (e) => {
      clearTimeout(to);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(to);
      const m = out.match(/__FINAL_JSON__([\s\S]*?)__END__/);
      if (!m) {
        reject(
          new Error(
            `bridge jsdom: pas de JSON (exit ${code}). stderr: ${err.slice(-400)}`,
          ),
        );
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(m[1]);
      } catch (e) {
        reject(new Error("bridge jsdom: JSON invalide — " + e.message));
        return;
      }
      if (!parsed.token) {
        reject(
          new Error(
            `bridge jsdom: aucun token (reload HTTP ${parsed.reloadStatus}, accepted=${parsed.accepted})`,
          ),
        );
        return;
      }
      resolve(parsed);
    });
  });
}
