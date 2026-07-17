'use strict';
/**
 * vm/decode_config.js — ÉTAPE 1 du solver VM pur-JS (sans Chrome, sans jsdom).
 *
 * Récupère le CONFIG bytecode de la VM reCAPTCHA depuis un anchor live et le DÉCHIFFRE, en pur JS.
 * C'est le bootstrap de la VM : le config bytecode contient les strings VM chiffrées, les clés de
 * déchiffrement des signaux, et la liste des signaux à collecter.
 *
 * Port fidèle de l'implémentation Go de référence (recaptcha-tm-api internal/{anchor,bytecode}) :
 *   1. GET /anchor → HTML → parse `recaptcha.anchor.Main.init([...])`
 *   2. extractConfig : trouve le sous-tableau "conf" (config bytecode) + les VmBytecodeKeys (paires de clés)
 *   3. DecryptConfig : DecodeCustom(base64 custom) → xorDecrypt( seed = xorFold(k1,k2) ) via LCG (4391·s+277)%32779
 *
 * Usage : node vm/decode_config.js [siteKey] [origin]
 */
const tlsc = require('node-tls-client');

const DEFAULT_SITEKEY = '6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV';
const DEFAULT_ORIGIN = 'https://www.ticketmaster.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';

// ---------- co (base64 std, façon Go resolvePageContext pour TM) ----------
function encodeCoStd(origin) { return Buffer.from(origin, 'utf8').toString('base64'); }

// La sitekey TM est enregistrée sur auth.ticketmaster.com → anchor VALIDE (Main.init) uniquement là.
const TM_SITEKEYS = new Set(['6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV', '6LdoaXQrAAAAADQviABd-eByJu6kPL8awKDyc1zb']);
function resolveAnchorContext(siteKey, origin) {
  if (TM_SITEKEYS.has(siteKey)) {
    return { co: encodeCoStd('https://auth.ticketmaster.com:443'), referer: 'https://auth.ticketmaster.com/' };
  }
  const base = origin.replace(/\/$/, '');
  return { co: encodeCoStd(base + ':443'), referer: base + '/' };
}

// ---------- fetch anchor HTML ----------
async function fetchAnchorHTML(siteKey, origin) {
  const ctx = resolveAnchorContext(siteKey, origin);
  const co = ctx.co;
  const cb = Math.random().toString(36).slice(2, 14);
  // version : on la prend du bootstrap enterprise.js
  await tlsc.initTLS();
  const s = new tlsc.Session({ clientIdentifier: 'chrome_150', timeout: 30000 });
  try {
    const boot = await s.get('https://www.google.com/recaptcha/enterprise.js?render=' + siteKey, {
      headers: { 'user-agent': UA, 'accept': '*/*', 'referer': 'https://www.google.com/' },
    });
    const bootTxt = await boot.text();
    const mv = bootTxt.match(/releases\/([A-Za-z0-9_-]{8,})\/recaptcha__([a-z]{2})\.js/);
    const version = mv ? mv[1] : 'TnA7HacJFoBWt9hnlunBlYfK';
    const url = `https://www.google.com/recaptcha/enterprise/anchor?ar=1&k=${siteKey}` +
      `&co=${co}&hl=fr&v=${version}&size=invisible&anchor-ms=20000&execute-ms=30000&cb=${cb}`;
    const res = await s.get(url, {
      headers: {
        'user-agent': UA, 'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'fr-FR,fr;q=0.9', 'referer': ctx.referer,
        'sec-fetch-dest': 'iframe', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'cross-site',
        'upgrade-insecure-requests': '1',
      },
    });
    return { html: await res.text(), version, status: res.status };
  } finally {
    try { await s.close(); } catch (_) {}
    try { await tlsc.destroyTLS(); } catch (_) {}
  }
}

