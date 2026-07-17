'use strict';
const fs = require('fs');
const parser = require('@babel/parser');
const generate = require('@babel/generator').default;

const src = fs.readFileSync('scripts/recaptcha__fr.js', 'utf8');
console.log('parsing…');
const ast = parser.parse(src, { errorRecovery: true, sourceType: 'script' });
console.log('generating pretty…');
const out = generate(ast, { compact: false, comments: false, concise: false, retainLines: false }).code;
fs.writeFileSync('scripts/recaptcha_pretty.js', out);
console.log('écrit scripts/recaptcha_pretty.js  (' + out.length + ' chars, ' + out.split('\n').length + ' lignes)');
