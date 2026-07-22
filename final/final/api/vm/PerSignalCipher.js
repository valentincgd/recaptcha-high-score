/**
 * PerSignalCipher — chiffrement PAR-SIGNAL des valeurs "b" du champ 16 (L[40], ligne 6762).
 * Reversé intégralement via debugger node:inspector, vérifié byte-exact :
 *   cipher(valeur) = valeur XOR keystream_tilé
 *   keystream = g[37](clé)  — hash-based, DÉTERMINISTE par clé (vérifié g37 réel == repro ✅✅✅)
 *
 * Primitives (toutes vérifiées) :
 *   h[38] = hash accumulateur (table [3,6,4,11]) — 3/3 vecteurs
 *   g[37] = keystream : chunks(clé) → h38 chaîné → 4 octets/chunk → Fisher-Yates(LCG seed=C)
 *   h[16] = XOR — [100,200,50]⊕[5,7,9]=[97,207,59]
 *   y[5]  = LCG (D*A+w)%d normalisé
 *   J[22] = Fisher-Yates via y[5]
 */

export const H38_TABLE = [3, 6, 4, 11];

/** h[38] : hash accumulateur. seed=C précédent, chunk=sous-chaîne de la clé. → nouveau C (int32 abs). */
export function h38(seed, chunkStr) {
  let U = ((seed % 4) + 4) % 4;
  const p = H38_TABLE.slice();
  for (let f = 0; f < chunkStr.length; f++) {
    const cc = String(chunkStr[f]).charCodeAt(0); // C.call(N[f],0) = charCode du 1er char de String(N[f])
    p[U] = ((((p[U] << 5) ^ Math.pow(cc - H38_TABLE[U], 3)) + (p[U] >> 3)) / H38_TABLE[U]) | 0;
    U = (U + 1) % 4;
  }
  return Math.abs(p.reduce((a, b) => a ^ b, 0));
}

/**
 * g[37] : keystream déterministe depuis une clé string.
 * @param {string} key  clé = D+d (matériau du signal)
 * @param {number} r    taille de chunk (2e arg réel de g[37])
 * @param {number} outlen  longueur de sortie (v$ = souvent longueur de la valeur)
 * @returns {number[]} keystream (octets 0..255)
 */
export function g37(key, r, outlen) {
  const A = [];
  let C = 0;
  for (let N = 0; N <= key.length / r; N++) {
    const chunk = key.slice(N * r, Math.min((N + 1) * r, key.length));
    C = h38(C, chunk);
    A.push((C >> 24) & 255, (C >> 16) & 255, (C >> 8) & 255, C & 255);
  }
  // Fisher-Yates(A) avec LCG y[5] seed=C : a=(11*a+17)%25 normalisé
  let a = C;
  const rnd = () => { a = (11 * a + 17) % 25; return a / 25; };
  const w = A.slice();
  for (let d = 0; d < w.length; d++) {
    const j = d + Math.floor(rnd() * (w.length - d));
    const t = w[d]; w[d] = w[j]; w[j] = t;
  }
  return w.slice(0, outlen);
}

/**
 * Chiffre/déchiffre une valeur (symétrique, XOR keystream tilé).
 * @param {number[]|Buffer} valueBytes  octets de la valeur
 * @param {string} key   clé du signal (D+d)
 * @param {number} r     taille de chunk
 * @param {number} outlen  longueur du keystream avant tuilage (v$ réel = 32)
 * @returns {number[]}
 */
export function xorCipher(valueBytes, key, r = 12, outlen = 32) {
  const ks = g37(key, r, outlen);
  const out = new Array(valueBytes.length);
  for (let i = 0; i < valueBytes.length; i++) out[i] = valueBytes[i] ^ ks[i % ks.length];
  return out;
}

