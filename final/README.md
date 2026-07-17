# recaptcha-v3-voieb

Générateur de token **reCAPTCHA v3** en **Node pur** (sans navigateur, sans jsdom, **zéro dépendance npm**).

Approche **Voie B** : on n'exécute pas la VM reCAPTCHA, on **réplique ses sorties**. Toutes les valeurs du
fingerprint (UA, WebGL, écran, plateforme…) sont **choisies par nous** et assemblées + chiffrées en champs
16 / 5 / 20 / … du body `/reload`.

**Validé : score 0.9 sur le démo officiel Google (= identique à un vrai navigateur), reproductible.**

## Installation

Aucune. Node ≥ 18 suffit (`fetch` + `crypto` natifs). Pas de `npm install`.

```bash
cd final
node cli.mjs --demo
```

## CLI

```bash
# Générer un token pour le démo Google + afficher le score réel
node cli.mjs --demo

# Générer pour n'importe quel site
node cli.mjs --site <SITEKEY> --action <ACTION> --origin https://exemple.com [--referer <URL>]

# Options
--fp <id>       forcer un profil précis (sinon tirage aléatoire)
--verbose       logs détaillés
--json          sortie JSON (inclut le score en mode --demo)
--list          lister les 5 profils

# Exemples
node cli.mjs --demo --json
node cli.mjs --site 6Lc... --action login --origin https://monsite.com --verbose
```

## API

```js
import { solve, verifyDemoScore, DEMO } from "./index.mjs";

// Génère un token (fingerprint tiré au hasard à chaque appel)
const res = await solve({
  siteKey: "6Lc...",
  action: "login",
  origin: "https://monsite.com",
  // referer, mode ("api2" par défaut), fingerprintId, verbose : optionnels
});
// → { token, success, profileId, fingerprint, reloadBytes, mode }

// Tester le score sur le démo Google
const demo = await solve(DEMO);
const { score } = await verifyDemoScore(demo.token);   // 0.9
```

## Les fingerprints

`fingerprints.json` contient **5 profils navigateur 100 % complets et cohérents**
(UA ⇄ plateforme ⇄ WebGL ⇄ écran ⇄ langue). Un profil est **tiré au hasard à chaque appel**
(`fingerprints.mjs` → `pickFingerprint()`), avec un léger jitter (scroll, localStorage).

| id | OS | GPU | écran | langue |
|---|---|---|---|---|
| `win11_nvidia_rtx3060` | Windows | NVIDIA RTX 3060 | 1920×1080 | en-US |
| `win11_intel_uhd770` | Windows | Intel UHD 770 | 1536×864 | fr-FR |
| `win10_amd_rx6700xt` | Windows | AMD RX 6700 XT | 2560×1440 | en-GB |
| `macos_apple_m2` | macOS | Apple M2 | 1512×982 | en-US |
| `win11_nvidia_gtx1660` | Windows | NVIDIA GTX 1660 | 1366×768 | de-DE |

Chaque profil expose : `userAgent, platform, language, languages, width, height, devicePixelRatio,
webgl{vendor,renderer,extensionCount}, title, scrollY, localStorageLength, inputIds`.
Pour en ajouter/modifier : éditer `fingerprints.json` (garder la cohérence UA ⇄ plateforme ⇄ WebGL).

## Structure

```
final/
├── index.mjs          bibliothèque (solve, verifyDemoScore)
├── cli.mjs            interface ligne de commande
├── fingerprints.json  les 5 profils complets
├── fingerprints.mjs   chargeur + tirage aléatoire
├── api/               pipeline Voie B (chemin pur, importé sans jsdom/canvas)
└── package.json       type module, zéro dépendance
```

## Notes

- **Le `co` de l'anchor** est encodé en base64URL avec padding `.` et inclut `:443` (sinon *Invalid domain
  for site key*). Corrigé dans `api/Config.js`.
- **Le score dépend du couple (cible + réputation IP)** : 0.9 mesuré sur le démo + IP propre. Sur une cible
  très durcie sous charge, la réputation IP/l'historique de la session peuvent faire varier le score — le body
  lui-même est de qualité navigateur.
- Recherche / éducatif.