// ---------- parse recaptcha.anchor.Main.init([...]) (port de anchor/parse.go) ----------
function decodeJsEscapes(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '\\' || i + 1 >= s.length) { out += s[i]; continue; }
    const n = s[i + 1];
    if (n === 'x' && i + 3 < s.length) { out += String.fromCharCode(parseInt(s.slice(i + 2, i + 4), 16)); i += 3; continue; }
    if (n === 'u' && i + 5 < s.length) { out += String.fromCharCode(parseInt(s.slice(i + 2, i + 6), 16)); i += 5; continue; }
    out += n; i += 1;
  }
  return out;
}
function findMatchingBracket(html, start) {
  let depth = 0, inStr = false, esc = false, q = '';
  for (let j = start; j < html.length; j++) {
    const c = html[j];
    if (inStr) { if (esc) { esc = false; continue; } if (c === '\\') { esc = true; continue; } if (c === q) inStr = false; continue; }
    if (c === '"' || c === "'") { inStr = true; q = c; continue; }
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) return j; }
  }
  return -1;
}
function readQuoted(html, start, quote) {
  let out = '';
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (c === '\\' && i + 1 < html.length) {
      out += '\\' + html[i + 1];
      if (html[i + 1] === 'x' && i + 3 < html.length) { out += html[i + 2] + html[i + 3]; i += 3; continue; }
      i += 1; continue;
    }
    if (c === quote) return out;
    out += c;
  }
  return null;
}
function extractMainInit(html) {
  const marker = 'recaptcha.anchor.Main.init';
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const paren = html.indexOf('(', start);
  if (paren < 0) return null;
  let i = paren + 1;
  while (i < html.length && /\s/.test(html[i])) i++;
  if (html[i] === '"' || html[i] === "'") {
    const raw = readQuoted(html, i + 1, html[i]);
    if (raw == null) return null;
    try { return JSON.parse(decodeJsEscapes(raw)); } catch (_) { return null; }
  }
  if (html[i] === '[') {
    const end = findMatchingBracket(html, i);
    if (end > i) { try { return JSON.parse(decodeJsEscapes(html.slice(i, end + 1))); } catch (_) { return null; } }
  }
  return null;
}

// ---------- extractConfig (port de anchor/config.go) ----------
function extractConfig(init) {
  if (!Array.isArray(init)) return null;
  const cfg = { configBytecode: '', vmKeys: [[176, 170, 107], [76]] };
  let conf = null;
  for (const item of init) if (Array.isArray(item) && item[0] === 'conf') conf = item;
  if (conf) for (let i = conf.length - 1; i >= 0; i--) {
    if (typeof conf[i] === 'string' && conf[i].length > 100 && !cfg.configBytecode) cfg.configBytecode = conf[i];
  }
  const collectorSet = new Set();
  if (conf && conf.length > 7 && Array.isArray(conf[7])) for (const n of conf[7]) collectorSet.add(String(n | 0));
  const keys = [];
  for (const sub of init) {
    if (!Array.isArray(sub)) continue;
    if (conf && sub[0] === 'conf') continue;
    if (sub.length < 1 || sub.length > 8) continue;
    let valid = true; const key = [];
    for (const x of sub) { const n = typeof x === 'number' ? x : -1; if (n < 0 || n > 255) { valid = false; break; } key.push(n | 0); }
    if (!valid) continue;
    const sig = key.join(',');
    if (sig === '3,1,1' || collectorSet.has(sig)) continue;
    keys.push(key);
  }
  if (keys.length) cfg.vmKeys = keys;
  const bg = findBgdata(init);
  if (bg && bg.length > cfg.configBytecode.length) cfg.configBytecode = bg;
  return cfg;
}
function findBgdata(init) {
  for (const sub of init) {
    if (!Array.isArray(sub) || sub.length < 5) continue;
    if (sub[0] !== 'bgdata') continue;
    if (typeof sub[4] === 'string' && sub[4].length > 100) return sub[4];
  }
  return '';
}

