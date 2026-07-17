/**
 * build_reload.js — Construit une requête reCAPTCHA Enterprise /reload à partir de l'anchor.
 *
 * ⚠️ USAGE ÉDUCATIF / RECHERCHE UNIQUEMENT (cf. disclaimer des repos elyelysiox/recaptcha*).
 *
 * Ce script assemble TOUT ce que les repos permettent réellement de générer :
 *   ✅ URL /anchor (co, cb, params)          — dérivables
 *   ✅ X-Browser-Validation                   — SHA-1(apiKey + UA) base64  (clé à fournir)
 *   ✅ Champ 5 : djb2(fingerprint sérialisé)  — hashFingerprint.js
 *   ✅ Sérialisation protobuf (bons champs)   — structure documentée
 *   ✅ Headers HTTP
 *
 * Et il ISOLE clairement les 3 primitives manquantes (README = exemples seulement) :
 *   ❌ deriveSignalCode()      — à reverse
 *   ❌ deriveKey()             — à reverse
 *   ❌ encryptFingerprint()    — chiffrement du champ 16 avec la clé anchor idx18
 *
 * Node >= 18.  Lancer : node build_reload.js
 */

'use strict';
const crypto = require('crypto');

/* ============================================================================
 * 1. PRIMITIVES CONNUES (présentes dans les repos)
 * ==========================================================================*/

// --- djb2 32-bit signé (recaptcha/hashFingerprint.js) --------------------
function toSigned32bit(n) {
  n = n >>> 0;
  if (n >= 0x80000000) n -= 0x100000000;
  return n;
}
function djb2(data, numAt = 0) {
  for (let i = 0; i < data.length; i++) {
    numAt = toSigned32bit(((numAt << 5) - numAt + data.charCodeAt(i)) >>> 0);
  }
  return numAt;
}

// --- Callback ID aléatoire (recaptcha/generateCallBack.js) ---------------
function generateCallBack() {
  const r1 = Math.floor(Math.random() * 2147483648);
  const t = Math.floor(Date.now() / 1000);
  const r2 = Math.floor(Math.random() * 2147483648);
  return r1.toString(36) + (t ^ r2).toString(36);
}

// --- co = base64url(origin:port) avec padding "." ------------------------
function encodeCo(origin) {
  return Buffer.from(origin, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '.');
}

// --- X-Browser-Validation = base64( SHA1(apiKey + userAgent) ) -----------
// NB: la clé publiée (v134) ne matche plus Chrome 150 → clé rotée.
//     Il faut EXTRAIRE la constante hardcodée du binaire Chrome cible.
const XBV_KEYS = {
  win:   'AIzaSyA2KlwBX3mkFo30om9LUFYQhpqLoa_BNhE', // ~v134, à réextraire pour v150
  linux: 'AIzaSyBqJZh-7pA44blAaAkH6490hUFOwX0KCYM',
  mac:   'AIzaSyDr2UxVnv_U85AbhhY8XSHSIavUW0DC-sY',
};
function xBrowserValidation(userAgent, apiKey) {
  const data = Buffer.from(apiKey + userAgent, 'utf8');
  return crypto.createHash('sha1').update(data).digest('base64');
}

/* ============================================================================
 * 2. ENCODEUR PROTOBUF MINIMAL (fields observés dans /reload)
 * ==========================================================================*/

function varint(n) {
  const bytes = [];
  let v = n >>> 0;                    // suppose entier >=0
  do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; bytes.push(b); } while (v);
  return Buffer.from(bytes);
}
function tag(field, wire) { return varint((field << 3) | wire); }

function fieldString(field, str) {          // wire type 2
  const b = Buffer.from(str, 'utf8');
  return Buffer.concat([tag(field, 2), varint(b.length), b]);
}
function fieldVarint(field, n) {            // wire type 0
  return Buffer.concat([tag(field, 0), varint(n)]);
}
function fieldMessage(field, msgBuf) {      // wire type 2 (sous-message)
  return Buffer.concat([tag(field, 2), varint(msgBuf.length), msgBuf]);
}

/* ============================================================================
 * 3. PRIMITIVES MANQUANTES (à reverse — README = exemples entrée→sortie)
 * ==========================================================================*/

