'use strict';
/**
 * tools/ab_test.js — A/B du comportement souris sur le SCORE reCAPTCHA.
 * Génère N tokens en mode 'robotic' puis N en 'human', et (si creds) vérifie chaque score.
 *
 * ⚠️ RECHERCHE / ÉDUCATIF. La vérification du score exige TON secret / projet GCP
 * (le token d'un site tiers ne peut pas être scoré). Sans creds : compare juste
 * le taux de génération valide + latence, et affiche les tokens pour vérif manuelle.
 *
 * Usage :
 *   RC_AB_N=5 RC_PROXY="http://user:pass@host:port" \
 *   RC_GCP_API_KEY=AIza... RC_GCP_PROJECT=mon-projet RC_SITEKEY=6Lc... \
 *   node tools/ab_test.js
 */
const { spawn } = require('child_process');
const path = require('path');

const N = Number(process.env.RC_AB_N) || 4;
const MODES = (process.env.RC_AB_MODES || 'robotic,human').split(',');
const ACTION = process.env.RC_ACTION || 'Event';
const SITEKEY = process.env.RC_SITEKEY || '6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV';
const ROOT = path.join(__dirname, '..');

function genToken(mode) {
  return new Promise((resolve) => {
    const env = { ...process.env, RC_MOUSE_MODE: mode, RC_MODE: process.env.RC_MODE || 'enterprise', RC_QUIET: '1' };
    const t0 = Date.now();
    const child = spawn(process.execPath, ['-e',
      "require('./field16_jsdom').run({timeout:60000}).then(r=>{process.stdout.write('TOKEN:'+((r&&r.token)||'')+'\\n');process.exit(0)}).catch(e=>{process.stdout.write('TOKEN:\\n');process.exit(0)})"],
      { cwd: ROOT, env });
    let out = '';
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', () => {});
    child.on('close', () => {
      const m = out.match(/TOKEN:(.*)/);
      resolve({ token: m && m[1].trim() ? m[1].trim() : null, ms: Date.now() - t0 });
    });
  });
}

async function verifyScore(token) {
  if (!token) return null;
  try {
    if (process.env.RC_GCP_API_KEY && process.env.RC_GCP_PROJECT) {
      const url = `https://recaptchaenterprise.googleapis.com/v1/projects/${process.env.RC_GCP_PROJECT}/assessments?key=${process.env.RC_GCP_API_KEY}`;
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: { token, siteKey: SITEKEY, expectedAction: ACTION } }) });
      const j = await res.json();
      return { valid: j.tokenProperties && j.tokenProperties.valid, score: j.riskAnalysis && j.riskAnalysis.score, reasons: (j.riskAnalysis && j.riskAnalysis.reasons) || [] };
    } else if (process.env.RC_SECRET) {
      const body = new URLSearchParams({ secret: process.env.RC_SECRET, response: token });
      const res = await fetch('https://www.google.com/recaptcha/api/siteverify', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
      const j = await res.json();
      return { valid: j.success, score: j.score, reasons: j['error-codes'] || [] };
    }
  } catch (e) { return { valid: false, score: null, reasons: ['verify-err:' + e.message] }; }
  return null; // pas de creds
}

const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;

(async () => {
  const canScore = !!((process.env.RC_GCP_API_KEY && process.env.RC_GCP_PROJECT) || process.env.RC_SECRET);
  console.log(`A/B souris — N=${N}/mode, modes=[${MODES.join(', ')}], scoring=${canScore ? 'OUI' : 'NON (pas de creds → génération seule)'}\n`);
  const results = {};
  for (const mode of MODES) {
    const scores = [], lats = []; let ok = 0;
    console.log(`── mode ${mode} ──`);
    for (let i = 0; i < N; i++) {
      const g = await genToken(mode);
      lats.push(g.ms);
      const sc = await verifyScore(g.token);
      if (g.token) ok++;
      if (sc && sc.score != null) scores.push(sc.score);
      console.log(`  [${i + 1}/${N}] token=${g.token ? 'OK' : 'NULL'} ${g.ms}ms` +
        (sc ? `  valid=${sc.valid} score=${sc.score != null ? sc.score : '?'}${sc.reasons.length ? ' (' + sc.reasons.join(',') + ')' : ''}` : '') +
        (g.token ? `  ${g.token.slice(0, 20)}…` : ''));
    }
    results[mode] = { ok, N, meanScore: scores.length ? mean(scores) : null, nScores: scores.length, meanLat: Math.round(mean(lats)) };
  }
  console.log('\n════════ RÉSULTATS ════════');
  for (const [mode, r] of Object.entries(results)) {
    console.log(`  ${mode.padEnd(8)} : tokens ${r.ok}/${r.N}  latence ~${r.meanLat}ms` +
      (r.meanScore != null ? `  SCORE MOYEN=${r.meanScore.toFixed(3)} (n=${r.nScores})` : '  (score non mesuré)'));
  }
  if (results.robotic && results.human && results.robotic.meanScore != null && results.human.meanScore != null) {
    const d = results.human.meanScore - results.robotic.meanScore;
    console.log(`\n  Δ score (human - robotic) = ${d >= 0 ? '+' : ''}${d.toFixed(3)}  → ${d > 0.05 ? 'la souris humaine AIDE ✔' : d < -0.05 ? 'régression ✖' : 'impact marginal'}`);
  } else if (!canScore) {
    console.log('\n  ⚠️ Fournis RC_GCP_API_KEY+RC_GCP_PROJECT (ou RC_SECRET) sur TON site pour mesurer le Δ de score.');
  }
})();
