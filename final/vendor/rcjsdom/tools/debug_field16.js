'use strict';
/**
 * debug_field16.js — VRAI debugger via node:inspector (CDP en code).
 * Breakpoint sur le send /reload (recaptcha_pretty.js:5881) → à l'arrêt, dump la pile vivante +
 * cherche la string field16 dans les variables locales de chaque frame → localise son builder.
 */
const inspector = require('inspector');
const session = new inspector.Session();
session.connect();
const post = (m, p) => new Promise((res, rej) => session.post(m, p || {}, (e, r) => (e ? rej(e) : res(r))));

let hits = 0;
const findings = [];

const visited = new Set();
async function searchObj(objectId, pathStr, depth) {
  if (depth > 4 || !objectId || visited.has(objectId) || visited.size > 4000) return;
  visited.add(objectId);
  const props = await post('Runtime.getProperties', { objectId, ownProperties: true }).catch(() => ({ result: [] }));
  for (const p of (props.result || [])) {
    const v = p.value; if (!v) continue;
    if (v.type === 'string' && typeof v.value === 'string' && v.value.length > 2500 && /^0[A-Za-z0-9_-]/.test(v.value)) {
      findings.push(`${pathStr}.${p.name} = str(${v.value.length}) "${v.value.slice(0, 20)}"  ← FIELD16 probable`);
    } else if (v.objectId && depth < 4 && (v.type === 'object' || v.type === 'function')) {
      await searchObj(v.objectId, pathStr + '.' + p.name, depth + 1);
    }
  }
}

const l40hits = [];
async function onPaused(params) {
  const frames0 = params.callFrames;
  const line = frames0[0].location.lineNumber;
  // Breakpoint L[40] (6759) : capturer les args réels d'un vrai signal chiffré
  if (line === 6759) {
    if (l40hits.length < 80) {
      try {
        const expr = `(function(){
          var o={};
          try{o.q=q;o.r=r;}catch(e){o.q="e:"+e}
          try{o.w=Array.prototype.slice.call(w,0,(w.length<400?w.length:90));o.wLen=w.length;}catch(e){o.w="e:"+e}
          try{o.D=String(D);o.dTyp=typeof D;o.d=String(d);o.key=String(D)+String(d);}catch(e){o.D="e:"+e}
          try{o.vDollar=(typeof v$!=="undefined")?v$:"undef";}catch(e){o.vDollar="e:"+e}
          return JSON.stringify(o);
        })()`;
        // capturer la pile + les locals du frame appelant (802) au 1er hit
        try{ if(!global.__l40stack){
          global.__l40stack = frames0.slice(0,8).map(f=>`${f.functionName||'?'}@${(f.url||'').split('/').pop()}:${f.location.lineNumber+1}`);
          // dump des locals des frames 1,2,3 (caller chain)
          const dumps={stack:global.__l40stack, frames:[]};
          for(let fi=1; fi<=3 && fi<frames0.length; fi++){
            const scopes = frames0[fi].scopeChain||[];
            const loc = scopes.find(s=>s.type==='local');
            if(loc&&loc.object&&loc.object.objectId){
              const props = await post('Runtime.getProperties',{objectId:loc.object.objectId, ownProperties:true}).catch(()=>({result:[]}));
              const vars={};
              for(const p of (props.result||[])){ const v=p.value; if(!v)continue; vars[p.name]=(v.type==='string')?('str:'+String(v.value).slice(0,40)):(v.type==='object'?('obj'):(v.value!==undefined?v.value:v.type)); }
              dumps.frames.push({frame:fi, line:frames0[fi].location.lineNumber+1, vars});
            }
          }
          require('fs').writeFileSync(require('path').join(__dirname,'..','scripts','l40stack.json'), JSON.stringify(dumps,null,1));
        } }catch(e){ try{require('fs').writeFileSync(require('path').join(__dirname,'..','scripts','l40stack.json'), JSON.stringify({err:e.message}));}catch(_){} }
        const ev = await post('Debugger.evaluateOnCallFrame', { callFrameId: frames0[0].callFrameId, expression: expr, returnByValue: true });
        l40hits.push(JSON.parse(ev.result.value));
        require('fs').writeFileSync(require('path').join(__dirname, '..', 'scripts', 'l40.json'), JSON.stringify(l40hits, null, 1));
      } catch (e) { l40hits.push({ err: e.message }); }
    }
    await post('Debugger.resume'); return;
  }
  hits++;
  if (hits > 3) { await post('Debugger.resume'); return; }
  try {
    const frames = params.callFrames.slice(0, 14);
    const stack = frames.map((fr) => `${fr.functionName || '?'}@${(fr.url || '').split('/').pop()}:${fr.location.lineNumber + 1}`);
    // Au breakpoint outer (17854), g/h/L en scope. Capturer sources + tester L[40]/g[37]/h[16].
    try {
      const expr = `(function(){
        var o={};
        try{o.h38=h[38].toString();}catch(e){o.h38="e:"+e}
        try{o.J22=J[22].toString();}catch(e){o.J22="e:"+e}
        try{o.y5=y[5].toString();}catch(e){o.y5="e:"+e}
        // test h[38] : accumulateur hash (C=0, chunk [65,66]) → nouveau C. Puis 2e appel chaîné.
        try{var C1=h[38](4,0,1,5,3,0,[65,66]); var C2=h[38](4,0,1,5,3,C1,[67,68]); o.h38Test={C1:C1,C2:C2};}catch(e){o.h38Test="e:"+e}
        // test h[38] avec chunk vide / 1 octet pour la formule
        try{o.h38b={a:h[38](4,0,1,5,3,0,[0]),b:h[38](4,0,1,5,3,0,[1]),c:h[38](4,0,1,5,3,1,[0])};}catch(e){o.h38b="e:"+e}
        // capturer la table p_ (globale utilisée par h[38])
        try{o.p_=(typeof p_!=="undefined")?Array.prototype.slice.call(p_):"undef";}catch(e){o.p_="e:"+e}
        // vecteurs de test h[38] pour vérifier la repro : (seed, chunk) → hash
        try{o.hv=[
          {s:0,c:[65,66],h:h[38](4,0,1,5,3,0,[65,66])},
          {s:0,c:[65,66,67,68],h:h[38](4,0,1,5,3,0,[65,66,67,68])},
          {s:123,c:[10,20,30],h:h[38](4,0,1,5,3,123,[10,20,30])}
        ];}catch(e){o.hv="e:"+e}
        // C = m[0](3) et son comportement C.call(byte, 0) ; S[21](C, 14)
        try{var C=m[0](3); o.Ctype=typeof C; o.Ccall=[C.call(65,0),C.call(66,0),C.call(200,0)];}catch(e){o.Ccall="e:"+e}
        try{var C2=m[0](3); o.S21=Array.prototype.slice.call(S[21](C2,14),0,10);}catch(e){o.S21="e:"+e}
        try{o.vDollar=(typeof v$!=="undefined")?v$:"undef";}catch(e){o.vDollar="e:"+e}
        return JSON.stringify(o);
      })()`;
      const ev = await post('Debugger.evaluateOnCallFrame', { callFrameId: frames[0].callFrameId, expression: expr, returnByValue: true });
      const o = JSON.parse(ev.result.value);
      require("fs").writeFileSync(require("path").join(__dirname,"..","scripts","gh2.json"), JSON.stringify(o, null, 1));
      findings.push(`HIT#${hits} hTest([100,200,50]⊕[5,7,9])=${JSON.stringify(o.hTest)}\n  gTest(keystream "AB"/12345)=${JSON.stringify(o.gTest)}\n  gTest2(déterministe?)=${JSON.stringify(o.gTest2)}`);
    } catch (e) { findings.push('EV_ERR ' + e.message); }
  } catch (e) { findings.push('ERR ' + e.message); }
  await post('Debugger.resume');
}

