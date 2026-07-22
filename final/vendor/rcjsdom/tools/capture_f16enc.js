'use strict';
/**
 * capture_f16enc.js — hooke l'encodeur base64 générique (ligne 7578) qui produit field16.
 * Capture (input bytes w, output, stack) pour trouver l'appel field16 (~2708 o) → sortie du cipher + builder.
 */
const fs = require('fs');
const path = require('path');
const SD = path.join(__dirname, '..', 'scripts');
let s = fs.readFileSync(path.join(SD, 'recaptcha_pretty.js'), 'utf8');

const ENC = 'LR && !r ? H6.btoa(w) : a[25](x[1], 64, v[x[2]](1, 0, 8, w), r)';
if (!s.includes(ENC)) { console.error('needle encodeur introuvable'); process.exit(1); }
const HOOKED = "(function(_w,_r){var _R=(LR && !_r ? H6.btoa(_w) : a[25](x[1], 64, v[x[2]](1, 0, 8, _w), _r));try{if(_w&&_w.length>2000&&typeof self!=='undefined'&&self.__f16enc)self.__f16enc(_w.length, Array.prototype.slice.call(_w), String(_R), (new Error()).stack);}catch(_e){}return _R;})(w,r)";
s = s.replace(ENC, HOOKED);
fs.writeFileSync(path.join(SD, 'recaptcha_hooked.js'), s);
console.error('→ recaptcha_hooked.js (hook encodeur field16 injecté)');

process.env.RC_SCRIPT_FILE = 'recaptcha_hooked.js';
process.env.RC_NO_FETCH = '1'; process.env.RC_TLS = '0'; process.env.RC_QUIET = '1';

const caps = [];
global.__f16enc = function (len, wBytes, out, stack) { try { caps.push({ len, w: wBytes, out: String(out), stack: String(stack || '') }); } catch (_) {} };

(async () => {
  const { run } = require('../field16_jsdom.js');
  const r = await run({ timeout: 45000 }).catch((e) => ({ err: e.message }));
  const f16 = (r && r.field16) || '';
  console.log('FIELD16 len:', f16.length, 'début:', f16.slice(0, 24));
  console.log('appels encodeur (>2000o):', caps.length, '| tailles:', caps.map((c) => c.len).join(','));
  // trouver celui dont l'output == field16 (ou field16 sans préfixe)
  const m = caps.find((c) => f16 && (c.out === f16 || f16.endsWith(c.out) || f16.includes(c.out.slice(0, 60)) || c.out.includes(f16.slice(2, 62))));
  if (m) {
    console.log('\n✅ ENCODEUR FIELD16 TROUVÉ : input=' + m.len + ' o');
    console.log('input hex[0:24]:', Buffer.from(m.w.slice(0, 24)).toString('hex'), '(= sortie du cipher)');
    console.log('STACK builder:\n' + m.stack.split('\n').slice(1, 14).join('\n'));
    fs.writeFileSync(path.join(SD, 'field16_cipher_out.json'), JSON.stringify({ field16: f16, cipherBytes: m.w, stack: m.stack }));
    console.log('\n✔ octets cipher field16 → scripts/field16_cipher_out.json');
  } else {
    console.log('\n❌ pas de match. Outputs (début):');
    caps.slice(0, 6).forEach((c) => console.log(`  len=${c.len} out="${c.out.slice(0, 30)}"`));
  }
  process.exit(0);
})();
