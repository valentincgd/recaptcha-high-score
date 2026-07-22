'use strict';
/**
 * debug_dsc.js — capture le SEED de deriveSignalCode (ligne 5180) pour les key1 de field16.
 * Breakpoint conditionnel : ne s'arrête que quand la fmix recalculée == un key1 cible.
 * Dump (w=input, D=seed, résultat) → révèle input + seed de chaque key1.
 */
const inspector = require('inspector');
const session = new inspector.Session();
session.connect();
const post = (m, p) => new Promise((res, rej) => session.post(m, p || {}, (e, r) => (e ? rej(e) : res(r))));

// key1 cibles observés dans field16 (mix grands + petits)
const TARGETS = [1761, 3553, 1633, 1636, 1180630190, 1966519198, 3837, 220340964, 1518092366];
const caught = [];

async function onPaused(params) {
  const fr = params.callFrames[0];
  try {
    const expr = `(function(){
      var _w=w, _D=(D===void 0?0:D);
      var _d=(typeof _w==="string"?J[2](48,_w,_D):_w+_D)|0;
      _d=(_d>>16^_d)*2642172555; _d=(_d>>16^_d)*2642172555; _d=_d>>16^_d;
      return JSON.stringify({w:(typeof _w==="string"?_w:("#"+_w)), wType:typeof _w, D:_D, res:_d});
    })()`;
    const ev = await post('Debugger.evaluateOnCallFrame', { callFrameId: fr.callFrameId, expression: expr, returnByValue: true });
    caught.push(JSON.parse(ev.result.value));
    require('fs').writeFileSync(require('path').join(__dirname, '..', 'scripts', 'dsc_seed.json'), JSON.stringify(caught, null, 1));
  } catch (e) { caught.push({ err: e.message }); }
  await post('Debugger.resume');
}

async function main() {
  session.on('Debugger.paused', (m) => { onPaused(m.params); });
  await post('Debugger.enable');
  const cond = `(function(){try{var _w=w,_D=(D===void 0?0:D);var _d=(typeof _w==="string"?J[2](48,_w,_D):_w+_D)|0;_d=(_d>>16^_d)*2642172555;_d=(_d>>16^_d)*2642172555;_d=_d>>16^_d;return [${TARGETS.join(',')}].indexOf(_d)>=0;}catch(e){return false;}})()`;
  const bp = await post('Debugger.setBreakpointByUrl', { urlRegex: 'recaptcha__[a-z]+\\.js$', lineNumber: 5179, condition: cond }).catch((e) => ({ err: e.message }));
  console.error('bp dsc 5180:', JSON.stringify(bp.locations || bp.err || bp));

  process.env.RC_NO_FETCH = '1'; process.env.RC_TLS = '0'; process.env.RC_QUIET = '1'; process.env.RC_SCRIPT_FILE = 'recaptcha_pretty.js';
  const { run } = require('../field16_jsdom.js');
  const r = await run({ timeout: 45000 }).catch((e) => ({ err: e.message }));
  console.log('FIELD16 len:', r && r.field16 ? r.field16.length : 0);
  console.log('captures dsc:', caught.length);
  caught.forEach((c) => console.log('  ' + JSON.stringify(c)));
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
