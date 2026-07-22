'use strict';
/**
 * oop_trace.js — Debugger OUT-OF-PROCESS (fondation du full reverse field16).
 * Lance oop_child.js avec --inspect-brk, se connecte en CDP via WebSocket (Node 22 global),
 * pose un breakpoint au cipher par-signal L[40]@6760 et, À CHAQUE pause, marche TOUTES les frames
 * de façon fiable (pas de course in-process) pour capturer : valeur du signal + variables des frames
 * productrices (la coroutine de collecte).
 *
 * Usage : node tools/oop_trace.js   (env RC_* comme les autres outils)
 * Sortie : scripts/oop_producers.json
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = 9231;
const MAX_CAP = Number(process.env.OOP_MAX || 40);
const BP_LINE = Number(process.env.OOP_LINE || 6759); // 0-indexed -> L[40] ligne 6760

function getWsUrl(port) {
  return new Promise((resolve, reject) => {
    const tryOnce = (n) => {
      http.get({ host: '127.0.0.1', port, path: '/json/list' }, (res) => {
        let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => {
          try { const j = JSON.parse(d); resolve(j[0].webSocketDebuggerUrl); } catch (e) { retry(n, e); }
        });
      }).on('error', (e) => retry(n, e));
    };
    const retry = (n, e) => { if (n <= 0) return reject(e); setTimeout(() => tryOnce(n - 1), 200); };
    tryOnce(30);
  });
}

async function main() {
  const child = spawn(process.execPath, ['--inspect-brk=' + PORT, path.join(__dirname, 'oop_child.js')], {
    cwd: path.join(__dirname, '..'),
    env: process.env,
    stdio: ['ignore', 'inherit', 'pipe'],
  });
  child.stderr.on('data', (b) => { const s = String(b); if (/CHILD_DONE|CHILD_ERR|FATAL/.test(s)) process.stderr.write('[child] ' + s); });

  const wsUrl = await getWsUrl(PORT);
  console.error('CDP WS:', wsUrl);
  const ws = new WebSocket(wsUrl);

  let msgId = 0;
  const pending = new Map();
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });

  const captured = [];
  let busy = false, bpId = null, finished = false;

  const onPaused = async (params) => {
    const frames = params.callFrames;
    const top = frames[0];
    if (!top || top.location.lineNumber !== BP_LINE) { await send('Debugger.resume').catch(() => {}); return; }
    if (captured.length >= MAX_CAP) {
      if (bpId) { await send('Debugger.removeBreakpoint', { breakpointId: bpId }).catch(() => {}); bpId = null; }
      await send('Debugger.resume').catch(() => {});
      return;
    }
    if (busy) return;
    busy = true;
    try {
      // valeur + clé au frame top (L[40]) via evaluate
      const ev = await send('Debugger.evaluateOnCallFrame', {
        callFrameId: top.callFrameId,
        expression: `(function(){try{var b=(typeof w==='string')?w:'';var bin=b&&!/^[\\[{\"]/.test(b)&&/[\\x00-\\x1f\\x7f-\\xff]/.test(b);return JSON.stringify({q:q,len:(w&&w.length)||0,isBin:bin,key:String(D),bytes:Array.from(b.slice(0,32)).map(c=>c.charCodeAt(0))});}catch(e){return JSON.stringify({err:String(e)});}})()`,
        returnByValue: true,
      });
      const info = JSON.parse(ev.result.value);
      // On ne veut QUE les signaux field16 = valeurs COURTES (<120o). Les longues (JSON) vont ailleurs.
      if (info.len >= 120 || info.len < 1) { busy = false; await send('Debugger.resume').catch(() => {}); return; }
      let fullVal = null;
      if (frames[1]) {
        const fv = await send('Debugger.evaluateOnCallFrame', {
          callFrameId: frames[1].callFrameId,
          expression: `(function(){try{return (typeof r==='string')?r:JSON.stringify(r);}catch(e){return 'ERR';}})()`,
          returnByValue: true,
        }).catch(() => null);
        if (fv && fv.result) fullVal = fv.result.value;
      }
      // STACK source (lignes de recaptcha_pretty.js) pour lire la génération
      const stack = frames.slice(0, 12).map((f) => (f.functionName || '?') + '@' + (f.location.lineNumber + 1) + ':' + f.location.columnNumber);
      captured.push({ info, val: fullVal, stack });
    } catch (e) { captured.push({ err: e.message }); }
    busy = false;
    await send('Debugger.resume').catch(() => {});
  };

  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
      return;
    }
    if (m.method === 'Debugger.paused') onPaused(m.params);
  });

  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  await send('Runtime.enable');
  await send('Debugger.enable');
  const bp = await send('Debugger.setBreakpointByUrl', { urlRegex: 'recaptcha__[a-z]+\\.js$', lineNumber: BP_LINE });
  bpId = bp.breakpointId;
  console.error('bp:', bpId, 'locations:', (bp.locations || []).length);
  await send('Runtime.runIfWaitingForDebugger'); // démarre l'enfant

  child.on('exit', (code) => {
    if (finished) return; finished = true;
    fs.writeFileSync(path.join(__dirname, '..', 'scripts', 'oop_producers.json'), JSON.stringify(captured, null, 1));
    console.error('child exit', code, '| captures:', captured.length, '-> scripts/oop_producers.json');
    process.exit(0);
  });
  setTimeout(() => { if (!finished) { finished = true; try { fs.writeFileSync(path.join(__dirname, '..', 'scripts', 'oop_producers.json'), JSON.stringify(captured, null, 1)); } catch (_) {} console.error('timeout | captures:', captured.length); try { child.kill(); } catch (_) {} process.exit(0); } }, 90000);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