// ---------- DecodeCustom + xorFold + xorDecrypt (port de bytecode/decode.go) ----------
function b64val(c) {
  if (c >= 65 && c <= 90) return c - 65;        // A-Z
  if (c >= 97 && c <= 122) return c - 97 + 26;  // a-z
  if (c >= 48 && c <= 57) return c - 48 + 52;   // 0-9
  if (c === 43 || c === 45) return 62;          // + -
  if (c === 47 || c === 95) return 63;          // / _
  if (c === 61 || c === 46) return 64;          // = .  (padding)
  return -1;
}
function decodeCustom(encoded, lowBitsShift) {
  const PAD = 64;
  const valid = [];
  for (let i = 0; i < encoded.length; i++) { const c = encoded.charCodeAt(i); if (b64val(c) >= 0) valid.push(c); }
  const out = [];
  let idx = 0;
  const readNext = (fb) => (idx < valid.length ? b64val(valid[idx++]) : fb);
  for (;;) {
    const s0 = readNext(0xff), s1 = readNext(0), s2 = readNext(PAD), s3 = readNext(PAD);
    if (s3 === PAD && s0 === 0xff) break;
    out.push(((s0 << 2) | (s1 >> 4)) & 0xff);
    if (s2 !== PAD) {
      out.push((((s1 << 4) & 0xf0) | (s2 >> 2)) & 0xff);
      if (s3 !== PAD) out.push((((s2 << lowBitsShift) & 0xc0) | s3) & 0xff);
    }
  }
  return Buffer.from(out);
}
function xorFold(k1, k2) { let a = 0; for (const b of k1) a ^= b & 0xff; for (const b of k2) a ^= b & 0xff; return a & 0xff; }

// xor_decrypt (port EXACT de recaptcha-vm bin/bytecode/main.rs) :
// interprète les octets comme une string UTF-8, itère sur les CODEPOINTS, XOR avec le keystream LCG.
// LCG : state=(4391*state+277)%32779 ; ks = state%255.
function xorDecrypt(bytes, seed) {
  const cps = [...bytes.toString('utf8')];   // itération par codepoint UTF-8
  let state = Math.abs(seed);
  const out = Buffer.alloc(cps.length);
  for (let i = 0; i < cps.length; i++) {
    state = (4391 * state + 277) % 32779;
    out[i] = (cps[i].codePointAt(0) ^ (state % 255)) & 0xff;
  }
  return out;
}
// fraction d'octets valides base64 custom (100% => déchiffrement correct)
function b64CleanPct(buf) {
  let ok = 0; for (let i = 0; i < buf.length; i++) if (b64val(buf[i]) >= 0) ok++;
  return buf.length ? ok / buf.length : 0;
}
// Pipeline config (bin/bytecode/main.rs) : STANDARD base64 → xor_decrypt(UTF-8) → CUSTOM base64.
function decryptConfig(raw, vmKeys) {
  if (vmKeys.length < 2) return null;
  const pairs = [[vmKeys[0], vmKeys[1]]];
  for (let i = 0; i < vmKeys.length; i++) for (let j = i + 1; j < vmKeys.length; j++) pairs.push([vmKeys[i], vmKeys[j]]);
  let best = null, bestScore = -1;
  const step1 = Buffer.from(raw, 'base64');   // STANDARD base64
  for (const [a, b] of pairs) {
    const seed = xorFold(a, b);
    const step2 = xorDecrypt(step1, seed);
    const score = b64CleanPct(step2);          // le bon seed → step2 = base64 pur (score ≈ 1)
    if (score > bestScore) { bestScore = score; best = { seed, step2 }; }
  }
  const bytecode = decodeCustom(best.step2.toString('latin1'), 6);   // CUSTOM base64
  bytecode.__seed = best.seed; bytecode.__clean = bestScore;
  return bytecode;
}

