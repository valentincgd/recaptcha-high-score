#!/usr/bin/env node
/**
 * cli.mjs — interface ligne de commande.
 *
 *   node cli.mjs --demo                       génère un token pour le démo Google + affiche le score
 *   node cli.mjs --site <k> --action <a> --origin <url> [--referer <url>] [--fp <id>] [--verbose] [--json]
 *   node cli.mjs --list                       liste les 5 profils
 */
import { solve, verifyDemoScore, listProfileIds, DEMO } from "./index.mjs";

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith("--")) {
      const key = t.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) a[key] = true;
      else { a[key] = next; i++; }
    } else a._.push(t);
  }
  return a;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));

  if (a.list) {
    console.log("Profils disponibles :", listProfileIds().join(", "));
    return;
  }

  const target = a.demo
    ? DEMO
    : { siteKey: a.site, action: a.action, origin: a.origin, referer: a.referer, title: a.title };

  if (!target.siteKey || !target.origin) {
    console.error("Usage : node cli.mjs --demo");
    console.error("   ou : node cli.mjs --site <sitekey> --action <action> --origin <https://...> [--referer <url>] [--fp <id>] [--verbose] [--json]");
    process.exit(1);
  }

  const t0 = Date.now();
  const res = await solve({
    siteKey: target.siteKey,
    action: target.action,
    origin: target.origin,
    referer: target.referer,
    fingerprintId: a.fp || null,
    verbose: !!a.verbose,
  });
  const ms = Date.now() - t0;

  if (a.json) {
    let score = null;
    if (a.demo && res.token) score = (await verifyDemoScore(res.token, target.action)).score;
    console.log(JSON.stringify({ ...res, ms, score }, null, 2));
    return;
  }

  console.log(`\nprofil     : ${res.profileId}`);
  console.log(`success    : ${res.success}`);
  console.log(`durée      : ${ms} ms`);
  console.log(`reloadBytes: ${res.reloadBytes}`);
  if (!res.success) { console.log(`hint       : ${res.hint}`); process.exit(2); }
  console.log(`token      : ${res.token.slice(0, 60)}… (${res.token.length} chars)`);

  if (a.demo) {
    const v = await verifyDemoScore(res.token, target.action);
    console.log(`\n>>> SCORE (oracle démo) = ${v.score}   ${JSON.stringify(v.raw)}`);
  }
}

main().catch((e) => { console.error("ÉCHEC:", e?.message || e); process.exit(1); });