async function main() {
  session.on('Debugger.paused', (m) => { onPaused(m.params); });
  await post('Debugger.enable');
  // breakpoint sur l'encodeur base64 (ligne 300) quand input=37 octets (= valeur chiffrée d'un signal)
  const bp = await post('Debugger.setBreakpointByUrl', { urlRegex: 'recaptcha__[a-z]+\\.js$', lineNumber: 17854 }).catch((e) => ({ err: e.message }));
  console.error("bp outer 17854:", JSON.stringify(bp.locations || bp.err || bp));
  const bp2 = await post('Debugger.setBreakpointByUrl', { urlRegex: 'recaptcha__[a-z]+\\.js$', lineNumber: 6759 }).catch((e) => ({ err: e.message }));
  console.error("bp L40 6759:", JSON.stringify(bp2.locations || bp2.err || bp2));

  process.env.RC_NO_FETCH = '1'; process.env.RC_TLS = '0'; process.env.RC_QUIET = '1'; process.env.RC_SCRIPT_FILE = 'recaptcha_pretty.js';
  const { run } = require('../field16_jsdom.js');
  const r = await run({ timeout: 45000 }).catch((e) => ({ err: e.message }));
  console.log('FIELD16 len:', r && r.field16 ? r.field16.length : 0, 'début:', r && r.field16 ? r.field16.slice(0, 20) : '-');
  try { const p = require('path').join(__dirname, '..', 'scripts', 'field16_pipeline.json'); const o = JSON.parse(require('fs').readFileSync(p, 'utf8')); o.field16 = (r && r.field16) || ''; require('fs').writeFileSync(p, JSON.stringify(o, null, 1)); } catch (_) {}
  console.log('breakpoint hits:', hits);
  console.log('\n=== variables longues (~field16) dans la pile au send ===');
  findings.forEach((f) => console.log('  ' + f));
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
