# Carte des signaux VM (champ 16) — spec de la Voie B (réimplémentation pur-JS)

Extraite par analyse statique du disassemblé (`recaptcha-vm/output/disassembled.txt`) via `vm/disasm.js`.
La VM émet **25 SEND**, chacun = un champ (Idx) du protobuf du champ 16 :
`SEND(idxConst, valeurChiffrée, elapsed=PERF-delta, ctx)`. Chiffrement = `EncryptSignal(val, encKey=R586,
signalKey, runtimeSeed=(trunc(perf)+K)*golden)` → cipher LCG additif (oc_cipher.js, constantes R1454/R1846/R1213).

Pour la Voie B : chaque signal devient une fonction JS qui renvoie une valeur (hardcodée device / gaussienne /
vide), puis on chiffre + assemble le protobuf. **On ne rejoue PAS le main bytecode.**

| Idx | Collecte (strings déchiffrées) | Valeur pur-JS |
|---|---|---|
| 1  | `navigator.userAgent` | UA hardcodé (cohérent profil) |
| 2  | `document` + `[^a-zA-Z0-9]` replaceAll + slice | string sanitisée (dérivable) |
| 4  | `document.body.innerText` + regex montant `(EUR\|USD\|€\|$)[\d.,]+` + `remove\|edit\|colou?r\|size\|quantity\|qty\|gift\|sku` + `total\|tax\|fee\|shipping\|delivery` | vide/no-match (on contrôle la page) |
| 7  | `document.querySelectorAll` + replaceAll + split | calculé (DOM vide) |
| 8  | `navigator.webdriver` | `false` (0) |
| 10 | `navigator.maxTouchPoints` | `0` |
| 11 | inputs form : `name/id/autocomplete/className` + `postal\|postcode\|zip` | vide (pas de form) |
| 12 | scalaire (`Math.floor`) | petit entier / timing |
| 13 | scalaire (`Math.floor`) | petit entier / timing |
| 14 | `performance.getEntriesByType('visibility-state')` + startTime | timings gaussiens (visible dès 0) |
| 15 | `performance` navigation : `domContentLoadedEventEnd`, `loadEventEnd`, `first-input` startTime | timings gaussiens plausibles |
| 16 | `clearTimeout` (timing) | petit entier |
| 17 | `clearTimeout` (timing) | petit entier |
| 18 | scalaire (`Math.floor`) | petit entier |
| 19 | slice + concat | calculé |
| 20 | `innerText` + `total[\S\s]{0,20}?` + regex montant + matchAll | vide/no-match |
| 21 | scalaire (`Math.floor`) | petit entier |
| 22 | inputs `:not([type=radio/button/checkbox/hidden])` + `otp\|code` + placeholder/aria-label | vide (pas d'OTP) |
| 23 | scalaire (`Math.floor`) | petit entier |
| 24 | **anti-tamper** : iframe propre + Reflect.getOwnPropertyDescriptor + getPrototypeOf + `Function.prototype.toString` + regex `function\s+(get\s+)?([a-zA-Z]+)\(\)\s+\{\s+\[native code\]\s+\}` + `isTrusted` | résultat « tout natif / non trafiqué » (figé) |
| 25 | `android`, `chrome`, Object.keys | figé (desktop chrome) |
| 26 | scalaire (`Math.floor`) | petit entier |
| 27 | **WebGL** : canvas getContext('webgl') + `WEBGL_debug_renderer_info` + `UNMASKED_VENDOR_WEBGL` + `UNMASKED_RENDERER_WEBGL` + getSupportedExtensions | vendor/renderer/exts hardcodés d'un vrai GPU |
| 28 | **surface API** : Object.getOwnPropertyNames(prototype) de SpeechSynthesisEvent, NetworkInformation, HTMLElement, SpeechSynthesisUtterance, MediaMetadata, HTMLMediaElement, RemotePlayback, AuthenticatorAttestationResponse… | listes de props figées d'un vrai Chrome (version cohérente) |
| 29 | Array + `Math.floor` | petit entier |

**Notes** :
- Idx 3,5,6,9 absents de ce build (25 SEND sur slots 1-29).
- `elapsed` (3ᵉ arg SEND) = `PERF - baseline` → à simuler en gaussien (détecte breakpoints/sandbox par timing anormal).
- Idx 24/27/28 = les 3 gros signaux anti-bot (intégrité fonctions natives, GPU, surface API) → à figer soigneusement
  et de façon COHÉRENTE avec l'UA/plateforme annoncés (une incohérence = détectable).
- Cf. [[vm-purejs-solver]], [[field16-cipher-re]] (cipher), [[score-root-cause]] (plafond ~0.3).
