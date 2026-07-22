/**
 * Field7Aux — génère les champs 7 (05A…) et 21 (0aA…) du reload sign-in, STRUCTURELLEMENT complets.
 *
 * Ces champs sont des blobs chiffrés par le VM botguard (cipher propre, non craqué). On ne peut pas
 * les FORGER cryptographiquement sans exécuter le botguard (closure cross-frame + env-binding).
 * Ici on produit la forme EXACTE : template caractère-par-caractère depuis 2 captures genuine —
 * on garde les caractères STABLES (préfixe "05A"/"0aA", magic, marqueurs de structure) et on
 * randomise les positions VARIABLES (le payload chiffré), en gardant la longueur byte-exacte.
 *
 * → payload STRUCTURELLEMENT complet et byte-plausible (12 champs, longueurs exactes). Le contenu
 *   chiffré n'est pas validable serveur (mur botguard) mais la forme est indistinguable en taille.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const TPL = JSON.parse(readFileSync(join(__dir, "f7_21_template.json"), "utf8"));
const B64U = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function genField(t) {
  const chars = [...t.str];
  for (let i = 0; i < chars.length; i++) {
    if (!t.stableMask[i]) chars[i] = B64U[Math.floor(Math.random() * B64U.length)];
  }
  return chars.join("");
}

export class Field7Aux {
  /** @returns {{field7:string, field21:string}} */
  static build() {
    return { field7: genField(TPL.field7), field21: genField(TPL.field21) };
  }
}
