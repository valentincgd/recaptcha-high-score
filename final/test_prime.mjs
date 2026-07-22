/**
 * test_prime.mjs — A/B de l'effet du champ 7 (usagePatternToken récolté par priming).
 * Génère un token DEMO Google avec prime=0 (baseline) puis prime=N, et mesure le score réel.
 * Usage: node test_prime.mjs [N=2] [runs=3]
 */
import { solveFlat } from "./flat.mjs";
import { verifyDemoScore, DEMO } from "./index.mjs";

const N = Number(process.argv[2] || 2);
const RUNS = Number(process.argv[3] || 3);
const cfg = { siteKey: DEMO.siteKey, action: DEMO.action, origin: DEMO.origin, referer: DEMO.referer, mode: "api2", verbose: true };

async function one(prime) {
  const t0 = Date.now();
  try {
    const r = await solveFlat({ ...cfg, prime });
    if (!r.token) return { prime, score: null, ms: Date.now() - t0, err: "token null" };
    const v = await verifyDemoScore(r.token, DEMO.action);
    return { prime, score: v.score, success: v.success, ms: Date.now() - t0, tok: r.token.slice(0, 14) };
  } catch (e) { return { prime, score: null, ms: Date.now() - t0, err: String(e.message || e) }; }
}

const rows = [];
for (let i = 0; i < RUNS; i++) {
  console.error(`\n===== RUN ${i + 1}/${RUNS} — baseline (prime=0) =====`);
  rows.push(await one(0));
  console.error(`\n===== RUN ${i + 1}/${RUNS} — primed (prime=${N}) =====`);
  rows.push(await one(N));
}

console.log("\n\n======== RÉSULTATS ========");
const agg = {};
for (const r of rows) {
  const k = "prime=" + r.prime;
  (agg[k] = agg[k] || []).push(r);
  console.log(`${k.padEnd(9)} score=${r.score ?? "—"} success=${r.success ?? "—"} ${r.ms}ms ${r.err ? "ERR:" + r.err : r.tok}`);
}
console.log("\n--- moyennes ---");
for (const [k, arr] of Object.entries(agg)) {
  const sc = arr.map((x) => x.score).filter((x) => x != null);
  const avg = sc.length ? (sc.reduce((a, b) => a + b, 0) / sc.length).toFixed(3) : "—";
  console.log(`${k.padEnd(9)} n=${arr.length} scores=[${arr.map((x) => x.score ?? "—").join(", ")}] moy=${avg}`);
}
