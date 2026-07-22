/**
 * Field16Builder — décodeur du champ 16 /reload.
 *
 * `decode()` brute-force la clé externe (via le préfixe plaintext connu `[null,null…`) et renvoie le
 * tableau des 79 slots. Utilisé par PureFlatReload pour calculer field5 = hash(slots), et par les outils
 * de diff. La GÉNÉRATION du field16 est faite par Field16Collector (piloté par le profil), pas ici.
 */
export class Field16Builder {
  /** Déchiffre un field16 en son tableau de slots (brute-force de (d+A) mod 256 via le préfixe connu). */
  static decode(field16) {
    const bytes = Buffer.from(field16.slice(1).replace(/-/g, "+").replace(/_/g, "/"), "base64");
    const A = bytes[0], len = bytes.length - 1;
    for (let k = 0; k < 256; k++) {
      const D = Buffer.alloc(len);
      for (let i = 0; i < len; i++) D[i] = (((bytes[i + 1] - len - k * (i + A)) % 256) + 256) % 256;
      const s = D.toString("utf8");
      if (s.startsWith("[null,null")) return JSON.parse(s);
    }
    return null;
  }
}
