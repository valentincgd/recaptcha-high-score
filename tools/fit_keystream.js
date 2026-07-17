'use strict';
/**
 * fit_keystream.js — Cherche le générateur de keystream du champ 16.
 * Teste des familles LCG × fonctions de seed(key,elapsed) contre les keystreams connus.
 */
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'recaptcha', 'fingerprint');
const dec = JSON.parse(fs.readFileSync(path.join(DIR, 'decrypted_values.json'), 'utf8'));
const enc = JSON.parse(fs.readFileSync(path.join(DIR, 'encrypted_values.json'), 'utf8'));
function b64urlDecode(s){ s=s.replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; return Buffer.from(s,'base64'); }
const pairs=[];
(function walk(d,e){
  if(Array.isArray(d)&&Array.isArray(e)){
    if(d.length===3&&typeof d[0]==='string'&&typeof d[1]==='number'&&typeof e[0]==='string'){pairs.push({pt:d[0],ct:e[0],key:d[1],el:d[2]});return;}
    const n=Math.max(d.length,e.length); for(let i=0;i<n;i++)walk(d[i],e[i]);
  }
})(dec,enc);
const samples=[];
for(const p of pairs){
  if(!/^b/.test(p.ct))continue;
  const ptB=Buffer.from(p.pt,'utf8'), ctB=b64urlDecode(p.ct.slice(1));
  if(ctB.length!==ptB.length)continue;
  const ks=Buffer.alloc(ptB.length); for(let i=0;i<ptB.length;i++)ks[i]=ptB[i]^ctB[i];
  samples.push({key:p.key,el:p.el,ks:Array.from(ks),pt:p.pt});
}
// on garde les plus longs (mieux contraints)
samples.sort((a,b)=>b.ks.length-a.ks.length);
console.log(`samples XOR: ${samples.length}, plus long=${samples[0].ks.length} octets\n`);

const GOLD=2654435761;
const imul=Math.imul;
// familles LCG : [mult, inc, mod]  (mod=0 → 2^32 via >>>0)
const LCGS = {
  oc:        [13558035, 13037, 94906238],
  bqA:       [4391, 32779, 277],
  bqB:       [277, 4391, 32779],
  bqC:       [32779, 277, 4391],
  glibc:     [1103515245, 12345, 2147483648],
  numRec:    [1664525, 1013904223, 0],
  msvc:      [214013, 2531011, 0],
};
// fonctions de seed
const SEEDS = {
  key:        (k,e)=>k,
  keyXel:     (k,e)=>k^e,
  keyPlusEl:  (k,e)=>(k+e)|0,
  keyMulEl:   (k,e)=>imul(k,e),
  keyGold:    (k,e)=>imul(k,GOLD),
  elGold:     (k,e)=>imul(e,GOLD),
  keyXelGold: (k,e)=>imul(k^e,GOLD),
  keyPlusElGold:(k,e)=>imul((k+e)|0,GOLD),
};
// extracteurs d'octet
const OUTS = {
  mod256:      s=>((s%256)+256)%256,
  hi8:         s=>((s>>>24)&0xff),
  hi8b:        s=>((s>>>16)&0xff),
  low8u:       s=>((s>>>0)&0xff),
};
// avance-t-on l'état AVANT ou APRÈS l'output ?
function genKS(len, seedFn, lcg, outFn, preAdvance){
  const [A,C,M]=lcg;
  let s=seedFn>>>0;
  const out=[];
  for(let i=0;i<len;i++){
    if(preAdvance) s = M? ((((imul(s,A)+C)%M)+M)%M) : ((imul(s,A)+C)>>>0);
    out.push(outFn(s));
    if(!preAdvance) s = M? ((((imul(s,A)+C)%M)+M)%M) : ((imul(s,A)+C)>>>0);
  }
  return out;
}
function scoreAgainst(seedName,lcgName,outName,pre){
  let matchBytes=0, total=0, fullMatches=0;
  for(const smp of samples){
    const seed=SEEDS[seedName](smp.key,smp.el);
    const ks=genKS(smp.ks.length, seed, LCGS[lcgName], OUTS[outName], pre);
    let m=0; for(let i=0;i<ks.length;i++){ if(ks[i]===smp.ks[i])m++; total++; }
    matchBytes+=m; if(m===smp.ks.length)fullMatches++;
  }
  return {matchBytes,total,fullMatches,rate:matchBytes/total};
}
const results=[];
for(const sn of Object.keys(SEEDS))for(const ln of Object.keys(LCGS))for(const on of Object.keys(OUTS))for(const pre of [true,false]){
  const r=scoreAgainst(sn,ln,on,pre);
  results.push({combo:`LCG ${sn} × ${ln} × ${on} × ${pre?'pre':'post'}`,...r});
}

// ── Hash PAR POSITION : ks[i] = extract(hash(base, i)) ──
function rotl(x,r){return ((x<<r)|(x>>>(32-r)))>>>0;}
const PERPOS = {
  goldKeyElI:  (k,e,i)=> imul((k^e^i)>>>0, GOLD),
  goldKeyPlusI:(k,e,i)=> imul((k+e+i)>>>0, GOLD),
  goldKeyMulI: (k,e,i)=> imul(imul(k,e)^i, GOLD),
  murmurish:   (k,e,i)=>{ let h=(k^e)>>>0; h=imul(h^i,GOLD); h^=h>>>15; h=imul(h,GOLD); h^=h>>>13; return h;},
  rotGold:     (k,e,i)=> imul(rotl((k^e)>>>0, i&31), GOLD),
  xorshift:    (k,e,i)=>{ let s=((k^e)+imul(i,GOLD))>>>0; s^=s<<13; s>>>=0; s^=s>>>17; s^=s<<5; return s>>>0;},
};
function scorePerpos(pn,on){
  let mb=0,tot=0,full=0;
  for(const smp of samples){
    let m=0;
    for(let i=0;i<smp.ks.length;i++){ const v=OUTS[on](PERPOS[pn](smp.key>>>0,smp.el>>>0,i)); if(v===smp.ks[i])m++; tot++; }
    mb+=m; if(m===smp.ks.length)full++;
  }
  return {matchBytes:mb,total:tot,fullMatches:full,rate:mb/tot};
}
for(const pn of Object.keys(PERPOS))for(const on of Object.keys(OUTS)){
  const r=scorePerpos(pn,on); results.push({combo:`PERPOS ${pn} × ${on}`,...r});
}

results.sort((a,b)=>b.rate-a.rate);
console.log('Top 18 combinaisons (taux d\'octets keystream matchés) :');
for(const r of results.slice(0,18)) console.log(`  ${(r.rate*100).toFixed(2)}%  full=${r.fullMatches}  ${r.combo}`);
console.log(`\nbaseline hasard ≈ ${(100/256).toFixed(2)}%`);