function deriveSignalCode(/* value */) {
  throw new Error(
    '[MANQUANT] deriveSignalCode(): hash non trivial (seed initial, collisions), non\n' +
    '  récupérable depuis les 25 exemples du README. Testé et écarté: djb2/java/sdbm/fnv/cyrb\n' +
    '  × base36/base62/toString36/alph[h%L]. Nécessite la fonction JS déobfusquée réelle.');
}

// ✅ CRACKÉ : deriveKey = hashCode Java d'une string de 2 chars = 31*c0 + c1 (ASCII).
//    Vérifié 24/24 sur les paires code→key du README.
//    Ex: "wg"→3792, "21"→1599, "p1"→3521, "wq"→3802, "80"→1784.
function deriveKey(code) {
  return 31 * code.charCodeAt(0) + code.charCodeAt(1);
}
function encryptFingerprint(/* serialized, anchorKeyIdx18 */) {
  throw new Error(
    '[MANQUANT] encryptFingerprint(): chiffrement du champ 16 avec la clé anchor idx18.\n' +
    '  Voir recaptcha-vm/src/encryption/mod.rs pour un cipher de la même famille (LCG + seed).');
}

/* ============================================================================
 * 4. CONSTRUCTION DU FINGERPRINT (champ 16)
 * ==========================================================================*/

/**
 * serializeFingerprint(signals) : transforme le tableau de signaux en la string
 * JSON-like exacte que reCAPTCHA hashe (champ 5) puis chiffre (champ 16).
 * `signals` doit déjà être le tableau assemblé Idx 4..78 (voir result.md §4).
 */
function serializeFingerprint(signals) {
  return JSON.stringify(signals);
}

/**
 * buildField16(signals, anchorKeyIdx18)
 *  → renvoie { field16, field5 }
 * Étapes (result.md §4/§5). Les étapes ❌ lèvent tant qu'elles ne sont pas reversées.
 */
function buildField16(signals, anchorKeyIdx18, { allowStub = false, preEncrypted = null } = {}) {
  const serialized = serializeFingerprint(signals);
  const field5 = String(djb2(serialized));           // ✅ champ 5

  let field16;
  if (preEncrypted) {
    // Mode démo : réutiliser un champ 16 déjà capturé (pour tester l'assemblage protobuf).
    field16 = preEncrypted;
  } else if (allowStub) {
    field16 = '0__STUB_ENCRYPTED_FINGERPRINT__'; // placeholder non valide
  } else {
    field16 = encryptFingerprint(serialized, anchorKeyIdx18); // ❌ lève tant que non implémenté
  }
  return { field16, field5, serialized };
}

/* ============================================================================
 * 5. ASSEMBLAGE HAUT NIVEAU
 * ==========================================================================*/

/** Construit l'URL GET /anchor à partir des infos du site. */
function buildAnchorURL({ k, v, origin, hl = 'fr', size = 'invisible',
                          anchorMs = 20000, executeMs = 30000, ar = 1 }) {
  const p = new URLSearchParams({
    ar: String(ar), k, co: encodeCo(origin), hl, v, size,
    'anchor-ms': String(anchorMs), 'execute-ms': String(executeMs),
    cb: generateCallBack(),
  });
  return `https://www.google.com/recaptcha/enterprise/anchor?${p.toString()}`;
}

/**
 * Construit le corps protobuf + les headers de POST /reload.
 * @param anchor  { token(=field2), v(=field1), k(=field14), key(=field16 chiffrage idx18) }
 * @param opts    { action, fingerprintSignals, telemetryB64, browserProtoHashB64,
 *                  eventCountersB64, anchorMs, executeMs, mode, userAgent, xbvApiKey,
 *                  allowStub, preEncryptedField16 }
 */
