'use strict';
/**
 * capture_field16.js — localise le cipher du field16.
 * Patche recaptcha_pretty.js pour hooker l'encodeur base64 (self.__b64(w, D, stack)), le sert via
 * RC_SCRIPT_FILE, et repère l'appel dont l'entrée fait ~2670 o (= le field16) → imprime la stack du
 * caller (= le pipeline cipher du field16).
 */
const fs = require('fs');
const path = require('path');
const SD = path.join(__dirname, '..', 'scripts');

// 1) patch pretty → hooked (injecte le hook dans la branche encodeur base64)
const pretty = fs.readFileSync(path.join(SD, 'recaptcha_pretty.js'), 'utf8');
const NEEDLE = '(q + 7 & 60) >= q && (q + 8 ^ 27) < q) {';
if (!pretty.includes(NEEDLE)) { console.error('needle encodeur b64 introuvable'); process.exit(1); }
const HOOK = NEEDLE + " try{if(typeof self!=='undefined'&&self.__b64)self.__b64(w,D,new Error().stack);}catch(_$e){}";
const hooked = pretty.replace(NEEDLE, HOOK);
fs.writeFileSync(path.join(SD, 'recaptcha_hooked.js'), hooked);
console.error('→ recaptcha_hooked.js écrit (hook b64 injecté)');

process.env.RC_SCRIPT_FILE = 'recaptcha_hooked.js';
process.env.RC_NO_FETCH = '1';
process.env.RC_TLS = process.env.RC_TLS || '0';
process.env.RC_QUIET = '1';

const caps = [];
global.__b64 = function (w, D, stack) {
  try { caps.push({ w: Array.from(w), D, stack: String(stack || '') }); } catch (_) {}
};
// base64 custom du script (alphabets UJ)
const B64BASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const UJ = ["+/=", "+/", "-_=", "-_.", "-_"].map((x) => (B64BASE + x).split(""));
function customB64(bytes, alpha) {
  let out = "", i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i] | 0, b1 = bytes[i + 1] | 0, b2 = bytes[i + 2] | 0;
    out += alpha[b0 >> 2] + alpha[((b0 & 3) << 4) | (b1 >> 4)] + alpha[((b1 & 15) << 2) | (b2 >> 6)] + alpha[b2 & 63];
    i += 3;
  }
  return out;
}

(async () => {
  const { run } = require('../field16_jsdom');
  let res;
  try { res = await run({ timeout: Number(process.env.RC_TIMEOUT) || 45000 }); }
  catch (e) { console.error('run err:', e.message); }

  const f16 = res && res.field16 ? res.field16 : '';
  console.log('\n════════ CAPTURE B64 : ' + caps.length + ' appels ════════');
  console.log('field16 réel: len=' + f16.length + ' début="' + f16.slice(0, 32) + '"');
  // MATCH : pour chaque capture, calculer customB64(w, UJ[D]) et voir si ça matche field16
  let matched = null;
  for (const c of caps) {
    for (let d = 0; d < UJ.length; d++) {
      const enc = customB64(c.w, UJ[d]);
      // field16 peut avoir un préfixe ("0"…) ; on cherche un gros chevauchement
      if (f16.length > 40 && (f16.includes(enc.slice(0, 48)) || enc.includes(f16.slice(1, 49)) || enc.includes(f16.slice(0, 48)))) {
        matched = { c, d, enc, capD: c.D };
        break;
      }
    }
    if (matched) break;
  }
  if (matched) {
    console.log(`\n✅ FIELD16 LOCALISÉ : input=${matched.c.w.length} o, alphabet UJ[${matched.d}] (capD=${matched.capD})`);
    console.log('input bytes[0:24] hex:', Buffer.from(matched.c.w.slice(0, 24)).toString('hex'));
    console.log('STACK (→ localise le cipher, frame après l\'encodeur) :\n' + matched.c.stack.split('\n').slice(0, 16).join('\n'));
    fs.writeFileSync(path.join(SD, 'field16_preb64.json'), JSON.stringify({ bytes: matched.c.w, D: matched.d, stack: matched.c.stack }));
    console.log('\n✔ octets pré-base64 (= sortie cipher) → scripts/field16_preb64.json');
  } else {
    console.log('\n❌ aucun match — field16 encodé autrement (autre encodeur/transform). Tailles vues:',
      [...new Set(caps.map(c => c.w.length))].sort((a, b) => b - a).slice(0, 12).join(','));
  }
  process.exit(0);
})();
