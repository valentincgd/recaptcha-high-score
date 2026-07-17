/**
 * tools/verify_token.js — Vérifie le SCORE d'un token reCAPTCHA v3 (siteverify).
 *
 * ⚠️ RECHERCHE / ÉDUCATIF.
 *
 * ⚠️ La vérification exige un SECRET côté serveur que SEUL le propriétaire du site possède :
 *   - v3 classique      : la "secret key" jumelle de la site key.
 *   - v3 Enterprise      : une clé API GCP + l'ID de projet (endpoint assessments.create).
 * On NE peut donc PAS vérifier le token du sample Ticketmaster (secret non public).
 * Utilise ce script sur TON propre site (dont tu as le secret / le projet GCP).
 *
 * Usage :
 *   # v3 classique
 *   RC_SECRET=6Lc...secret  node tools/verify_token.js [token]
 *   # v3 Enterprise
 *   RC_GCP_API_KEY=AIza... RC_GCP_PROJECT=mon-projet RC_SITEKEY=6Lc... node tools/verify_token.js [token]
 *
 * Le token par défaut est lu dans scripts/last_field16.json (dernier run du générateur).
 */
'use strict';
const fs = require('fs');
const path = require('path');

function loadToken() {
  if (process.argv[2]) return process.argv[2];
  try {
    const p = path.join(__dirname, '..', 'scripts', 'last_field16.json');
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (d.token) return d.token;
  } catch (_) {}
  return null;
}

const TOKEN = loadToken();
const ACTION = process.env.RC_ACTION || 'Event';
const SITEKEY = process.env.RC_SITEKEY || '6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV';
const REMOTE_IP = process.env.RC_REMOTEIP || undefined;

async function verifyClassic(secret) {
  const body = new URLSearchParams({ secret, response: TOKEN });
  if (REMOTE_IP) body.set('remoteip', REMOTE_IP);
  const res = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  return res.json();
}

async function verifyEnterprise(apiKey, project) {
  const url = `https://recaptchaenterprise.googleapis.com/v1/projects/${project}/assessments?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: { token: TOKEN, siteKey: SITEKEY, expectedAction: ACTION } }),
  });
  return res.json();
}

(async () => {
  if (!TOKEN) {
    console.error('✖ Pas de token. Lance d\'abord `node field16_jsdom.js`, ou passe le token en argument.');
    process.exit(1);
  }
  console.log('token :', TOKEN.slice(0, 48) + '…', `(${TOKEN.length} chars)`);

  if (process.env.RC_GCP_API_KEY && process.env.RC_GCP_PROJECT) {
    console.log('mode  : Enterprise (assessments.create) — projet', process.env.RC_GCP_PROJECT);
    const r = await verifyEnterprise(process.env.RC_GCP_API_KEY, process.env.RC_GCP_PROJECT);
    console.log(JSON.stringify(r, null, 2));
    const tp = r.tokenProperties || {};
    const ra = r.riskAnalysis || {};
    console.log('\nrésumé :');
    console.log('  valid   :', tp.valid, tp.invalidReason ? '(' + tp.invalidReason + ')' : '');
    console.log('  action  :', tp.action, '(attendu:', ACTION + ')');
    console.log('  hostname:', tp.hostname);
    console.log('  score   :', ra.score, ra.reasons && ra.reasons.length ? '— ' + ra.reasons.join(', ') : '');
    process.exit(tp.valid ? 0 : 3);
  } else if (process.env.RC_SECRET) {
    console.log('mode  : v3 classique (siteverify)');
    const r = await verifyClassic(process.env.RC_SECRET);
    console.log(JSON.stringify(r, null, 2));
    console.log('\nrésumé :');
    console.log('  success :', r.success);
    console.log('  score   :', r.score);
    console.log('  action  :', r.action, '(attendu:', ACTION + ')');
    console.log('  hostname:', r.hostname);
    if (r['error-codes']) console.log('  erreurs :', r['error-codes'].join(', '));
    process.exit(r.success ? 0 : 3);
  } else {
    console.error('✖ Aucun secret fourni.');
    console.error('  v3 classique  : RC_SECRET=<secret key>  node tools/verify_token.js');
    console.error('  v3 Enterprise : RC_GCP_API_KEY=<clé GCP> RC_GCP_PROJECT=<projet> RC_SITEKEY=<site key> node tools/verify_token.js');
    console.error('\n  (Le sample Ticketmaster ne peut PAS être vérifié : son secret/projet ne sont pas publics.)');
    process.exit(1);
  }
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
