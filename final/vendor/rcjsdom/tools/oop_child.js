'use strict';
/**
 * oop_child.js — process ENFANT lancé avec --inspect-brk par oop_trace.js.
 * Il exécute la génération field16 (jsdom) ; le parent s'y connecte en CDP (out-of-process)
 * pour tracer sans course in-process. L'env RC_* est hérité du parent.
 */
process.env.RC_NO_FETCH = process.env.RC_NO_FETCH || '1';
process.env.RC_TLS = process.env.RC_TLS || '0';
process.env.RC_QUIET = '1';
process.env.RC_SCRIPT_FILE = process.env.RC_SCRIPT_FILE || 'recaptcha_pretty.js';
const { run } = require('../field16_jsdom.js');
run({ timeout: Number(process.env.RC_TIMEOUT) || 60000 })
  .then((r) => { console.error('CHILD_DONE field16=' + (r && r.field16 ? r.field16.length : 0)); process.exit(0); })
  .catch((e) => { console.error('CHILD_ERR ' + (e && e.message)); process.exit(1); });