function buildReloadRequest(anchor, opts) {
  const {
    action = 'submit', fingerprintSignals,
    telemetryB64 = 'W10',            // placeholder (à générer depuis Performance API)
    browserProtoHashB64 = '',        // hashBrowserProtos.js (champ 22)
    eventCountersB64 = 'W10',        // "[]" si aucune interaction (champ 25)
    anchorMs = 20000, executeMs = 30000, mode = 'q',
    userAgent, xbvApiKey = XBV_KEYS.win,
    allowStub = false, preEncryptedField16 = null,
  } = opts;

  const { field16, field5 } = buildField16(
    fingerprintSignals, anchor.key,
    { allowStub, preEncrypted: preEncryptedField16 });

  // ---- Corps protobuf (champs dans l'ordre croissant) --------------------
  const parts = [
    fieldString(1, anchor.v),           // version
    fieldString(2, anchor.token),       // token de validation (réponse /anchor)
    fieldString(5, field5),             // djb2(fingerprint)
    fieldString(6, mode),               // "q" = V3
    // champ 8 : site action. Observé parfois wrappé -> fieldMessage(8, fieldString(8, action))
    fieldString(8, action),
    fieldString(14, anchor.k),          // website key
    fieldString(16, field16),           // fingerprint chiffré
    fieldString(20, telemetryB64),      // télémétrie base64
  ];
  if (browserProtoHashB64) parts.push(fieldString(22, browserProtoHashB64));
  parts.push(fieldString(25, eventCountersB64)); // compteurs d'événements
  parts.push(fieldVarint(28, anchorMs));         // anchor-ms
  parts.push(fieldVarint(29, executeMs));        // execute-ms
  const body = Buffer.concat(parts);

  // ---- Headers -----------------------------------------------------------
  const headers = {
    'Accept': '*/*',
    'Content-Type': 'application/x-protobuffer',
    'Origin': 'https://www.google.com',
    'User-Agent': userAgent,
    'X-Browser-Channel': 'stable',
    'X-Browser-Copyright': 'Copyright 2026 Google LLC. All Rights Reserved.',
    'X-Browser-Validation': xBrowserValidation(userAgent, xbvApiKey),
    'X-Browser-Year': '2026',
    'sec-ch-ua': '"Not;A=Brand";v="8", "Chromium";v="150", "Google Chrome";v="150"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
  };

  const url = `https://www.google.com/recaptcha/enterprise/reload?k=${anchor.k}`;
  return { url, method: 'POST', headers, body, field5, field16 };
}

/* ============================================================================
 * 6. DÉMO
 * ==========================================================================*/
if (require.main === module) {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
             '(KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';

  // (a) URL anchor reconstruite
  const anchorURL = buildAnchorURL({
    k: '6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV',
    v: 'TnA7HacJFoBWt9hnlunBlYfK',
    origin: 'https://www.ticketmaster.com:443',
    hl: 'fr',
  });
  console.log('ANCHOR URL:\n' + anchorURL + '\n');

  // (b) X-Browser-Validation (clé v134 → NE matchera pas Chrome 150 tant que non réextraite)
  console.log('X-Browser-Validation (clé win v134):', xBrowserValidation(UA, XBV_KEYS.win));
  console.log('  ⚠️ clé rotée en v150 — extraire la constante du binaire Chrome cible.\n');

  // (c) Corps /reload en mode STUB (assemblage protobuf réel, champ 16 factice)
  const fakeSignals = [null, null, null, null, '0883', 4]; // <- vrai tableau Idx4..78 attendu
  const req = buildReloadRequest(
    { v: 'TnA7HacJFoBWt9hnlunBlYfK',
      token: '03AFcWeA6...(depuis la réponse /anchor)...',
      k: '6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV',
      key: 1777669303203 /* clé anchor idx18 */ },
    { action: 'Event', fingerprintSignals: fakeSignals, userAgent: UA,
      allowStub: true,
      // preEncryptedField16: '0hzQAwH...'  // ← option : rejouer un champ16 capturé
    });

  console.log('RELOAD URL   :', req.url);
  console.log('champ 5 (djb2):', req.field5);
  console.log('body (hex)   :', req.body.toString('hex').slice(0, 120) + '...');
  console.log('body (len)   :', req.body.length, 'octets');
  console.log('\nHeaders:', JSON.stringify(req.headers, null, 2));

  console.log('\n--- À FAIRE pour un payload VALIDE (non stub) ---');
  console.log('1) Implémenter deriveSignalCode() + deriveKey()  (reverse des ~35 ex. du README)');
  console.log('2) Implémenter encryptFingerprint() (clé anchor idx18) — cf. recaptcha-vm/encryption');
  console.log('3) Générer les vrais signaux Idx4..78 (collecteurs .js) dans un vrai navigateur');
  console.log('4) Réextraire la clé X-Browser-Validation du binaire Chrome 150');
  console.log('5) Obtenir un vrai token via GET /anchor (champ 2)');
}

module.exports = {
  djb2, generateCallBack, encodeCo, xBrowserValidation, XBV_KEYS,
  buildAnchorURL, buildReloadRequest, buildField16,
  deriveSignalCode, deriveKey, encryptFingerprint,
};
