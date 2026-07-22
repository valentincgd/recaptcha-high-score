'use strict';
const msgs=[];
global.__port=function(data){ try{ let s; if(typeof data==='string')s=data; else s=JSON.stringify(data); msgs.push(s.slice(0,300)); }catch(_){ msgs.push('<'+typeof data+'>'); } };
process.env.RC_PORTHOOK='1'; process.env.RC_NO_FETCH='1'; process.env.RC_TLS='0'; process.env.RC_QUIET='1'; process.env.RC_SCRIPT_FILE='recaptcha_pretty.js';
require('../field16_jsdom.js').run({timeout:45000}).then(r=>{
  console.log('field16='+(r.field16?r.field16.length:0)+' | messages port capturés: '+msgs.length);
  console.log('=== échantillon messages Worker/main ===');
  msgs.slice(0,25).forEach((m,i)=>console.log('#'+i+' '+m));
  process.exit(0);
}).catch(e=>{console.error('ERR',e.message);process.exit(1)});
