# Génération d'une requête reCAPTCHA Enterprise `/reload`

> Analyse de la requête live (Ticketmaster, Chrome 150, 2026) mise en correspondance
> avec les deux repos de reverse-engineering :
> - **`recaptcha/`** — spec du protocole + reimplémentations JS des collecteurs de fingerprint
> - **`recaptcha-vm/`** — désassembleur/déchiffreur Rust de la VM interne
>
> Pour **chaque champ**, on documente : la **source** (API navigateur / DOM / anchor),
> la **transformation** (algorithme), et le **fichier du repo** qui la décrit.
>
> ⚠️ *Usage éducatif / recherche uniquement (cf. disclaimer des repos).*

---

## 1. Vue d'ensemble du flux

```
┌────────────────────┐     ┌─────────────────────┐     ┌────────────────────────┐
│  GET /anchor       │ ──▶ │  Réponse anchor      │ ──▶ │  POST /reload          │
│  (charge le widget)│     │  - token de validation│     │  (envoie le fingerprint│
│                    │     │  - clés de chiffrement│     │   chiffré + télémétrie)│
│                    │     │  - config VM bytecode │     │                        │
└────────────────────┘     └─────────────────────┘     └────────────────────────┘
```

La réponse `/anchor` fournit les **matériaux** (token, clés de chiffrement horodatées,
bytecode de config VM). Le client collecte ~60 signaux de fingerprint, les **sérialise**,
les **chiffre** avec la clé de l'anchor, puis poste le tout en **protobuf**
(`Content-Type: application/x-protobuffer`) sur `/reload`.

Source des clés (README `recaptcha`, section *Anchor Payload*) :
- **idx 18** de l'anchor = clé de chiffrement du fingerprint (`1777669303203`)
- **idx 31** de l'anchor = clé de chiffrement des signaux VM `oc` (`1777752103288`)
- **idx 8** de l'anchor `[16,21,125,...]` = indices des signaux à collecter
- config bytecode de la VM (double-base64) déchiffrée par `recaptcha-vm`

---

## 2. Table des champs de la requête `/reload` (live)

| Champ | Valeur (live) | Rôle | Source de départ | Repo / fichier |
|---|---|---|---|---|
| `1` | `TnA7HacJFoBWt9hnlunBlYfK` | Version reCAPTCHA | Paramètre `v=` de l'URL anchor | README §Payload |
| `2` | `03AFcWeA6...` | Token de validation | Réponse `/anchor` | README §Response |
| `5` | `"1474380227"` | Hash du fingerprint sérialisé | Le payload fingerprint complet | `hashFingerprint.js` |
| `6` | `"q"` | Mode de challenge | Constante (V3) | README §Challenge Modes |
| `8` | `"Event"` | Site action | Action passée à `grecaptcha.execute()` | README idx 8 |
| `14` | `6LcvL3Ur...` | Website key | Paramètre `k=` de l'URL | README §Payload |
| `16` | `0hzQAwH...` | **Fingerprint chiffré** | 60 signaux navigateur | tout le dossier `recaptcha/*.js` |
| `20` | `tbMy...` (base64) | Télémétrie VM/ressources | Performance API | README §Telemetry |
| `22` | `BDAgbAY...` | Hash des clés d'objets browser | Prototypes JS globaux | `hashBrowserProtos.js` |
| `25` | `W10` → `[]` | Compteurs d'événements | Listeners pointer/key | README §Event Counters |
| `28` | `20000` | `anchor-ms` (timeout widget) | Paramètre URL `anchor-ms` | README §Payload (anchor) |
| `29` | `30000` | `execute-ms` (timeout exécution) | Paramètre URL `execute-ms` | README §Payload (anchor) |

---

## 3. Génération détaillée, champ par champ

### Champ 1 — Version
- **Source** : directement le paramètre `v=TnA7HacJFoBWt9hnlunBlYfK` de l'URL anchor.
- **Génération** : aucune ; recopie du hash de version du script `recaptcha__*.js` servi par gstatic.
- **Repo** : README `recaptcha`, *Anchor Payload Structure* (`v: <Recaptcha Version>`).

