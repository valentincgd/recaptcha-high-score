'use strict';
const fs = require('fs');
let s = fs.readFileSync('scripts/recaptcha_pretty.js', 'utf8');

// Site cipher exact (ligne 147 du pretty) :
const target = `for (N = (A = m[32](17, w, r, D), x = 0, C)[1]; x < d.length; x++) N += String.fromCharCode(d.charCodeAt(x) ^ A());`;
const repl = `{ A = m[32](17, w, r, D); N = C[1]; var __ks = []; for (x = 0; x < d.length; x++) { var __k = A(); __ks.push(__k); N += String.fromCharCode(d.charCodeAt(x) ^ __k); } try { if (typeof self !== 'undefined' && self.__cc) { var __env=''; try{ __env=JSON.stringify({ Mt:(typeof Mt!=='undefined'?Mt:null), Ud:(typeof Ud!=='undefined'?Ud.toString():''), wa:(typeof wa!=='undefined'?wa.toString():''), y5:(typeof y!=='undefined'&&y[5]?y[5].toString():''), UdD:(typeof Ud!=='undefined'?Ud(D):null), waTest:(typeof wa!=='undefined'?wa(1234.9):null) }); }catch(_z){ __env='ERR:'+_z.message; } self.__cc(d, __ks, w, r, D, (typeof A === 'function' ? A.toString() : ''), __env); } } catch (_e) {} }`;

const n = s.split(target).length - 1;
if (n !== 1) { console.error('✖ cible cipher trouvée ' + n + ' fois (attendu 1) — abandon'); process.exit(1); }
s = s.replace(target, repl);

// Site 2 : hashString (Java hashCode 31*h+c) = base de deriveSignalCode / deriveKey
const target2 = `for (x = 0; x < r.length; x++) d = D.call(r, x), A = (A << 5) - A + d, A &= A;`;
const repl2 = `{ var __seed = A; for (x = 0; x < r.length; x++) { d = D.call(r, x); A = (A << 5) - A + d; A &= A; } try { if (typeof self !== 'undefined' && self.__cc2) { var __st=''; try{ __st=(new Error()).stack||''; }catch(_s){} self.__cc2(String(r), __seed, A, __st); } } catch (_e) {} }`;
const n2 = s.split(target2).length - 1;
if (n2 !== 1) { console.error('✖ cible hashString trouvée ' + n2 + ' fois (attendu 1) — abandon'); process.exit(1); }
s = s.replace(target2, repl2);

fs.writeFileSync('scripts/recaptcha_instrumented.js', s);
console.log('✔ instrumenté (cipher + hashString) → scripts/recaptcha_instrumented.js (' + s.length + ' chars)');
