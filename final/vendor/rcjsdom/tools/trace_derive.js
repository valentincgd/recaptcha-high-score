'use strict';
/**
 * trace_derive.js — trace les appels deriveSignalCode (fmix @ ligne 5510 du pretty/readable).
 * Capture (w, D, r, q) à chaque appel de la branche (q>>2&15)==3 → révèle l'input, les 2 seeds
 * (D chaîné, r accumulateur session) et l'ordre. But : comprendre la vraie génération des clés.
 */
const inspector = require('inspector');
const session = new inspector.Session();
session.connect();
const post = (m, p) => new Promise((res, rej) => session.post(m, p || {}, (e, r) => (e ? rej(e) : res(r))));

const captured = [];
let busy = false, bpId = null;
const LINE = Number(process.env.RC_DERIVE_LINE || 5180); // 1-indexé (pretty)

async function onPaused(params) {
  const frames = params.callFrames;
  if (busy) { return; }
  if ((frames[0].location.lineNumber + 1) !== LINE) { await post('Debugger.resume').catch(() => {}); return; }
  if (captured.length >= 200) {
    if (bpId) { await post('Debugger.removeBreakpoint', { breakpointId: bpId }).catch(() => {}); bpId = null; }
    await post('Debugger.resume').catch(() => {});
    return;
  }
  busy = true;
  try {
    const ev = await post('Debugger.evaluateOnCallFrame', {
      callFrameId: frames[0].callFrameId,
      expression: `(function(){try{
        if(!((q>>2&15)==3)) return "SKIP";
        var wt = typeof w;
        var wv = (wt==='string') ? (w.length<=40? w : w.slice(0,40)+'…') : String(w);
        return JSON.stringify({
          q: q,
          wType: wt,
          w: wv,
          D: (typeof D!=='undefined')? String(D):'undef',
          r: (typeof r!=='undefined')? String(r):'undef'
        });
      }catch(e){return JSON.stringify({err:String(e)});}})()`,
      returnByValue: true,
    });
    if (ev.result.value !== 'SKIP') captured.push(JSON.parse(ev.result.value));
  } catch (e) { captured.push({ err: e.message }); }
  busy = false;
  await post('Debugger.resume').catch(() => {});
}

async function main() {
  session.on('Debugger.paused', (m) => { onPaused(m.params); });
  await post('Debugger.enable');
  // conditionnel : ne pause QUE sur la branche deriveSignalCode → évite des milliers de pauses
  const bp = await post('Debugger.setBreakpointByUrl', {
    urlRegex: 'recaptcha__[a-z]+\\.js$', lineNumber: LINE - 1,
    condition: '(typeof q!=="undefined") && ((q>>2&15)==3)',
  }).catch((e) => ({ err: e.message }));
  bpId = bp && bp.breakpointId ? bp.breakpointId : null;
  console.error('bp derive @' + LINE + ': locations=' + JSON.stringify(bp.locations || bp.err || '?'));
  process.env.RC_NO_FETCH = '1'; process.env.RC_TLS = '0'; process.env.RC_QUIET = '1'; process.env.RC_SCRIPT_FILE = 'recaptcha_pretty.js';
  const { run } = require('../field16_jsdom.js');
  const r = await run({ timeout: 60000 }).catch((e) => ({ err: e.message }));
  console.log('field16:', r && r.field16 ? r.field16.length : 0, '| appels deriveSignalCode tracés:', captured.length);
  console.log('===DERIVE_JSON_START===');
  console.log(JSON.stringify(captured));
  console.log('===DERIVE_JSON_END===');
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
