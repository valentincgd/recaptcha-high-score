/**
 * Field16Cipher — cipher du champ 16 du /reload reCAPTCHA. Reversé via debugger node:inspector
 * (vérifié 2736/2736 octets). field16 = "0" + base64url(C) où :
 *   C = [A, ...cipher],  A = nonce aléatoire 0..254 (préfixé, récupérable)
 *   cipher[i] = (D[i] + D.length + (d + A) * (i + A)) mod 256
 *   D = UTF8(plaintext JSON string des signaux),  d = DC % 1000000  (DC = clé session, ~timestamp)
 */
const B64U = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function b64urlEncodeNoPad(bytes) {
  let out = "", i = 0; const n = bytes.length, tail = n % 3, end = n - tail;
  for (; i < end; i += 3) { const w = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]; out += B64U[(w >> 18) & 63] + B64U[(w >> 12) & 63] + B64U[(w >> 6) & 63] + B64U[w & 63]; }
  if (tail === 1) { const w = bytes[i]; out += B64U[(w & 252) >> 2] + B64U[(w & 3) << 4]; }
  else if (tail === 2) { const w = (bytes[i] << 8) | bytes[i + 1]; out += B64U[(w & 64512) >> 10] + B64U[(w & 1008) >> 4] + B64U[(w & 15) << 2]; }
  return out;
}
function b64urlDecode(s) { return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64"); }

export class Field16Cipher {
  /**
   * Chiffre le plaintext (string JSON) → field16.
   * DC = clé session (number). NON critique : le cipher n'utilise que (d+A) mod 256, et le
   * déchiffreur (Google) le récupère depuis le préfixe plaintext connu `[null,null,null,null,"`.
   * → on peut passer n'importe quel DC (défaut Date.now()). A = nonce (défaut aléatoire, préfixé).
   */
  static encrypt(plaintextStr, DC = Date.now(), A = null) {
    const D = Buffer.from(String(plaintextStr), "utf8");
    const d = ((Number(DC) % 1000000) + 1000000) % 1000000;
    if (A == null) A = Math.floor(Math.random() * 255);
    const C = Buffer.alloc(D.length + 1);
    C[0] = A;
    for (let i = 0; i < D.length; i++) C[i + 1] = (D[i] + D.length + (d + A) * (i + A)) % 256;
    return "0" + b64urlEncodeNoPad(C);
  }

  /** Déchiffre field16 → plaintext string (nécessite DC). */
  static decrypt(field16, DC) {
    const C = b64urlDecode(field16.slice(1)); // enlève le préfixe "0"
    const A = C[0];
    const d = ((Number(DC) % 1000000) + 1000000) % 1000000;
    const len = C.length - 1;
    const D = Buffer.alloc(len);
    for (let i = 0; i < len; i++) D[i] = (((C[i + 1] - len - (d + A) * (i + A)) % 256) + 256) % 256;
    return D.toString("utf8");
  }
}