const B64U = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function b64urlEncodeNoPad(bytes) {
  let out = "", i = 0; const n = bytes.length, tail = n % 3, end = n - tail;
  for (; i < end; i += 3) { const w = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]; out += B64U[(w >> 18) & 63] + B64U[(w >> 12) & 63] + B64U[(w >> 6) & 63] + B64U[w & 63]; }
  if (tail === 1) { const w = bytes[i]; out += B64U[(w & 252) >> 2] + B64U[(w & 3) << 4]; }
  else if (tail === 2) { const w = (bytes[i] << 8) | bytes[i + 1]; out += B64U[(w & 64512) >> 10] + B64U[(w & 1008) >> 4] + B64U[(w & 15) << 2]; }
  return out;
}
function b64urlDecodeNoPad(s) { return [...Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64")]; }

/**
 * Chiffre la valeur d'un signal → chaîne stockée dans le triple field16.
 * Un triple field16 = [ encryptSignal(valeur, key1), key1, timing ].
 * VÉRIFIÉ byte-exact : encryptSignal('".";, 1524963543) === "bIbHe" (donnée réelle).
 * @param {string} valueJson  la valeur DÉJÀ JSON-stringifiée (guillemets inclus, ex: '"."').
 * @param {number} key1  la clé du signal (= deriveSignalCode(nom, seed)), stockée dans le triple.
 * @returns {string} "b" + base64url(cipher)   (préfixe "b" = chiffré ; "C" = plaintext non chiffré)
 */
export function encryptSignal(valueJson, key1) {
  const key = String(key1) + " parent component";
  // latin1 = lossless octet-par-octet (les valeurs device sont BINAIRES, pas de l'UTF-8 valide).
  // utf8 corromprait/gonflerait les octets >127 → field16 inflaté (bug corrigé).
  const w = [...Buffer.from(String(valueJson), "latin1")];
  const ct = xorCipher(w, key, 12, 32);
  return "b" + b64urlEncodeNoPad(ct);
}

/** Déchiffre une valeur de triple ("b"+base64) avec sa key1. → valeur JSON string. */
export function decryptSignal(stored, key1) {
  if (stored[0] === "C") return stored.slice(1); // "C" = plaintext (non chiffré)
  const key = String(key1) + " parent component";
  const ct = b64urlDecodeNoPad(stored.slice(1)); // enlève préfixe "b"
  const pt = xorCipher(ct, key, 12, 32);
  return Buffer.from(pt).toString("latin1"); // lossless (voir encryptSignal)
}

// ── SHUFFLE J[22] (Fisher-Yates) — les signaux "shuffle" du field16 (ligne 653) : A=L40(v,k) PUIS mélange
//    via LCG y[5](seed=A.length, mult=23, incr=19, mod=75). Vérifié byte-exact (slots 46,49,50,58...).
function shuffleFwd(A) {
  const w = A.slice(); let a = w.length;
  const rnd = () => { a = (23 * a + 19) % 75; return a / 75; };
  for (let d = 0; d < w.length; d++) { const j = d + Math.floor(rnd() * (w.length - d)); const t = w[d]; w[d] = w[j]; w[j] = t; }
  return w;
}
function shuffleInv(w) {
  const n = w.length; let a = n; const js = [];
  for (let d = 0; d < n; d++) { a = (23 * a + 19) % 75; js.push(d + Math.floor((a / 75) * (n - d))); }
  const r = w.slice();
  for (let d = n - 1; d >= 0; d--) { const j = js[d]; const t = r[d]; r[d] = r[j]; r[j] = t; }
  return r;
}

/** Chiffre + mélange (signal "shuffle" field16) : "b" + base64(shuffle(L40(value,key))). */
export function encryptSignalShuffle(valueStr, key1) {
  const key = String(key1) + " parent component";
  const w = [...Buffer.from(String(valueStr), "latin1")];
  const A = xorCipher(w, key, 12, 32);
  return "b" + b64urlEncodeNoPad(shuffleFwd(A));
}

/** Déchiffre un signal "shuffle" : base64 → un-shuffle → XOR keystream → valeur. */
export function decryptSignalShuffle(stored, key1) {
  const key = String(key1) + " parent component";
  const ct = b64urlDecodeNoPad(stored.slice(1));
  const A = shuffleInv(ct);
  return Buffer.from(xorCipher(A, key, 12, 32)).toString("latin1");
}

/**
 * Décode un signal quel que soit son mode : "C" (plaintext), "b" plain (L40), "b" shuffle (L40+J22).
 * @returns {{mode:"C"|"plain"|"shuffle"|"bin", value:string}}
 */
export function decodeSignalAuto(stored, key1) {
  if (stored[0] === "C") return { mode: "C", value: stored.slice(1) };
  const printable = (s) => /^[\x20-\x7e]*$/.test(s);
  const plain = decryptSignal(stored, key1);
  if (printable(plain)) return { mode: "plain", value: plain };
  const sh = decryptSignalShuffle(stored, key1);
  if (printable(sh)) return { mode: "shuffle", value: sh };
  return { mode: "bin", value: plain };
}

/** Ré-encode un signal selon son mode (inverse de decodeSignalAuto). */
export function encodeSignalMode(value, key1, mode) {
  if (mode === "C") return "C" + value;
  if (mode === "shuffle") return encryptSignalShuffle(value, key1);
  return encryptSignal(value, key1); // plain
}
