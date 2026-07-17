'use strict';
/**
 * tls_bridge.js — force TOUTES les requêtes (jsdom + nos fetch Node) à sortir avec
 * l'empreinte TLS + HTTP/2 de Chrome, via le proxy résidentiel.
 *
 * Node ne peut pas produire le ClientHello de Chrome (JA3/JA4). On délègue donc à
 * `node-tls-client` (lib Go d'impersonation, profil chrome_150 — le vrai TLS de Chrome 150).
 *
 *   jsdom ──(proxy local)──►  MITM local (TLS terminé, cert jetable, jsdom ne valide pas)
 *                              └─► node-tls-client (chrome_150) ─► proxy résidentiel ─► Google
 *
 * Chrome 150 : JA4 t13d1517h2_8daaf6152771_dcad5a053991 (17 ext, key_share post-quantique
 * X25519MLKEM768) — distinct de chrome_131 (16 ext). La DLL tls-client v1.15.1 le supporte.
 */
const net = require('net');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const selfsigned = require('selfsigned');
const tlsc = require('node-tls-client');

// Patch : forcer isByteRequest=true. Le body /reload est du protobuf BINAIRE (octets >127) ;
// sans ce patch, node-tls-client l'envoie en string UTF-8 → corruption → Google renvoie un
// token null. Avec le patch, on passe le body en base64 et la lib Go le décode byte-exact,
// SANS changer le content-type (reste application/x-protobuffer, ce que Google attend).
try { require('node-tls-client/dist/utils/request').isByteRequest = () => true; }
catch (_) { try { require('node-tls-client/dist/utils').isByteRequest = () => true; } catch (_) {} }

let _initP = null;
let _session = null;
let _cfg = { proxy: undefined, clientIdentifier: 'chrome_131' };
let _identity = null;   // { major, platform, userAgent, secChUa, secChUaPlatform } — pour enrichir les headers
let _acceptLang = 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7';

/**
 * chromeHeadersFor — complète une requête Google avec les headers qu'un VRAI Chrome envoie
 * (client hints sec-ch-ua + sec-fetch selon le type + accept-language cohérent avec l'IP).
 * N'écrase pas ce qui existe déjà (referer/origin posés par jsdom).
 */
function chromeHeadersFor(host, urlPath, existing) {
  if (!/(^|\.)(google|gstatic|recaptcha)\.(com|net)/.test(host) && !/google\.com/.test(host)) return {};
  const id = _identity || {};
  const has = (k) => Object.keys(existing).some(x => x.toLowerCase() === k);
  const add = {};
  const put = (k, v) => { if (!has(k) && v != null) add[k] = v; };
  const isAnchor = /\/(enterprise|api2)\/anchor/.test(urlPath);
  const isReload = /\/(enterprise|api2)\/reload/.test(urlPath);
  const isScript = /\.js(\?|$)/.test(urlPath);
  put('sec-ch-ua', id.secChUa);
  put('sec-ch-ua-mobile', '?0');
  put('sec-ch-ua-platform', id.secChUaPlatform);
  put('accept-language', _acceptLang);
  put('sec-fetch-storage-access', 'none');
  // x-browser-* (intégrité Chrome) — un vrai Chrome les envoie sur les requêtes Google
  if (id.xBrowser) for (const [k, v] of Object.entries(id.xBrowser)) put(k, v);
  if (isReload) {
    put('sec-fetch-site', 'same-origin'); put('sec-fetch-mode', 'cors'); put('sec-fetch-dest', 'empty');
    put('origin', 'https://www.google.com'); put('priority', 'u=1, i');
  } else if (isAnchor) {
    put('sec-fetch-site', 'cross-site'); put('sec-fetch-mode', 'navigate'); put('sec-fetch-dest', 'iframe');
    put('upgrade-insecure-requests', '1'); put('priority', 'u=0, i');
  } else if (isScript) {
    put('sec-fetch-site', 'cross-site'); put('sec-fetch-mode', 'no-cors'); put('sec-fetch-dest', 'script');
  }
  return add;
}

