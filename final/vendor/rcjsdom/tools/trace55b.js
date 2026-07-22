'use strict';
const { spawn } = require('child_process');
const http = require('http'); const path = require('path'); const fs = require('fs');
const PORT = 9236;
function getWs(){return new Promise((res,rej)=>{const t=n=>http.get({host:'127.0.0.1',port:PORT,path:'/json/list'},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d)[0].webSocketDebuggerUrl)}catch(e){n<=0?rej(e):setTimeout(()=>t(n-1),200)}})}).on('error',e=>n<=0?rej(e):setTimeout(()=>t(n-1),200));t(30)})}
(async()=>{
  const child=spawn(process.execPath,['--inspect-brk='+PORT,path.join(__dirname,'oop_child.js')],{cwd:path.join(__dirname,'..'),env:process.env,stdio:['ignore','inherit','pipe']});
  const ws=new WebSocket(await getWs()); let id=0; const pend=new Map();
  const send=(m,p)=>new Promise((r,j)=>{const i=++id;pend.set(i,{r,j});ws.send(JSON.stringify({id:i,method:m,params:p||{}}))});
  const caps=[]; let busy=false,bp=null,fin=false;
  const onP=async(pr)=>{const f=pr.callFrames,t=f[0]; if(!t||t.location.lineNumber!==652){await send('Debugger.resume').catch(()=>{});return;} if(caps.length>=2||busy){if(caps.length>=2&&bp){await send('Debugger.removeBreakpoint',{breakpointId:bp}).catch(()=>{});bp=null}await send('Debugger.resume').catch(()=>{});return;} busy=true;
    try{
      const ev=await send('Debugger.evaluateOnCallFrame',{callFrameId:t.callFrameId,expression:`(function(){try{return (typeof d==='string'&&d.indexOf('[[[')>=0)?d:'';}catch(e){return ''}})()`,returnByValue:true});
      const dv=ev.result.value;
      if(dv&&dv.length>10){ const stack=f.slice(0,14).map(x=>(x.functionName||'?')+'@'+(x.location.lineNumber+1)); caps.push({d:dv.slice(0,200), stack}); }
    }catch(e){caps.push({err:e.message})} busy=false; await send('Debugger.resume').catch(()=>{});};
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){const p=pend.get(m.id);pend.delete(m.id);m.error?p.j(new Error(m.error.message)):p.r(m.result);return;}if(m.method==='Debugger.paused')onP(m.params);});
  await new Promise(r=>ws.addEventListener('open',r,{once:true}));
  await send('Runtime.enable'); await send('Debugger.enable');
  const b=await send('Debugger.setBreakpointByUrl',{urlRegex:'recaptcha__[a-z]+\.js$',lineNumber:652}); bp=b.breakpointId;
  await send('Runtime.runIfWaitingForDebugger');
  child.on('exit',()=>{if(fin)return;fin=true;fs.writeFileSync(path.join(__dirname,'..','scripts','t55b.json'),JSON.stringify(caps,null,1));console.log('caps:',caps.length);process.exit(0)});
  setTimeout(()=>{if(!fin){fin=true;fs.writeFileSync(path.join(__dirname,'..','scripts','t55b.json'),JSON.stringify(caps,null,1));console.log('timeout caps:',caps.length);try{child.kill()}catch(_){}process.exit(0)}},70000);
})().catch(e=>{console.error('FATAL',e);process.exit(1)});
