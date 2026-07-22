'use strict';
const { spawn } = require('child_process');
const http = require('http'); const path = require('path'); const fs = require('fs');
const PORT = 9240;
function getWs(){return new Promise((res,rej)=>{const t=n=>http.get({host:'127.0.0.1',port:PORT,path:'/json/list'},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d)[0].webSocketDebuggerUrl)}catch(e){n<=0?rej(e):setTimeout(()=>t(n-1),200)}})}).on('error',e=>n<=0?rej(e):setTimeout(()=>t(n-1),200));t(30)})}
(async()=>{
  const child=spawn(process.execPath,['--inspect-brk='+PORT,path.join(__dirname,'oop_child.js')],{cwd:path.join(__dirname,'..'),env:process.env,stdio:['ignore','inherit','pipe']});
  const ws=new WebSocket(await getWs()); let id=0; const pend=new Map();
  const send=(m,p)=>new Promise((r,j)=>{const i=++id;pend.set(i,{r,j});ws.send(JSON.stringify({id:i,method:m,params:p||{}}))});
  let done=false,bp=null,busy=false;
  const onP=async(pr)=>{const f=pr.callFrames,t=f[0]; if(done||busy||!t||t.location.lineNumber!==652){await send('Debugger.resume').catch(()=>{});return;} busy=true;
    let isT=false; try{const ev=await send('Debugger.evaluateOnCallFrame',{callFrameId:t.callFrameId,expression:"(typeof d==='string'&&d.indexOf('[[')>=0)",returnByValue:true});isT=ev.result.value===true;}catch(e){}
    if(!isT){busy=false;await send('Debugger.resume').catch(()=>{});return;}
    done=true; if(bp){await send('Debugger.removeBreakpoint',{breakpointId:bp}).catch(()=>{});bp=null;}
    const dump=[];
    for(let fi=0;fi<8&&fi<f.length;fi++){ const fr=f[fi]; const vars={};
      for(const sc of (fr.scopeChain||[])){ if((sc.type==='local'||sc.type==='closure')&&sc.object&&sc.object.objectId){ try{ const pp=await send('Runtime.getProperties',{objectId:sc.object.objectId,ownProperties:true}); for(const p of (pp.result||[])){const v=p.value;if(!v)continue; if(v.type==='string')vars[p.name]='s:'+String(v.value).slice(0,60); } }catch(e){} } }
      dump.push({i:fi,line:fr.location.lineNumber+1,vars});
    }
    fs.writeFileSync(path.join(__dirname,'..','scripts','t55f.json'),JSON.stringify(dump,null,1));
    console.log('DUMPED frames:',dump.length);
    await send('Debugger.resume').catch(()=>{});
  };
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){const p=pend.get(m.id);pend.delete(m.id);m.error?p.j(new Error(m.error.message)):p.r(m.result);return;}if(m.method==='Debugger.paused')onP(m.params);});
  await new Promise(r=>ws.addEventListener('open',r,{once:true}));
  await send('Runtime.enable'); await send('Debugger.enable');
  const b=await send('Debugger.setBreakpointByUrl',{urlRegex:'recaptcha__[a-z]+\.js$',lineNumber:652}); bp=b.breakpointId;
  await send('Runtime.runIfWaitingForDebugger');
  child.on('exit',()=>process.exit(0)); setTimeout(()=>process.exit(0),75000);
})().catch(e=>{console.error('FATAL',e);process.exit(1)});