async function ensureSession(proxy, clientIdentifier) {
  if (!_initP) _initP = tlsc.initTLS();
  await _initP;
  if (proxy !== undefined) _cfg.proxy = proxy;
  if (clientIdentifier) _cfg.clientIdentifier = clientIdentifier;
  if (!_session) {
    _session = new tlsc.Session({
      clientIdentifier: _cfg.clientIdentifier,
      timeout: 30000,
      insecureSkipVerify: false, // on VALIDE le vrai cert de Google (côté client TLS)
    });
  }
  return _session;
}

/**
 * tlsFetch — fetch Chrome-TLS direct (pour NOS propres requêtes : loader, worker, ipify).
 * Retourne { status, headers, text(), buffer() }.
 */
async function tlsFetch(url, { method = 'GET', headers = {}, body, followRedirects = true } = {}) {
  const s = await ensureSession(_cfg.proxy, _cfg.clientIdentifier);
  const m = String(method).toLowerCase();
  const opts = { proxy: _cfg.proxy, headers, followRedirects };
  // isByteRequest patché → body attendu en base64 (byte-exact côté Go)
  if (body != null) opts.body = (Buffer.isBuffer(body) ? body : Buffer.from(String(body))).toString('base64');
  const r = await s[m](url, opts);
  const raw = await r.text(); // .text() → contenu décodé (gzip/br gérés par la lib Go)
  return {
    ok: r.status >= 200 && r.status < 300,
    status: r.status,
    headers: r.headers || {},
    text: () => raw,
    json: () => JSON.parse(raw),
    buffer: () => Buffer.from(raw, 'utf8'),
  };
}

// Headers à ne pas relayer (hop-by-hop / gérés par le client TLS)
const DROP_REQ = new Set(['proxy-connection', 'connection', 'host', 'content-length', 'transfer-encoding', 'accept-encoding', 'keep-alive', 'upgrade']);
const DROP_RES = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive']);

function pickReqHeaders(h) {
  const out = {};
  for (const k of Object.keys(h)) if (!DROP_REQ.has(k.toLowerCase())) out[k] = h[k];
  return out;
}
function pickResHeaders(h) {
  const out = {};
  for (const k of Object.keys(h || {})) if (!DROP_RES.has(k.toLowerCase())) out[k] = h[k];
  return out;
}

