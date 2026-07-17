'use strict';
/**
 * tools/replay_reload.js — REJOUE un body /reload capturé (ex. depuis un vrai navigateur) via
 * node-tls-client (TLS/H2 Chrome 150), extrait le token (rresp), et optionnellement vérifie le
 * score sur antcpt. Sert à prouver que notre transport est byte-parfait : si TON body 0.7 rejoué
 * ressort 0.7, le pipeline est clean et seule la source du fingerprint compte.
 *
 * ⚠️ RECHERCHE / ÉDUCATIF. Un body a une durée de vie ~2 min (champ 2 = anchor, champ 7 = session)
 * → à rejouer FRAIS.
 *
 * Entrées (au choix) :
 *   --fields <file.json>   JSON { "1":"ver", "2":"anchor", "16":"...", "28":20000, ... } (champs décodés)
 *   --b64 <file>           fichier contenant le body brut en base64
 *   --hex <file>           fichier contenant le body brut en hex
 * Options :
 *   --url <reloadUrl>      URL /reload complète (sinon construite depuis --sitekey + --version)
 *   --sitekey <k>          (si pas d'--url) ; --version <v> ; --seg api2|enterprise (défaut api2)
 *   --referer <anchorUrl>  Referer (anchor) ; --origin (défaut https://www.google.com)
 *   --verify-antcpt        POST le token sur antcpt.com/score_detector/verify.php → score
 *   --proxy <url>          proxy résidentiel
 *
 * Ex : node tools/replay_reload.js --fields body.json --sitekey 6LcR_ok... --version TnA7... --verify-antcpt
 */
const fs = require('fs');
const tlsc = require('node-tls-client');

// isByteRequest patché → body en base64 = byte-exact (cf. tls_bridge.js)
try { require('node-tls-client/dist/utils/request').isByteRequest = () => true; }
catch (_) { try { require('node-tls-client/dist/utils').isByteRequest = () => true; } catch (_) {} }

function arg(name, def) { const i = process.argv.indexOf('--' + name); return i >= 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : def; }
const has = (name) => process.argv.includes('--' + name);

// ---- encodeur protobuf minimal (pour reconstruire le body depuis les champs décodés) ----
function varint(n) { const b = []; n = Number(n); while (n > 127) { b.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); } b.push(n & 0x7f); return Buffer.from(b); }
function tag(field, wire) { return varint((field << 3) | wire); }
function encodeField(num, val) {
  if (typeof val === 'number' || /^\d+$/.test(String(val)) && Number(val) <= 0xffffffff && !/^0\d/.test(String(val))) {
    // heuristique : entiers "petits" → varint (champs 28/29). Le reste = string.
    if (num === 28 || num === 29) return Buffer.concat([tag(num, 0), varint(Number(val))]);
  }
  const s = Buffer.from(String(val), 'utf8');
  return Buffer.concat([tag(num, 2), varint(s.length), s]);
}
function encodeFromFields(fields) {
  const parts = [];
  for (const k of Object.keys(fields).map(Number).sort((a, b) => a - b)) {
    let v = fields[String(k)];
    if (Array.isArray(v)) v = v[0];        // accepte le format summarize {"8":["homepage"]}
    if (v == null) continue;
    parts.push(encodeField(k, v));
  }
  return Buffer.concat(parts);
}

function loadBody() {
  const f = arg('fields'), b64 = arg('b64'), hex = arg('hex');
  if (f) return encodeFromFields(JSON.parse(fs.readFileSync(f, 'utf8')));
  if (b64) return Buffer.from(fs.readFileSync(b64, 'utf8').trim(), 'base64');
  if (hex) return Buffer.from(fs.readFileSync(hex, 'utf8').replace(/\s+/g, ''), 'hex');
  console.error('✖ Fournis --fields <json> | --b64 <file> | --hex <file>'); process.exit(2);
}

function parseRresp(text) {
  const t = text.replace(/^\)\]\}'\s*/, '');
  try { const arr = JSON.parse(t); if (Array.isArray(arr) && arr[0] === 'rresp') return arr[1]; } catch (_) {}
  const m = text.match(/"rresp","([^"]+)"/); return m ? m[1] : null;
}

async function main() {
  const body = loadBody();
  const sitekey = arg('sitekey');
  const version = arg('version');
  const seg = arg('seg', 'api2');
  const proxy = arg('proxy') || process.env.RC_PROXY;
  let url = arg('url');
  if (!url) {
    if (!sitekey) { console.error('✖ --url ou --sitekey requis'); process.exit(2); }
    url = `https://www.google.com/recaptcha/${seg}/reload?k=${sitekey}`;
  }
  const referer = arg('referer') || (sitekey ? `https://www.google.com/recaptcha/${seg}/anchor?ar=1&k=${sitekey}&hl=fr${version ? '&v=' + version : ''}&size=invisible` : undefined);
  const origin = arg('origin', 'https://www.google.com');

  console.log(`→ replay /reload (${body.length} octets protobuf) via TLS Chrome 150`);
  console.log(`  url: ${url}`);

  await tlsc.initTLS();
  const s = new tlsc.Session({ clientIdentifier: 'chrome_150', timeout: 30000 });
  try {
    const headers = {
      'accept': '*/*', 'accept-language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
      'content-type': 'application/x-protobuffer', 'origin': origin, 'priority': 'u=1, i',
      'sec-ch-ua': '"Not;A=Brand";v="8", "Chromium";v="150", "Google Chrome";v="150"',
      'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-origin',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
    };
    if (referer) headers['referer'] = referer;
    const r = await s.post(url, { proxy, headers, body: body.toString('base64'), followRedirects: false });
    const text = await r.text();
    console.log(`← HTTP ${r.status} (${text.length}B)`);
    const token = parseRresp(text);
    if (!token) { console.log('✖ pas de rresp dans la réponse :\n' + text.slice(0, 300)); process.exit(3); }
    console.log(`✔ token (${token.length}) : ${token.slice(0, 48)}…`);

    if (has('verify-antcpt')) {
      const vr = await fetch('https://antcpt.com/score_detector/verify.php', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'origin': 'https://antcpt.com', 'referer': 'https://antcpt.com/score_detector/', 'x-requested-with': 'XMLHttpRequest' },
        body: JSON.stringify({ 'g-recaptcha-response': token }),
      });
      const vj = await vr.json().catch(() => null);
      console.log('\n════════════════════════════════');
      console.log('  SCORE (replay) : ' + (vj ? vj.score : '?') + '   ' + JSON.stringify(vj));
      console.log('════════════════════════════════');
    }
  } finally {
    try { await s.close(); } catch (_) {}
    try { await tlsc.destroyTLS(); } catch (_) {}
  }
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
