# Carte de navigation — recaptcha_readable.js (~19 400 lignes)

Un reCAPTCHA v3 **complet** fait irréductiblement ~19k lignes (prouvé : 0 code mort, ~toutes les 585 `fn_X_i`
utilisées par le flux v3, 57% du volume = object model réel). **On ne le lit pas linéairement — on navigue.**

## Structure globale
- **l.1–7900** : les 12 tables de fonctions dé-indirectées → **585 `function fn_X_i(q, …)`** (dispatch multiplexé
  par le 1er arg `q`). Pour lire la logique d'UN sélecteur précis : `node tools/deob_demux.js` puis chercher
  `fn_X_i__sSEL` (chaque spécialisation = la vraie logique d'un sélecteur, ex. `fn_g_46__s16`).
- **l.7900–19458** : object model reCAPTCHA (classes/prototypes) — protobuf, crypto/BigInt, DOM, télémétrie,
  collecte du fingerprint (champ 16), UI de challenge (v2/audio/image), API publique `grecaptcha`.

## Points d'entrée du chemin token (grep dans readable.js)
| Quoi | Repère (grep) | ~ligne |
|------|---------------|--------|
| Version du script client `TnA7…` (init) | `TnA7HacJFoBWt9hnlunBlYfK` | 12 |
| API publique `grecaptcha` (ready/execute/render) | `grecaptcha` | 1839, 7171, 7217 |
| Parse de la réponse `/reload` (rresp → token) | `rresp` | 2717, 3503 |
| Envois réseau (XHR) — dont le POST `/reload` du champ 16 | `.send(` (77 sites) | — |
| Classe requête HTTP (open/send, retries, status→errcode) | `"POST"`, `"GET"` | ~12 |

## Comment aller au cœur (génération du champ 16 / token)
1. `grep -n "rresp" scripts/recaptcha_readable.js` → schéma de parse de la réponse `/reload` (le token en sort).
2. Remonter les appelants (`fn_X_i` qui construisent le body protobuf : champs 2/5/7/8/14/16/20/21/25).
3. Le champ 16 (fingerprint chiffré) est assemblé côté collecteur VM ; voir aussi `field16_jsdom.js` (harness)
   qui capture le body au `XMLHttpRequest.send` (`captures.reload`).

## Rappel outils
- `node tools/deob_build.js` régénère `recaptcha_readable.js` depuis `recaptcha_pretty.js` (passes 1-4).
- `node tools/deob_demux.js` → `recaptcha_demux.js` (chaque fonction lisible par sélecteur ; ~40k lignes,
  pour LIRE une fonction, pas comme livrable).
- Vérif équivalence : `RC_NO_FETCH=1 RC_SCRIPT_FILE=recaptcha_readable.js node field16_jsdom.js` → HTTP 200.