async function forward(req, res, scheme, log) {
  const host = req.headers.host;
  const target = `${scheme}://${host}${req.url}`;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  // Contrôle d'intégrité (RC_VERIFY_BODY) : hash des octets du /reload SORTANTS du pont, à comparer
  // avec le hash de la copie capturée à l'XHR (field16_jsdom onReload) → prouve byte-exact ou non.
  if (process.env.RC_VERIFY_BODY === '1' && body.length && /\/(api2|enterprise)\/reload/.test(req.url)) {
    const h = crypto.createHash('sha256').update(body).digest('hex').slice(0, 16);
    if (log) log('bridge-body', `/reload SORTANT: ${body.length} octets sha256=${h}`);
  }
  try {
    const s = await ensureSession(_cfg.proxy, _cfg.clientIdentifier);
    const m = String(req.method || 'GET').toLowerCase();
    const relayed = pickReqHeaders(req.headers);
    Object.assign(relayed, chromeHeadersFor(host, req.url, relayed)); // complète en headers Chrome réalistes
    const opts = { proxy: _cfg.proxy, headers: relayed, followRedirects: false };
    if (body.length) opts.body = body.toString('base64'); // isByteRequest patché → base64 = byte-exact (protobuf /reload)
    const r = await s[m](target, opts);
    const buf = Buffer.from(await r.text(), 'utf8');
    // DEBUG cookies (RC_DEBUG_COOKIES=1) : trace le _GRECAPTCHA sur les /reload pour prouver le chaînage
    if (process.env.RC_DEBUG_COOKIES === '1' && /\/(api2|enterprise)\/reload/.test(req.url)) {
      const jarCk = (typeof s.cookies === 'function') ? await s.cookies().catch(() => null) : null;
      const grec = jarCk && JSON.stringify(jarCk).match(/_GRECAPTCHA[^,"]{0,40}/);
      const inCk = relayed.cookie || relayed.Cookie || '(aucun header Cookie de jsdom)';
      const setCk = (r.headers && (r.headers['set-cookie'] || r.headers['Set-Cookie'])) || '(pas de Set-Cookie)';
      const emit = (t, m) => console.error('[' + t + '] ' + m);
      emit('ck-in ', 'jsdom→ ' + String(inCk).slice(0, 120));
      emit('ck-jar', 'node-tls jar _GRECAPTCHA: ' + (grec ? grec[0] : 'ABSENT'));
      emit('ck-out', 'Google Set-Cookie: ' + String(Array.isArray(setCk) ? setCk.join(' | ') : setCk).slice(0, 160));
    }
    res.writeHead(r.status || 200, pickResHeaders(r.headers));
    res.end(buf);
  } catch (e) {
    if (log) log('tls-bridge-err', `${target} :: ${e.message}`);
    try { res.writeHead(502); res.end(); } catch (_) {}
  }
}

/**
 * startBridge — démarre le proxy local MITM. Retourne { url, port, close }.
 * Pointer jsdom dessus : ResourceLoader({ proxy: url, strictSSL:false }).
 */
async function startBridge({ proxy, clientIdentifier = 'chrome_150', identity = null, acceptLanguage, log = () => {} } = {}) {
  await ensureSession(proxy, clientIdentifier);
  if (identity) _identity = identity;
  if (acceptLanguage) _acceptLang = acceptLanguage;

  // jsdom fait un handshake TLS vers NOTRE MITM (cert jetable, CN=recaptcha-bridge sur localhost).
  // On désactive la validation TLS de Node pour ce hop — c'est du 127.0.0.1, aucune donnée réelle
  // n'y transite en clair vers l'extérieur. Le VRAI cert de Google est validé par node-tls-client
  // (couche Go, insecureSkipVerify:false), qui n'est PAS affecté par ce flag Node.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const origWarn = process.emitWarning;
  process.emitWarning = function (w, ...a) {
    if (String(w).includes('NODE_TLS_REJECT_UNAUTHORIZED')) return;
    return origWarn.call(process, w, ...a);
  };

  const pems = await selfsigned.generate([{ name: 'commonName', value: 'recaptcha-bridge' }], {
    days: 3650, keySize: 2048, algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }] }],
  });
  const httpsServer = https.createServer({ key: pems.private, cert: pems.cert }, (req, res) => forward(req, res, 'https', log));
  httpsServer.on('clientError', () => {});
  await new Promise(r => httpsServer.listen(0, '127.0.0.1', r));

  const proxyServer = http.createServer((req, res) => forward(req, res, 'http', log));
  // CONNECT (HTTPS) : on injecte le socket tunnelé dans le serveur https → il termine le TLS
  // avec notre cert jetable (jsdom, strictSSL:false, ne valide pas) puis parse le HTTP.
  proxyServer.on('connect', (req, clientSocket, head) => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\nProxy-agent: recaptcha-bridge\r\n\r\n');
    if (head && head.length) clientSocket.unshift(head);
    clientSocket.on('error', () => {});
    httpsServer.emit('connection', clientSocket);
  });
  proxyServer.on('clientError', () => {});
  await new Promise(r => proxyServer.listen(0, '127.0.0.1', r));

  const port = proxyServer.address().port;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    async close() {
      try { proxyServer.close(); } catch (_) {}
      try { httpsServer.close(); } catch (_) {}
      try { if (_session) await _session.close(); } catch (_) {}
      try { await tlsc.destroyTLS(); } catch (_) {}
      _session = null; _initP = null;
    },
  };
}

module.exports = { startBridge, tlsFetch, ensureSession };