### Champ 2 — Token de validation
- **Source** : renvoyé par la réponse `/anchor` (champ token de l'anchor).
- **Génération** : opaque, signé côté serveur Google. Le client le **rejoue** tel quel.
- **Repo** : README `recaptcha`, *Response* (« Anchor token used for payload validation (/reload) »).

### Champ 5 — Hash du fingerprint (`"1474380227"`)
- **Source** : le **payload fingerprint sérialisé complet** (avant chiffrement).
- **Génération** : hash **djb2 32-bit signé** sur toute la chaîne sérialisée.
  ```js
  // hashFingerprint.js
  let h = 0;
  for (const c of serializedFingerprint)
      h = (h * 33 + c.charCodeAt(0)) | 0;   // djb2, wrap 32-bit signé
  return String(h);
  ```
- **Repo** : `recaptcha/hashFingerprint.js` — README table Reload, idx 5.
- **Note** : c'est une **intégrité** ; le serveur recalcule le hash après avoir déchiffré le champ 16 et compare.

### Champ 6 — Mode de challenge (`"q"`)
- **Source** : constante déterminée par le type d'appel.
- **Génération** : table fixe (README §Challenge Modes) :
  `q` = V3, `fi` = V2/invisible, `a` = audio, `qr` = quick-response.
- **Repo** : README `recaptcha`, *Challenge Modes*.

### Champ 8 — Site action (`"Event"`)
- **Source** : le 1er argument de `grecaptcha.enterprise.execute(key, {action: "..."})`.
  Ici Ticketmaster utilise `"Event"` (le repo montrait `"submit"`).
- **Génération** : recopie de l'action, éventuellement enveloppée dans un sous-message
  protobuf (`8 { 8: ... }`) — évolution observée vs le repo (string simple).
- **Repo** : README `recaptcha`, idx 8 (« Specific Site action … e.g. `signin`, `register` »).

### Champ 14 — Website key
- **Source** : paramètre `k=6LcvL3Ur...` de l'URL (clé publique du site).
- **Génération** : aucune ; recopie.
- **Repo** : README `recaptcha`, *Payload Structure* (`k: <Website Key>`).

### Champ 16 — Fingerprint chiffré ⭐ (le cœur)
Détaillé en **section 4** (construction) et **section 5** (chiffrement).

### Champ 20 — Télémétrie (`tbMy...`)
- **Source** : Performance API (`performance.getEntries`, `PerformanceLongTaskTiming`,
  `PerformanceResourceTiming`) + hosts des `<script>` + stats de collecte VM.
- **Génération** : structure sérialisée puis base64 (avec préfixe `tb`). Décodée :
  ```json
  [
    [[3,78,445],[1,176,559]],                              // recaptchaResources [type,duration,startTime]
    null,                                                  // tasksTiming (long tasks)
    [null,null,null,[5,4.98,0.536,11],[0,null,0],0,0,0],   // deltas VM (idle/timing)
    ["www.ticketmaster.com","www.google.com","www.gstatic.com"], // websiteScriptsUrls
    [2,795]                                                // [collectionElapsed, browserObjectsLength]
  ]
  ```
  Types de ressources : `3`=`api.js`, `1`=`releases/<version>`, `2`=`anchor`, `4`=`bframe`.
- **Repo** : README `recaptcha`, *Telemetry Payload (Idx 20)* — structure validée octet par octet.

### Champ 22 — Hash des clés d'objets browser (`BDAgbAY...`)
- **Source** : les clés (`getOwnPropertyNames`) des prototypes d'objets globaux
  (`SpeechSynthesisEvent`, `NetworkInformation`, `HTMLElement`, `PushManager`, …).
- **Génération** : hash **djb2** de chaque nom de propriété, puis empaquetage
  dans un **bitfield encodé base64** (préfixe `BD`).
  ```js
  // hashBrowserProtos.js — un hash djb2 32-bit par API, à index fixe
  for (const api of BROWSER_APIS)
      hashes.push(djb2(api.prototype.getOwnPropertyNames()[api.index]));
  ```
- **Repo** : `recaptcha/hashBrowserProtos.js` — README table Reload, idx 22 (aussi signal VM *Key 291*).

### Champ 25 — Compteurs d'événements (`W10` = `[]`)
- **Source** : listeners `pointermove/pointerdown/pointerup/keydown/keyup/focusin`.
- **Génération** : `[[[eventTypeHash, count], …]]` sérialisé puis base64. **Vide ici**
  (`[]`) car aucune interaction utilisateur (V3 invisible / headless).
- **Hashes connus** (README) : `5006`=pointermove, `64607`=pointerdown, `45464`=pointerup,
  `31617`=keydown, `37178`=keyup, `35837`=focusin.
- **Repo** : README `recaptcha`, *Event Counters (Idx 25)*.

### Champs 28 / 29 — Timeouts (`20000` / `30000`)
- **Source** : paramètres `anchor-ms=20000` et `execute-ms=30000` de l'URL anchor
  (visibles dans le header `Referer`).
- **Génération** : recopie brute. **Ajout** vs la doc du repo (qui ne les listait que
  dans le payload `/anchor`, pas dans `/reload`).
- **Repo** : README `recaptcha`, *Payload Structure* (`anchor-ms`, `execute-ms`).

---

## 4. Construction du champ 16 — le fingerprint (signal par signal)

Le champ 16 est la partie la plus riche. Avant chiffrement, c'est un **tableau de ~60 signaux**
indexés (`Idx 4` → `Idx 78`). Chaque signal a le format `[value, key, elapsed]` où `key` est la
clé de chiffrement dérivée et `elapsed` le temps de collecte (permet à Google de détecter
breakpoints/hooks/sandbox par timing anormal).

**Ordre d'exécution du collecteur** (scheduler interne, README) :
```
[42,45,53,30,28,54,29,31,32,33,34,35,37,36,38,39,43,40,41,46,48,57,58,60,61,62,63,64,66,68,69,71,72,79,55]
```

### Comment chaque signal est généré (source → algo → fichier repo)

| Idx | Source (départ) | Génération | Fichier repo |
|---|---|---|---|
| 4 | `localStorage.getItem("rc::a")+"6d"` | HMAC-SHA256(siteKey), 4 hex | README idx 4 |
| 5 | `localStorage.length` | `× 2` | README idx 5 |
| 16 | Tous les nœuds `<HEAD>` | BitHash Bloom (240 bits, 7 rounds) → base64 | `hashHeadElements.js` |
| 18 | Aléatoire | base64 random | README idx 18 |
| 27 | `location.origin` | recopie | README idx 27 |
| 28 | `window.parent`/`frameElement` | test iframe → bool | README idx 28 |
| 29 | `grecaptcha.execute` (corps fn) | SHA-256, 8 hex | `hashGrecaptchaThenBody.js` |
| 30 | `document.scripts` | index du script gstatic recaptcha | `getRecaptchaScriptIndex.js` |
| 31 | `document.cookie` (clés) | djb2 → bitfield base64 | `hashCookies.js` |
| 32 | `document.referrer` | recopie | README idx 32 |
| 33 | `.grecaptcha-badge` | profondeur DOM (nb de parents) | README idx 33 |
| 34 | Tous les `<INPUT>` (attrs) | djb2 → bitfield base64 | `hashInputElements.js` |
| 35 | `document.activeElement` | regex achat + SHA-256(tag+id+class) | `computeActiveElement.js` |
| 36 | `performance...nextHopProtocol` | recopie (`h2`/`h3`/`http/1.1`) | README idx 36 |
| 37 | `performance.timing.unloadEventStart` | recopie | README idx 37 |
| 38 | `domainLookupStart - domainLookupEnd` | soustraction | README idx 38 |
| 39 | `performance.navigation.type` | recopie | README idx 39 |
| 40 | `window.scrollY` | recopie | README idx 40 |
| 41 | `:hover` (dernier élément) | SHA-256(tag+id+class) | `computeHoveredElement.js` |
| 42 | Script aléatoire de la page | SHA-256(texte) + index | `hashRandomScript.js` |
| 44 | `:hover`+activeElement+inputs+url+scrollY | concat de signal codes | README idx 44 |
| 45 | `window.history.length` | recopie | README idx 45 |
| 46 | Erreur JS sur la page | `line:column` | README idx 46 |
| 47 | `getSelection().toString().length` | recopie | README idx 47 |
| 49 | Resource timing du script recaptcha | `protocol-isZero` | `recaptchaResourceTiming.js` |
| 50 | Activations utilisateur + `:hover` | `10*isActive + hasBeenActive`, session | README idx 50 |
| 51 | `document.body.innerText` | count `/try again\|incorrect\|invalid\|declined/gi` | `pageErrorKeywordCouint.js` |
| 52 | `navigator.userActivation` | `10*isActive + hasBeenActive` | README idx 52 |
| 53 | `location` (100 premiers chars) | parité longueur → 4 ou 5 | `locationLengthParity.js` |
| 54 | `document.hidden` | recopie | README idx 54 |
| 55 | Tous les signal codes générés | ré-ordonnancement | README idx 55 |
| 56 | `window.opener` | `-1,-1` si null | README idx 56 |
| 57 | `document.scripts` (hosts src) | regex URI → hosts (max 25) | `collectScriptHostsSrc.js` |
| 58 | `localStorage` (clé échantillon) | recopie | README idx 58 |
| 59 | `window.name` | recopie | README idx 59 |
| 60 | Events `message` | URLs origines | `pageMessageUrls.js` |
| 61 | `MutationObserver` | djb2 attrs+tags → bitfield | `writeMutationObservers.js` |
| 62 | `document.title` | recopie | README idx 62 |
| 63 | `document.cookie` (valeurs) | extrait timestamps → `[count,min,max,avg]` | `derirveCookies.js` |
| 64 | Timing anchor→reload | delta ms | README idx 64 |
| 65 | Integrity du script api.js | SHA-256 (10 chars) | README idx 65 |
| 67 | `screen`/`window` dims | `[w,h,availH,innerW,innerH,outerH]` | README idx 67 |
| 68 | `Date` | `[getTimezoneOffset(), null, Date.now()]` | README idx 68 |
| 69 | Cookie de session humain | recopie token | README idx 69 |
| 70 | `document.innerText` | regex montant total `$/€/USD…` | README idx 70 |
| 71 | `performance.memory` | `[jsHeapSizeLimit,used,total]` | README idx 71 |
| 72 | `navigator.userAgentData` | `[[brand,version]…], mobile, platform` | README idx 72 |
| 73 | Signaux chiffrés de la VM | (voir §6 VM) | `recaptcha-vm` |
| 77 | Timestamp Unix | parfois présent | README idx 77 |
| 78 | Cookie `_ga` | présent si Google Tag Manager | README idx 78 |

> Si un signal échoue (timeout dû à un debugger), il est remplacé par une valeur base64
> **aléatoire** (README : `["CMXZyamk3ZHNjdGsyaQ==", 3249, 591]`).

### Dérivation de la clé par signal (pipeline déterministe)

Avant d'être chiffré, chaque valeur passe par (README §Fingerprint Signals Codes) :
```
Raw Value → deriveSignalCode() → code compact (ex "wg")
          → deriveKey()        → clé numérique (ex 3792)
          → encryptValueWithKey(key, value) → valeur chiffrée
```
Exemple du repo :
```js
deriveSignalCode("BUTTON,195a81c9") // → "wg"
deriveKey("wg")                      // → 3792
encryptValueWithKey(3792, "wgia1z9pwq") // → "bYVbh6BUsE_5pLA"
```
Tous les signal codes sont agrégés dans `Idx 55` sous forme `[[[1,"wg"],[1,"21"],…], "54"]`.

---

## 5. Chiffrement du champ 16

Une fois les ~60 signaux sérialisés en une chaîne :
1. La chaîne est **chiffrée** avec la clé de chiffrement de l'anchor **idx 18**
   (`1777669303203` dans l'exemple du repo).
2. Le résultat (préfixe `0`) est placé dans le **champ 16** du `/reload`.

- **Repo** : README `recaptcha` fin de §Fingerprint (« serialized … encrypted using the key
  loaded from the anchor field (index 18) … stored in index 16 of /reload »).

Le même schéma sert au champ `oc` du `/userverify` (mais avec la clé **idx 31** de l'anchor).

---

## 6. Signaux VM (Idx 73 du fingerprint & champ `oc`)

Ces signaux sont produits par la **VM interne** de reCAPTCHA, désassemblée par le repo
`recaptcha-vm`. Format de base : `[null, collectorElapsed, encryptElapsed, value]`.

### Source du bytecode
- **Config bytecode** : chargé depuis l'anchor, chiffré avec **2 clés** combinées.
  ```rust
  // recaptcha-vm/src/bytecode/mod.rs
  let seed = xor_fold(&[176,170,107], &[76]);       // XOR-fold des 2 clés
  let decrypted = xor_decrypt(&base64_decode(cfg), seed as i64); // LCG-XOR
  ```
  (LCG interne : `state = (4391*state + 277) % 32779`)
- **Main bytecode** : construit dynamiquement dans le JS reCAPTCHA, chiffré LCG,
  déchiffré au bootstrap de la VM.

### Extraction des valeurs (opcodes)
La VM (2048 registres, ~36 opcodes utilisés) exécute des handlers documentés dans
`recaptcha-vm/src/disassembler/opcodes.rs` : `GET_WINDOW_PROP`, `CALL_METHOD`, `HASH`,
`STRING_DECRYPT`, `SEND`, etc. Exemples de signaux VM (README `recaptcha`) :

| Key VM | Source (départ) | Fichier repo |
|---|---|---|
| 417 | `navigator.userAgent` | README §VM Signals |
| 545 | `navigator.webdriver` | README §VM Signals |
| 370 | `navigator.maxTouchPoints` | README §VM Signals |
| 727 | Prix produits e-commerce | `findProductPricesBlock.js` |
| 779 | Champs shipping/billing | `formFieldScrape.js` |
| 659 | Éléments cliqués (+ checksum) | README §VM Signals |
| 959 | Mouvements de scroll | README §VM Signals |
| 352 | Événements souris (mouvements/clics) | README §VM Signals |
| 360 | Total prix `$` de la page | `websitePricesTotal.js` |
| 1422 | Champs OTP/2FA | `parseOTPFields.js` |
| 614 | `navigator.getBattery()` | README §VM Signals |
| 1310 | WebGL vendor/renderer/extensions | `webglSignals.js` |
| 291 | Hash des prototypes browser | `hashBrowserProtos.js` |
| 1994 | `hardwareConcurrency`, `deviceMemory`, `storage.estimate().quota` | README §VM Signals |

### Chiffrement des signaux VM
Cipher stream custom (non cryptographique), état dérivé du timing runtime
(`recaptcha-vm/src/encryption/mod.rs`) :
```js
timestamp   = Math.trunc(performance.now());
runtimeSeed = (timestamp + 939) * 2654435761;
state       = (encryptionKey ^ signalKey) ^ runtimeSeed;   // encKey en registre 586
// puis LCG : X[n+1] = (13558035*X[n] + 13037) % 94906238
```
Les **4 derniers octets** du chiffré contiennent `runtimeSeed` (big-endian) pour permettre
au serveur de reconstruire l'état et déchiffrer. Clé statique en **registre 586**
(`-940896859` dans l'échantillon).

---

## 7. Headers HTTP (hors périmètre des repos)

La requête live ajoute des headers d'intégrité Chrome **non documentés dans les repos** :

| Header | Rôle |
|---|---|
| `X-Browser-Validation: mNzuBeCu/YGkOyEzuibi5ew1PGc=` | HMAC (clé embarquée Chrome) sur API key + User-Agent → prouve un vrai Chrome |
| `X-Browser-Copyright: Copyright 2026 Google LLC…` | Marqueur build Chrome |
| `X-Browser-Year: 2026` | Année du build |
| `X-Browser-Channel: stable` | Canal de release |
| `sec-ch-ua*` | Client Hints (doivent être cohérents avec le fingerprint idx 72) |

➡️ **Signal anti-abus supplémentaire** apparu depuis la rédaction des repos : reproduire
un payload `/reload` valide nécessite aussi de générer un `X-Browser-Validation` correct.

---

## 8. Récapitulatif : d'où vient chaque valeur

```
URL anchor (v, k, action, anchor-ms, execute-ms)
   │
   ├─▶ champs 1, 6, 8, 14, 28, 29   (recopie directe)
   │
Réponse /anchor (token, clés idx18/idx31, config VM bytecode)
   │
   ├─▶ champ 2   (token rejoué)
   ├─▶ clés de chiffrement (champ 16, signaux VM)
   └─▶ recaptcha-vm : déchiffre le bytecode → sait quels signaux collecter
   │
Navigateur (DOM, navigator, performance, screen, cookies, localStorage, WebGL, VM)
   │
   ├─▶ ~60 signaux fingerprint  ──sérialisation──▶ hash (champ 5) + chiffrement (champ 16)
   ├─▶ Performance API          ──────────────────▶ champ 20 (télémétrie)
   ├─▶ prototypes globaux JS     ──djb2/bitfield──▶ champ 22
   └─▶ listeners d'événements    ──────────────────▶ champ 25
   │
Chrome (build interne)
   └─▶ headers X-Browser-*  (intégrité, hors repos)
```

**Conclusion** : les repos permettent de régénérer **presque tout** le corps `/reload`
(structure protobuf, chaque signal de fingerprint via les `*.js`, le chiffrement via
`recaptcha-vm`). Les **inconnues restantes** pour reproduire une requête *valide* sont :
1. le calcul exact de `X-Browser-Validation` (secret Chrome, non couvert),
2. le token `/anchor` (signé serveur, à obtenir légitimement),
3. le wrapping éventuel du champ 8 (évolution récente non documentée).

---

## 9. Complétude & pièces manquantes

> Peut-on **régénérer** chaque valeur avec le code des repos ? On distingue « connaître ce que
> contient la valeur » (oui, tout est documenté) de « avoir le code exécutable » (partiel).
> Vérifié par recherche : `deriveSignalCode`, `deriveKey`, `encryptValueWithKey` n'apparaissent
> **que dans le README** (exemples entrée→sortie), aucune implémentation en `.js`.

### Niveau 1 — ✅ Algorithme complet et exécutable

| Brique | Fichier | Sert à |
|---|---|---|
| Hash djb2 32-bit (`hashString`) | `hashFingerprint.js` | champ 5 |
| Hash SHA-256 (via `crypto.subtle`) | `hashGrecaptchaThenBody.js`, `hashRandomScript.js`, `computeActiveElement.js`, `computeHoveredElement.js` | Idx 29, 35, 41, 42 |
| BitHash / BinaryGridHasher (Bloom) | `hashHeadElements.js`, `hashCookies.js`, `hashInputElements.js`, `writeMutationObservers.js` | Idx 16, 31, 34, 61 |
| Parsing DOM / regex | `collectScriptHostsSrc`, `derirveCookies`, `findProductPricesBlock`, `formFieldScrape`, `locationLengthParity`, `pageErrorKeywordCouint`, `pageMessageUrls`, `parseOTPFields`, `recaptchaResourceTiming`, `webglSignals`, `websitePricesTotal`, `hashBrowserProtos`, `getRecaptchaScriptIndex` | Idx 30,46,49,51,53,57,60,63,70 + Keys VM 291,360,727,779,1310,1422 |
| Déchiffrement bytecode VM (`xor_fold`+LCG) | `recaptcha-vm/src/bytecode/mod.rs` | config/main bytecode |
| Chiffrement signaux VM (stream cipher) | `recaptcha-vm/src/encryption/mod.rs` | champ `oc` / Idx 73 |
| Désassembleur VM (opcodes, varint) | `recaptcha-vm/src/disassembler/*` | comprendre les collecteurs VM |

### Niveau 2 — 🟡 "Sample" seulement (logique montrée, non branchable)

- Chaque `.js` est une **démo autonome** avec des **entrées codées en dur**.
  Ex. `hashFingerprint.js` ne *construit* pas le fingerprint : il hashe une chaîne littérale
  (lignes 16-18). Il fournit l'**algorithme**, pas le **pipeline**.
- **Aucun orchestrateur** : rien n'exécute les collecteurs dans l'ordre du scheduler
  `[42,45,53,30,28,54,29,…]`, ne mesure le `elapsed` de chacun, ni ne gère le
  remplacement d'un signal échoué par une valeur base64 aléatoire.

### 🔓 Résultat de reverse — `deriveKey` CRACKÉ

En analysant les 24 paires `code → key` du README, `deriveKey` est **entièrement résolu** :

```js
deriveKey(code) = 31 * code.charCodeAt(0) + code.charCodeAt(1)
```

C'est le `hashCode` Java d'une string de 2 caractères. Vérifié **24/24**, zéro erreur
(ex. `"wg"→3792`, `"21"→1599`, `"p1"→3521`, `"wq"→3802`, `"80"→1784`). Implémenté dans
`build_reload.js`.

`deriveSignalCode`, en revanche, **résiste** : hash non trivial (seed initial car `""→"80"`,
collisions `"AAAAAAAAAA"` et `"jYAQSHAEAI"` → `"1z"`). Approches testées et écartées :
djb2/java/sdbm/fnv/cyrb × base36/base62/`toString(36)`/`alph[h%L]` (L=16..64) × `hash%P`.
Nécessite la fonction JS déobfusquée réelle (25 exemples insuffisants pour l'inférer).

### 🔬 Tests de reverse du champ 16 (2 approches)

**#1 — Corpus `decrypted_values.json` ↔ `encrypted_values.json`** (~40 paires alignées)
- ✅ Cipher **par octet** : `len(ct) == len(pt)` après le préfixe `b` → **pas de seed runtime
  ajouté** → keystream **déterministe** dérivé de la clé (≠ cipher VM qui ajoute 4 octets).
- ✅ **XOR** confirmé sur le 1er octet (`key=3802` : `'0'` et `'4'` → `xor=86` constant).
- ❌ Le keystream n'est **pas** le LCG documenté (`94906238/13558035/13037` absents) et
  `k0(key)` n'a pas de forme close retrouvable depuis 40 points bruités. **Non cassé.**

**#2 — Script live `recaptcha__en.js`** (895 KB, version `TnA7Hac…`)
- ✅ Trouvé : `Bq=[277,4391,32779]` = LCG de déchiffrement du bytecode (identique à
  `recaptcha-vm/src/bytecode/mod.rs`) + golden ratio `2654435761`.
- ❌ **Absents en littéraux** : cipher de signaux, `deriveSignalCode`, scheduler `[42,45,53,…]`.
  → Ils vivent dans le **main bytecode construit dynamiquement** (conforme au README),
  extractibles seulement en exécutant/instrumentant la VM ou en déobfusquant le bytecode.

**Conclusion** : les 2 approches convergent — tout ce qui manque pour le champ 16
(`deriveSignalCode`, keystream du cipher, constantes) est verrouillé dans le bytecode
dynamique. `deriveKey` (`31*c0+c1`) reste le seul maillon cassé.

### 🛠️ Déobfuscation du bytecode (`disassembled.txt`) — routine 0x0091b9→0x009493

Reconstruite ligne par ligne (→ `oc_cipher.js`, roundtrip vérifié) :
```
R640 = Math.trunc(performance.now())
R640 = (R640 + 632) * 2654435761              // nonce runtime
state = (encKey ^ signalKey) ^ R640           // encKey = R586 = -940896859
state = ((state % M) + M) % M                 // M = 94906238
for (i=0; i<len; i++){ state=(state*13558035+13037)%M; data[i]=(data[i]+state)%256 }  // ADDITIF
// puis append du nonce sur 4 octets big-endian
```

**MAIS ce bytecode = le cipher `oc` / Idx 73, PAS le champ 16 :**
- Les clés XORées avec `R586` sont `2033,1422,545,727,360,150,779,417,1092,659,959,895,
  41,43,549,352,1278…` = **clés de signaux VM**, aucune clé `deriveKey` (31·c0+c1).
- Cipher **additif + seed ajouté** ≠ champ 16 qui est **XOR sans seed** (`key=3802`,
  `'0'`/`'4'` → xor constant 86, diffs 54≠46 → donc XOR, pas additif).
- Identique à `recaptcha-vm/src/encryption/mod.rs`.

➡️ `deriveSignalCode` + le cipher du champ 16 **ne sont pas dans le bytecode capturé** :
ils vivent dans une autre portion JS/bytecode non fournie par le repo. La déobfuscation
confirme donc le champ `oc` (reproductible) mais **pas** le champ 16.

### Niveau 3 — ❌ Manquant (bloquant pour un payload *accepté*)

| Pièce manquante | État dans les repos | Impact |
|---|---|---|
| `deriveSignalCode()` | README uniquement (exemples) — **non inférable** | **Cœur** de la dérivation de clé par signal |
| ~~`deriveKey()`~~ | ✅ **CRACKÉ** = `31*c0 + c1` | résolu |
| Chiffrement du **champ 16** (clé anchor idx 18) | Décrit en prose, pas de code JS | Impossible de produire le fingerprint chiffré |
| HMAC-SHA256(siteKey) pour Idx 4 | Décrit, pas de fichier | Signal 4 non régénérable directement |
| Schéma **protobuf** (`.proto`) | Numéros de champs documentés seulement | Sérialisation à recréer à la main |
| `X-Browser-Validation` (header) | Hors périmètre (secret Chrome) | Header d'intégrité requis côté HTTP |
| Token `/anchor` (champ 2) | Signé serveur | À obtenir légitimement, non générable |
| **Main bytecode** VM | Construit dynamiquement ; échantillon figé dans `assets/` | Change par session |
| Wrapping éventuel du champ 8 | Non documenté (observé sur live) | Évolution récente de structure |

### Verdict

- **« Chaque valeur contient quoi »** → 100 % documenté (voir §2, §3, §4).
- **« Régénérer chaque valeur isolément »** → ~90 % (tous les signaux ayant un `.js` + les
  briques VM en Rust).
- **« Assembler une requête `/reload` acceptée »** → **non** sans, au minimum :
  `deriveSignalCode`/`deriveKey`, le chiffrement du fingerprint (idx 16),
  le token anchor, et `X-Browser-Validation`.

---

## 10. État de l'art — reverse & approches « browserless »

### Écosystème des projets publics

| Projet | Contenu | Browserless ? | Portée |
|---|---|---|---|
| `elyelysiox/recaptcha` + `recaptcha-vm` | doc protocole + désassembleur/déchiffreur Rust | non (analyse) | fingerprint + VM `oc` |
| `dsekz/botguard-reverse` (Cypa) | désassembleur + décompilateur + gen token JS | **non** — l'auteur : *« you will need a browser emulator … it can only be generated if executed by a browser »* | BotGuard (`/reload`) |
| `tomkabel/google-botguard-security-research` | deep-dive archi VM BotGuard + bypass | **non** — stratégie « Puppet » via headless (go-rod) : *« steal the key, don't break the lock »* | BotGuard (login/YouTube) |
| `neuroradiology/InsideReCaptcha` (2014) | désassembleur/décompilateur `decomp.py` | non | ancienne VM (XTEA), historique |

**Consensus** : même les reversers les plus avancés (Cypa, tomkabel) **utilisent un
navigateur** (emulator ou headless). Aucun projet public ne génère browserless la version
actuelle de reCAPTCHA v3 Enterprise.

### Pourquoi le browserless pur échoue (confirmé par ces recherches)

1. **Self-modifying opcodes** — la VM construit ses opcodes à l'exécution → désassemblage
   statique = un seul état figé.
2. **Chronometric defense** — `performance.now()`/`Date.now()` mutent le seed.
3. **Anti-logger traps** — toute instrumentation décale les pointeurs et corrompt le flux.
4. **Polymorphisme** — structure + constantes changent à chaque version.

### Les 3 architectures possibles

| Approche | Chromium ? | Viabilité |
|---|---|---|
| Cacher un token généré par browser | oui, à chaque fois | ❌ tokens single-use, expirent (~120 s) |
| Réimplémenter toute la VM (interpréteur pur) | non | ❌ self-modifying + polymorphisme → non atteint publiquement |
| **Node + sandbox JS + shims** (exécuter le vrai JS dans `isolated-vm` avec `navigator`/`document`/`performance`/WebGL simulés) | pas de Chromium | 🟡 seul vrai « browserless », dur, à maintenir |

**Prérequis commun** : le *main bytecode* du fingerprint est **construit dynamiquement dans
le JS** (jamais servi par un endpoint) → une **exécution JS initiale** est nécessaire pour
le capturer avant tout reverse.

Sources : [dsekz/botguard-reverse](https://github.com/dsekz/botguard-reverse),
[tomkabel/google-botguard-security-research](https://github.com/tomkabel/google-botguard-security-research),
[neuroradiology/InsideReCaptcha](https://github.com/neuroradiology/InsideReCaptcha).
