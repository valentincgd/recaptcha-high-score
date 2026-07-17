'use strict';
const fs = require('fs');
const s = fs.readFileSync('scripts/recaptcha__fr.js', 'utf8');
const count = (re) => (s.match(re) || []).length;
console.log('taille:', s.length, ' lignes:', s.split('\n').length);
console.log('charCodeAt:', count(/charCodeAt/g));
console.log('fromCharCode:', count(/fromCharCode/g));
console.log('XOR (^):', count(/\^/g));
console.log('base36 alpha:', s.includes('abcdefghijklmnopqrstuvwxyz'));
console.log('base64url alpha:', s.includes('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'));
console.log('base64std alpha:', s.includes('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'));

// gros string-array littéral ?
const bigArr = s.match(/\[(?:"(?:[^"\\]|\\.){0,25}",){40,}/);
console.log('gros string-array:', bigArr ? ('oui @' + s.indexOf(bigArr[0]) + ' (len~' + bigArr[0].length + ')') : 'non');

// signatures deriveKey (31*x) et base36
console.log('"* 31" ou "31 *":', count(/\*\s*31\b/g) + count(/\b31\s*\*/g));

// combien de fonctions ?
console.log('function kw:', count(/function/g), ' arrow =>:', count(/=>/g));
console.log('\nhead 400:', JSON.stringify(s.slice(0, 400)));
