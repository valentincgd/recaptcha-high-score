'use strict';
const { spawn } = require('child_process');
const http = require('http'); const path = require('path'); const fs = require('fs');
const PORT = 9238;
function getWs(){return new Promise((res,rej)=>{const t=n=>http.get({host:'127.0.0.1',port:PORT,path:'/json/list'},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d)[0].webSocketDebuggerUrl)}catch(e){n<=0?rej(e):setTimeout(()=>t(n-1),200)}})}).on('error',e=>n<=0?rej(e):setTimeout(()=>t(n-1),200));t(30)})}
(async()=>{
  const child=spawn(process.execPath,['--inspect-brk='+PORT,path.join(__dirname,'oop_child.js')],{cwd:path.join(__dirname,'..'),env:process.env,stdio:['ignore','inherit','pipe']});
  const ws=new WebSocket(await getWs()); let id=0; const pend=new Map();
  const send=(m,p)=>new Promise((r,j)=>{const i=++id;pend.set(i,{r,j});ws.send(JSON.stringify({id:i,method:m,params:p||{}}))});
  let done=false,bp=null,busy=false; const out={};
  const onP=async(pr)=>{const f=pr.callFrames,t=f[0]; if(!t||t.location.lineNumber!==652){await send('Debugger.resume').catch(()=>{});return;} if(done||busy){await send('Debugger.resume').catch(()=>{});return;}
    // vérifier si c'est le signal [55] (d commence par "[[[")
    let isTarget=false;
    try{ const ev=await send('Debugger.evaluateOnCallFrame',{callFrameId:t.callFrameId,expression:`(function(){try{return typeof d==='string'&&d.indexOf('[[[')>=0}catch(e){return false}})()`,returnByValue:true}); isTarget=ev.result.value===true; }catch(e){}
    if(!isTarget){await send('Debugger.resume').catch(()=>{});return;}
    busy=true; done=true;
    // dump TOUTES les frames : toutes les variables locales+closure
    const frames=[];
    for(let fi=0;fi<Math.min(14,f.length);fi++){
      const fr=f[fi]; const vars={};
      for(const sc of (fr.scopeChain||[])){ if(sc.type!=='local'&&sc.type!=='closure')continue; if(!sc.object||!sc.object.objectId)continue;
        const props=await send('Runtime.getProperties',{objectId:sc.object.objectId,ownProperties:true}).catch(()=>({result:[]}));
        for(const p of (props.result||[])){ const v=p.value; if(!v)continue; let val; if(v.type==='string')val='s['+(v.value?v.value.length:0)+']:'+String(v.value).slice(0,50); else if(v.type==='number'||v.type==='boolean')val=v.value; else val=v.type+(v.className?'/'+v.className:''); vars[sc.type+':'+p.name]=val; } }
      frames.push({i:fi,line:fr.location.lineNumber+1,vars});
    }
    out.frames=frames;
    if(bp){await send('Debugger.removeBreakpoint',{breakpointId:bp}).catch(()=>{});bp=null}
    await send('Debugger.resume').catch(()=>{});
  };
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){const p=pend.get(m.id);pend.delete(m.id);m.error?p.j(new Error(m.error.message)):p.r(m.result);return;}if(m.method==='Debugger.paused')onP(m.params);});
  await new Promise(r=>ws.addEventListener('open',r,{once:true}));
  await send('Runtime.enable'); await send('Debugger.enable');
  const b=await send('Debugger.setBreakpointByUrl',{urlRegex:'recaptcha__[a-z]+\.js$',lineNumber:652}); bp=b.breakpointId;
  await send('Runtime.runIfWaitingForDebugger');
  const fin=()=>{fs.writeFileSync(path.join(__dirname,'..','scripts','t55full.json'),JSON.stringify(out,null,1));console.log('done, frames:',(out.frames||[]).length);process.exit(0)};
  child.on('exit',fin); setTimeout(fin,75000);
})().catch(e=>{console.error('FATAL',e);process.exit(1)});
