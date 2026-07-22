/**
 * DeriveSignalCode — reversé EXACT du recaptcha__*.js (vérifié 349/349 contre captures réelles).
 * signalKey = fmix arithmétique (const 2642172555, multiply FLOTTANT ×2) sur hashString(value, seed)
 * pour les strings, ou (number + seed)|0 pour les nombres. Le seed est CHAÎNÉ (accumulateur) : chaque
 * appel est seedé par le résultat du précédent. Voir mémoire derivesignalcode-cracked.
 */
export class DeriveSignalCode {
  static hashStringSeed(str, seed) {
    let h = seed | 0;
    for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    return h;
  }

  /** Un appel deriveSignalCode. w: string|number, seed: résultat précédent (0 au départ). → int32 signalKey. */
  static one(w, seed) {
    let d = typeof w === "number" ? (w + seed) | 0 : DeriveSignalCode.hashStringSeed(String(w), seed);
    d = (d >> 16 ^ d) * 2642172555; // multiply flottant volontaire (ToInt32 via >> au tour suivant)
    d = (d >> 16 ^ d) * 2642172555;
    return d >> 16 ^ d;
  }

  /** Séquence chaînée : renvoie les signalKeys pour une liste ordonnée de valeurs. */
  static chain(values, seed0 = 0) {
    const out = [];
    let seed = seed0 | 0;
    for (const v of values) { seed = DeriveSignalCode.one(v, seed); out.push(seed); }
    return out;
  }
}
