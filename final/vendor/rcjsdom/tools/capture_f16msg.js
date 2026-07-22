'use strict';
// Capture le message this.O au moment où le champ 16 est sérialisé (ligne 17693) → identifie la
// classe du message + où la valeur field16 est stockée (pour lire le builder statiquement).
const fs = require('fs');
const path = require('path');
const SD = path.join(__dirname, '..', 'scripts');
let s = fs.readFileSync(path.join(SD, 'recaptcha_pretty.js'), 'utf8');
const N = 'm[49](2, w, 130), m[35](3, q[0], n[2], w, D, this.O)';
if (!s.includes(N)) { console.error('needle introuvable'); process.exit(1); }
s = s.replace(N, 'm[49](2, w, 130), (typeof self!==\'undefined\'&&self.__f16msg&&self.__f16msg(this.O, q[0], D)), m[35](3, q[0], n[2], w, D, this.O)');
fs.writeFileSync(path.join(SD, 'recaptcha_hooked.js'), s);
process.env.RC_SCRIPT_FILE = 'recaptcha_hooked.js';
process.env.RC_NO_FETCH = '1'; process.env.RC_TLS = '0'; process.env.RC_QUIET = '1';

let cap = null;
global.__f16msg = function (O, q0, D) {
  if (cap) return;
  try {
    const info = { ctor: O && O.constructor && O.constructor.name, q0type: typeof q0, q0len: q0 && q0.length, Dtype: typeof D };
    // chercher une string ~3697 base64 dans O (dump peu profond)
    const found = [];
    function scan(obj, pathStr, depth) {
      if (depth > 3 || !obj) return;
      if (typeof obj === 'string' && obj.length > 2000) { found.push(pathStr + ' = str(' + obj.length + ') "' + obj.slice(0, 20) + '"'); return; }
      if (typeof obj === 'object') { for (const k of Object.keys(obj)) { try { scan(obj[k], pathStr + '.' + k, depth + 1); } catch (_) {} } }
    }
    scan(O, 'O', 0);
    cap = { info, found, q0: typeof q0 === 'string' ? q0.slice(0, 30) : q0 };
  } catch (e) { cap = { err: e.message }; }
};

(async () => {
  const { run } = require('../field16_jsdom.js');
  const r = await run({ timeout: 45000 }).catch((e) => ({ err: e.message }));
  console.log('FIELD16 len:', r && r.field16 ? r.field16.length : 0);
  console.log('capture message:', JSON.stringify(cap, null, 1));
  process.exit(0);
})();
