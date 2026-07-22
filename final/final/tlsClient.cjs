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

// ── PROFIL TLS CUSTOM CHROME 150 (reversé via tls.peet.ws) ─────────────────────────────
// node-tls-client ne fournit pas de profil chrome_150 (max built-in = chrome_131, qui envoie
// l'ANCIEN codepoint ALPS 17513 = tell "UA Chrome 150 mais TLS 131"). Ce profil custom reproduit
// le vrai ClientHello Chrome 150 : ALPS NOUVEAU (17613), key share post-quantique X25519MLKEM768
// (4588), ciphers/sig-algs/ALPN/H2 identiques au genuine. Fingerprint HTTP/2 Akamai IDENTIQUE.
// Limite lib : compress_certificate (ext 27) injouable en customTlsClient (schéma DLL désaligné) →
// omis (ja4 1515 vs 1516). GREASE explicite = 2570 ; randomTlsExtensionOrder = shuffle Chrome.
const CHROME150_PROFILE = {
  ja3string: '771,2570-4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,2570-17613-11-10-0-65037-43-51-35-23-16-45-13-5-18-65281-2570,2570-4588-29-23-24,0',
  h2Settings: { HEADER_TABLE_SIZE: 65536, ENABLE_PUSH: 0, INITIAL_WINDOW_SIZE: 6291456, MAX_HEADER_LIST_SIZE: 262144 },
  h2SettingsOrder: ['HEADER_TABLE_SIZE', 'ENABLE_PUSH', 'INITIAL_WINDOW_SIZE', 'MAX_HEADER_LIST_SIZE'],
  supportedSignatureAlgorithms: ['ECDSAWithP256AndSHA256', 'PSSWithSHA256', 'PKCS1WithSHA256', 'ECDSAWithP384AndSHA384', 'PSSWithSHA384', 'PKCS1WithSHA384', 'PSSWithSHA512', 'PKCS1WithSHA512'],
  alpnProtocols: ['h2', 'http/1.1'],
  alpsProtocols: ['h2'],
  supportedVersions: ['GREASE', '1.3', '1.2'],
  keyShareCurves: ['GREASE', 'X25519MLKEM768', 'X25519'],
  pseudoHeaderOrder: [':method', ':authority', ':scheme', ':path'],
  connectionFlow: 15663105,
  randomTlsExtensionOrder: true,
};

let _initP = null;
let _session = null;
let _cfg = { proxy: undefined, clientIdentifier: 'chrome_150' };

function setProxy(proxy) { _cfg.proxy = proxy || undefined; return _cfg.proxy; }

// Construit les options de Session : profil CUSTOM Chrome 150 par défaut (clientIdentifier vide/'chrome_150'/'custom'),
// sinon un identifiant built-in explicite (ex 'chrome_131' pour un test/fallback).
function buildSessionOpts(clientIdentifier) {
  const useCustom = !clientIdentifier || clientIdentifier === 'chrome_150' || clientIdentifier === 'custom';
  if (useCustom) return { ...CHROME150_PROFILE, timeout: 30000, insecureSkipVerify: false };
  return { clientIdentifier, timeout: 30000, insecureSkipVerify: false };
}

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
    _session = new tlsc.Session(buildSessionOpts(_cfg.clientIdentifier));
  }
  return _session;
}

/**
 * tlsFetch(url, {method, headers, body, followRedirects, cookies}) → {ok, status, headers, text(), buffer()}
 * cookies : { name: value } mergés dans le jar de session (permet de forcer un _GRECAPTCHA vieilli).
 */
async function tlsFetch(url, { method = 'GET', headers = {}, body, followRedirects = true, cookies, headerOrder } = {}) {
  const s = await ensureSession(_cfg.proxy, _cfg.clientIdentifier);
  const m = String(method).toLowerCase();
  const opts = { proxy: _cfg.proxy, headers, followRedirects };
  if (headerOrder && headerOrder.length) opts.headerOrder = headerOrder; // ordre des en-têtes = fingerprint Chrome
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
