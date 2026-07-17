'use strict';
/**
 * deob_build.js — enchaîne toutes les passes de déobfuscation : scripts/recaptcha_pretty.js → scripts/recaptcha_readable.js
 *   passe 1  deob_strings.js   décode 2137 getters de strings g[2](…) via jsdom + inline les call-sites
 *   passe 2  deob_arrays.js    inline les constantes empaquetées X=[litéraux]; X[i] (point-fixe)
 *   passe 3  deob_cleanup.js   cosmétique : obj["id"]→obj.id, !0/!1→true/false, void 0→undefined
 *   passe 4  deob_tables.js    dé-indirection : X[i] → fn_X_i (585 fonctions nommées hoistées)
 *
 * Sortie : scripts/recaptcha_readable.js (~19 400 lignes, compact, VÉRIFIÉ équivalent HTTP 200).
 * Vérif : RC_NO_FETCH=1 RC_SCRIPT_FILE=recaptcha_readable.js node field16_jsdom.js  → HTTP 200.
 *
 * NB — le dé-multiplexage (tools/deob_demux.js, `fn_X_i(sel,…)` → `fn_X_i__sSEL`) est DISPONIBLE mais
 * PAS dans le build par défaut : il DOUBLE la taille (~40 000 lignes) car il spécialise chaque sélecteur.
 * À n'utiliser que pour lire une fonction précise, pas comme livrable. Mesuré : readable.js n'a AUCUN code
 * mort (DCE = 0) et le flux v3 utilise ~toutes les 585 fonctions (main+worker) → 19 400 lignes = plancher fidèle.
 *
 * Usage : node tools/deob_build.js
 */
const { execFileSync } = require('child_process');
const path = require('path');

for (const s of ['deob_strings.js', 'deob_arrays.js', 'deob_cleanup.js', 'deob_tables.js']) {
  console.log(`\n===== ${s} =====`);
  execFileSync(process.execPath, [path.join(__dirname, s)], { stdio: 'inherit' });
}
console.log('\n✔ build terminé → scripts/recaptcha_readable.js');
console.log('  vérifier : RC_NO_FETCH=1 RC_SCRIPT_FILE=recaptcha_readable.js node field16_jsdom.js');