// ---------- aperçu désassemblage (APPROXIMATIF) ----------
// NB: après argsCount+opcode, les opérandes sont encodés en PROTOBUF (ex. LOAD_CONST = {champ2:registre,
// champ4:valeur}). Ce preview lit les args en varints bruts → labels opcodes fiables, args approximatifs.
// Le vrai désassembleur (étape suivante) décodera les opérandes protobuf par opcode.
const OPCODES = { 1: 'LOAD_CONST', 2: 'CONCAT', 3: 'XOR', 4: 'CALL_METHOD', 5: 'GET_PROP', 6: 'SET_PROP', 7: 'SEND', 8: 'MOV', 9: 'NULL', 10: 'ADD', 11: 'SUB', 12: 'MUL', 13: 'DIV', 15: 'MOD', 16: 'SET_WIN', 17: 'GET_WIN', 18: 'CALL_WIN', 19: 'JE', 20: 'HASH', 21: 'STR2BYTES', 22: 'REGEXP', 23: 'AND', 24: 'OR', 25: 'NOT', 27: 'SER2STR', 28: 'TRUNC', 30: 'NEW_FN', 31: 'JLT', 32: 'DISPOSER', 34: 'BIND_APPLY', 35: 'LOR', 36: 'STR_DEC', 38: 'CALL_APPLY', 39: 'PERF_NOW', 40: 'LOAD_IMM', 41: 'TYPEOF' };
function disasmPreview(buf, n) {
  let i = 0;
  const rv = () => { let v = 0, s = 0; for (;;) { const x = buf[i++]; if (x === undefined) return v; v |= (x & 127) << s; s += 7; if (!(x & 128)) break; } return v; };
  const out = [];
  for (let k = 0; k < n && i < buf.length; k++) {
    const argc = buf[i++]; const op = rv(); const args = [];
    for (let a = 0; a < argc && i < buf.length; a++) args.push(rv());
    out.push((OPCODES[op] || ('op' + op)) + (args.length ? '(' + args.slice(0, 3).join(',') + (args.length > 3 ? ',…' : '') + ')' : ''));
  }
  return out.join('  ');
}

// ---------- main ----------
async function main() {
  const siteKey = process.argv[2] || DEFAULT_SITEKEY;
  const origin = process.argv[3] || DEFAULT_ORIGIN;
  console.log('→ fetch anchor…', siteKey.slice(0, 12) + '…', origin);
  const { html, version, status } = await fetchAnchorHTML(siteKey, origin);
  console.log(`  anchor HTTP ${status}, ${html.length} octets, version ${version}`);
  require('fs').writeFileSync('vm/anchor.html', html);

  const init = extractMainInit(html);
  if (!init) { console.error('✖ Main.init introuvable dans le HTML anchor'); process.exit(2); }
  console.log(`  Main.init parsé : tableau de ${init.length} éléments`);

  const cfg = extractConfig(init);
  console.log(`  config bytecode : ${cfg.configBytecode.length} chars (b64 custom)`);
  console.log(`  VmBytecodeKeys  : ${JSON.stringify(cfg.vmKeys)}`);
  if (!cfg.configBytecode) { console.error('✖ config bytecode vide'); process.exit(3); }

  const decrypted = decryptConfig(cfg.configBytecode, cfg.vmKeys);
  console.log(`\n✔ CONFIG BYTECODE DÉCHIFFRÉ : ${decrypted.length} octets  (seed=${decrypted.__seed}, intermédiaire base64-clean=${(decrypted.__clean * 100).toFixed(1)}%)`);
  // entropie (validation : bytecode structuré < 7.5 ; encore chiffré ≈ 8.0)
  const h = new Array(256).fill(0); for (const x of decrypted) h[x]++;
  let H = 0; for (const c of h) if (c) { const p = c / decrypted.length; H -= p * Math.log2(p); }
  console.log(`  entropie: ${H.toFixed(2)} bits/octet ${H < 7.5 ? '✔ structuré' : '⚠ encore chiffré'}`);
  console.log('  premiers 32 octets (hex):', decrypted.slice(0, 32).toString('hex'));
  // aperçu désassemblage : la VM lit argsCount(byte) + opcode(varint) ; on liste les 1ers opcodes.
  console.log('  aperçu opcodes:', disasmPreview(decrypted, 14));
  require('fs').writeFileSync('vm/config_bytecode.bin', Buffer.from(decrypted));
  require('fs').writeFileSync('vm/last_anchor_init.json', JSON.stringify(init, null, 0));
  console.log('\n  → vm/config_bytecode.bin (' + decrypted.length + ' o) + vm/last_anchor_init.json');
}

main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
