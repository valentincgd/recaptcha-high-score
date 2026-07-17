#!/usr/bin/env node
/**
 * token.js — Génère un token reCAPTCHA v3 et l'affiche. Point d'entrée simple.
 *
 * ⚠️ RECHERCHE / ÉDUCATIF.
 *
 * Usage :
 *   node token.js                                   # site/action du sample (Ticketmaster)
 *   node token.js <siteKey> <action> <origin>       # ta cible
 *   node token.js --json                            # sortie JSON complète
 *   node token.js --debug                           # TOUTES les étapes (anchor, worker, champ 16,
 *                                                     # postMessage, POST /reload, réponse) + token
 *   RC_SITEKEY=6Lc... RC_ACTION=login RC_ORIGIN=https://mon-site.com node token.js
 *
 * Prérequis (une fois) :
 *   npm install
 *   node tools/fetch_scripts.js      # met le vrai script en cache
 *   node tools/extract_xbv_key.js    # confirme la clé X-Browser-Validation depuis ton Chrome
 */
'use strict';
const { run } = require('./field16_jsdom');

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const DEBUG_OUT = argv.includes('--debug') || argv.includes('-d') || argv.includes('--verbose') || argv.includes('--steps');
const positional = argv.filter(a => !a.startsWith('-'));

const opts = {
  siteKey: positional[0] || process.env.RC_SITEKEY,
  action:  positional[1] || process.env.RC_ACTION,
  origin:  positional[2] || process.env.RC_ORIGIN,
  hl:      process.env.RC_HL,
  timeout: Number(process.env.RC_TIMEOUT) || 45000,
  quiet:   !DEBUG_OUT,      // --debug → toutes les étapes ; sinon juste le token
  debug:   DEBUG_OUT,       // trafic postMessage / canal worker / console page / protobuf / réponse
};

(async () => {
  if (DEBUG_OUT) console.log('──────── ÉTAPES (node token.js --debug) ────────');
  const r = await run(opts);
  if (JSON_OUT) {
    console.log(JSON.stringify({
      token: r.token, accepted: r.accepted, reloadStatus: r.reloadStatus,
      field16Len: r.field16 ? r.field16.length : 0,
      identity: r.identity,
      siteKey: opts.siteKey || '(défaut)', action: opts.action || '(défaut)',
    }, null, 2));
  } else if (DEBUG_OUT) {
    // en debug, le flux est déjà affiché : on termine par le token bien visible
    console.log('\n════════════════ TOKEN FINAL ════════════════');
    console.log(r.token || '(aucun — voir les étapes ci-dessus)');
    console.log('══════════════════════════════════════════════');
  } else if (r.token) {
    console.log(r.token);   // le token, brut, sur stdout (pipe-friendly)
  } else {
    console.error('✖ Échec : aucun token généré (reload HTTP ' + r.reloadStatus + ').');
    console.error('  Vérifie : npm install • node tools/fetch_scripts.js • siteKey/origin corrects.');
  }
  process.exit(r.token ? 0 : 2);   // jsdom laisse des handles ouverts → exit explicite
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
