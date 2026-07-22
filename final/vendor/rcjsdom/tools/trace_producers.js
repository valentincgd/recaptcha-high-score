'use strict';
/**
 * trace_producers.js — PHASE 0 : trace l'ORIGINE des valeurs de signaux field16.
 * Breakpoint au cipher par-signal L[40]@6760. Pour chaque valeur BINAIRE (hash-like, pas du JSON),
 * dumpe la valeur brute + les variables locales des frames hautes (le producteur dans la coroutine),
 * pour cartographier signal -> source de donnée.
 */
const inspector = require('inspector');
const session = new inspector.Session();
session.connect();
const post = (m, p) => new Promise((res, rej) => session.post(m, p || {}, (e, r) => (e ? rej(e) : res(r))));

const captured = [];
let busy = false;
let bpId = null;

async function onPaused(params) {
  const frames = params.callFrames;
  if (busy) return; // ne pas traiter une pause pendant qu'on en traite une autre (course CDP)
  if ((frames[0].location.lineNumber + 1) !== 6760) { await post('Debugger.resume').catch(() => {}); return; }
  if (captured.length >= 60) {
    if (bpId) { await post('Debugger.removeBreakpoint', { breakpointId: bpId }).catch(() => {}); bpId = null; }
    await post('Debugger.resume').catch(() => {});
    return;
  }
  busy = true;
  try {
    // Capture au frame TOP (L[40]) : w = valeur UTF8 encodée, D = clé. Pattern fiable (top frame).
    const ev = await post('Debugger.evaluateOnCallFrame', {
      callFrameId: frames[0].callFrameId,
      expression: `(function(){try{
        var isBin = typeof w==='string' && !/^[\\[{"]/.test(w) && /[\\x00-\\x1f\\x7f-\\xff]/.test(w);
        return JSON.stringify({ q:q, wType: typeof w, len: (w&&w.length)||0, isBin: isBin,
          head: (typeof w==='string')? Array.from(w.slice(0,20)).map(function(c){return c.charCodeAt(0);}) : null,
          key: (typeof D!=='undefined')? String(D) : '?',
          stack: (function(){try{throw new Error('x');}catch(e){return (e.stack||'').split('\\n').slice(1,7).map(function(s){return s.trim();});}})() });
      }catch(e){return JSON.stringify({err:String(e)});}})()`,
      returnByValue: true,
    });
    captured.push(JSON.parse(ev.result.value));
  } catch (e) { captured.push({ err: e.message }); }
  busy = false;
  await post('Debugger.resume').catch(() => {});
}

async function main() {
  session.on('Debugger.paused', (m) => { onPaused(m.params); });
  await post('Debugger.enable');
  const bp = await post('Debugger.setBreakpointByUrl', { urlRegex: 'recaptcha__[a-z]+\\.js$', lineNumber: 6759 }).catch((e) => ({ err: e.message }));
  bpId = bp && bp.breakpointId ? bp.breakpointId : null;
  console.error('bp L40 6760:', JSON.stringify(bp.locations || bp.err || bp));
  process.env.RC_NO_FETCH = '1'; process.env.RC_TLS = '0'; process.env.RC_QUIET = '1'; process.env.RC_SCRIPT_FILE = 'recaptcha_pretty.js';
  const { run } = require('../field16_jsdom.js');
  const r = await run({ timeout: 45000 }).catch((e) => ({ err: e.message }));
  console.log('field16:', r && r.field16 ? r.field16.length : 0, '| signaux binaires tracés:', captured.length);
  console.log('===PRODUCERS_JSON_START===');
  console.log(JSON.stringify(captured));
  console.log('===PRODUCERS_JSON_END===');
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
