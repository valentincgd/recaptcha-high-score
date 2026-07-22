'use strict';
/**
 * tlsClient.js — client HTTP à empreinte TLS/HTTP2 de Chrome 150 (JA3/JA4 authentiques), via
 * node-tls-client (lib Go d'impersonation). Node natif ne peut pas produire le ClientHello de Chrome ;
 * Google/Ticketmaster détectent le TLS Node → indispensable pour passer.
 *
 * Version CLEAN autonome : uniquement ensureSession / tlsFetch / setProxy (pas de MITM/startBridge,
 * pas de selfsigned). Aucune dépendance au reste du projet.
 */
const tlsc = require('node-tls-client');

// Patch : le body /reload est du protobuf BINAIRE (octets >127). node-tls-client l'enverrait en string
// UTF-8 → corruption → token null. On force isByteRequest=true : le body passe en base64 et la lib Go
// le décode byte-exact, sans changer le content-type (reste application/x-protobuffer).
try { require('node-tls-client/dist/utils/request').isByteRequest = () => true; }
catch (_) { try { require('node-tls-client/dist/utils').isByteRequest = () => true; } catch (_) {} }

let _initP = null;
let _session = null;
let _cfg = { proxy: undefined, clientIdentifier: 'chrome_150' };

function setProxy(proxy) { _cfg.proxy = proxy || undefined; return _cfg.proxy; }

async function ensureSession(proxy, clientIdentifier) {
  if (!_initP) _initP = tlsc.initTLS();
  await _initP;
  if (proxy !== undefined) _cfg.proxy = proxy;
  // Changement d'identifiant TLS (profil différent) → on recrée la session pour que le JA3
  // corresponde bien à la nouvelle empreinte (sinon le singleton garderait l'ancienne).
  if (clientIdentifier && clientIdentifier !== _cfg.clientIdentifier) {
    _cfg.clientIdentifier = clientIdentifier;
    if (_session) { try { await _session.close(); } catch (_) {} _session = null; }
  }
  if (!_session) {
    _session = new tlsc.Session({
      clientIdentifier: _cfg.clientIdentifier,
      timeout: 30000,
      insecureSkipVerify: false, // on VALIDE le vrai cert de Google
    });
  }
  return _session;
}

/**
 * tlsFetch(url, {method, headers, body, followRedirects, cookies}) → {ok, status, headers, text(), buffer()}
 * cookies : { name: value } mergés dans le jar de session (permet de forcer un _GRECAPTCHA vieilli).
 */
async function tlsFetch(url, { method = 'GET', headers = {}, body, followRedirects = true, cookies } = {}) {
  const s = await ensureSession(_cfg.proxy, _cfg.clientIdentifier);
  const m = String(method).toLowerCase();
  const opts = { proxy: _cfg.proxy, headers, followRedirects };
  if (cookies && Object.keys(cookies).length) opts.cookies = cookies;
  if (body != null) opts.body = (Buffer.isBuffer(body) ? body : Buffer.from(String(body))).toString('base64');
  // Retry sur échec TRANSPORT uniquement (status 0 = pas de réponse reçue : timeout/reset de session
  // froide à travers un proxy résidentiel lent). Sûr même pour POST /reload : aucune requête n'a abouti.
  let r;
  for (let attempt = 0; attempt < 3; attempt++) {
    r = await s[m](url, opts);
    if (r.status !== 0) break;
  }
  const raw = await r.text(); // gzip/br gérés par la lib Go
  return {
    ok: r.status >= 200 && r.status < 300,
    status: r.status,
    headers: r.headers || {},
    text: () => raw,
    json: () => JSON.parse(raw),
    buffer: () => Buffer.from(raw, 'utf8'),
  };
}

async function close() { try { if (_session && _session.close) await _session.close(); } catch (_) {} }

module.exports = { tlsFetch, ensureSession, setProxy, close };
