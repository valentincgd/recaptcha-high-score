# Reverse field16 pur exact — état & plan (le cost-killer)

But : produire un **field16 exact SANS jsdom** → génération CPU quasi nulle → 500/s sur ~85 IPs au lieu de ~125 cœurs. Le pur actuel (`VmPureReloadBuilder`) est TM-KO ; il faut fermer l'écart avec le vrai script.

## Acquis VÉRIFIÉS (2026-07-18)

1. **hashString = EXACT** — `h = 31*h + c` (Java hashCode, 32-bit signé), seed = param. **Vérifié 767/767** contre les captures réelles (`scripts/hash_calls.json`). C'est le cœur de `deriveSignalCode` et `deriveKey`. Impl : `api/HashUtil.js`.
   - `deriveKey` : `hashString(code2char, 0)` (ex "tc"→3695).
   - `deriveSignalCode` : `hashString(value, seed)` puis encodage base36 2-char (voir `tools/crack_dsc.js`).

2. **Cipher field16 = stream cipher LCG** (capturé via `tools/capture_cipher.js` → `scripts/cipher_captures.json`) :
   - PRNG = LCG dans `y5` : `A = (D·A + w) % d ; return A/d` (normalisé [0,1)).
   - keystream : `floor( lcg() · Mt[r] ) % w`, table **`Mt = [277, 4391, 32779]`**.
   - cipher = `ciphertext = plaintext XOR keystream` (ks même longueur que pt).
   - 3 appels par run (D=238 / 77 / 1). Les params LCG (D,w,d,seed) sont dérivables des séquences ks capturées.

3. **Plaintext capturable** : `__cc(pt, ks, w, r, D, genSrc)` via `recaptcha_instrumented.js` (servi avec `RC_CIPHER_CAP=1`). Donne le plaintext RÉEL avant chiffrement → ground truth pour le diff.

## Méthode de diff (déterministe) — prochaine étape

Le pur passe déjà le `/reload` de Google (structure OK) mais TM rejette → l'écart est dans le **CONTENU des signaux** (valeurs/fingerprint → score), pas le cipher.

1. Lancer `capture_cipher.js` (RC_CIPHER_CAP) sur une session → dumper le **plaintext réel** du blob field16 (identifier lequel des 3 appels correspond au field16 : ~2,6KB après base64 ; les 17KB/92KB sont coverage/worker).
2. Instrumenter `VmPureReloadBuilder` pour dumper son **plaintext** (avant `EnterpriseBlobEncoder`).
3. **Differ signal par signal** (les deux plaintexts sont des streams de `[signalCode, valeur]`) → localiser les signaux manquants/faux.
4. Corriger le collecteur pur (`Collectors`/`ExtendedCollectors`/`FingerprintArrayBuilder`) jusqu'à égalité du plaintext.
5. Reproduire le cipher exact (LCG params + Mt) → field16 byte-exact.
6. Valider : replay event-page **proxyless** doit passer comme jsdom (test de §5 SCALING.md).

## Outils de reverse présents (`vendor/rcjsdom/tools/`)
`capture_cipher.js` (dump cipher+hash), `crack_dsc.js`/`match_dsc.js` (encodage deriveSignalCode), `decode_stream.js` (décode le stream de signaux), `analyze_field16_cipher.js`, `decrypt_hf.js`, `deob_*.js` (déobfuscation). Captures : `scripts/cipher_captures.json`, `scripts/hash_calls.json`, `scripts/keystream_gen.txt`, `scripts/last_field16.json`.

## ★ CAUSE RACINE TROUVÉE (2026-07-18) : énumération d'environnement manquante

Comparaison des signaux réels (capturés) vs pur :
- **Pur** : **30 signaux** (field16 inner = 1571 o). Uniquement des signaux de VALEUR à clé fixe (UA=417, referer/origin=1641, webgl=1310, innerWidth=352, …) via `Collectors`/`ExtendedCollectors`.
- **Réel** : **762 signaux** (field16 ≈ 2670 o). Les ~730 en plus = **énumération des noms de propriétés de `window`/`globalThis`** (parseFloat, String, Symbol, RTC*, WebGL*, Audio*, USB, XR*, …) + propriétés internes jsdom (`_resourceLoader`, `_virtualConsole`, `_runScripts`, `_globalObject`…) + IDs DOM (t1..t6, g-recaptcha-response…) + ~12 clés obfusquées de session.

C'est **l'énumération d'environnement** qui constitue le fingerprint scoré par TM. Le pur ne l'émet PAS → fingerprint pauvre → TM rejette (mais Google parse quand même → /reload 200). NB surprenant : la liste réelle contient les fuites internes de jsdom (`_`-props) et **passe quand même TM** → répliquer la sortie jsdom suffit (pas besoin d'un vrai Chrome).

Données : les 762 noms + leurs hashes sont dans `scripts/hash_calls.json` (seed=0). deriveSignalCode(name) = encode(hashString(name,0)) — hash exact, encodage 2-char dans `tools/crack_dsc.js`/`match_dsc.js`.

## Plan de build (reconstruire l'énumération dans le pur)
1. Extraire de `hash_calls.json` la liste ordonnée des ~730 noms d'énumération (constants) vs les ~30 valeurs à clé fixe (déjà faites) vs les clés de session (variables, dérivées de l'anchor/config).
2. Résoudre l'encodage deriveSignalCode (hash 32-bit → signalKey) via crack_dsc/match_dsc.
3. Ajouter un `EnvEnumerationCollector` au pur : pour chaque nom, émettre {plaintext, signalKey=deriveSignalCode(name)}. Cible : signalCount ~762, field16 ~2670 o.
4. Résoudre le plaintext exact de chaque signal d'énumération (présence/valeur) — nécessite de décrypter le field16 réel (poser le hook cipher sur le BON appel, pas les 3 actuels qui sont coverage/worker/05AL).
5. Valider : field16 taille ≈ réel + replay event-page **proxyless** PASS comme jsdom.

## Hook field16 — reconnaissance (2026-07-18, session 2)

Objectif : capturer le plaintext du field16 (débloque signalKeys + contenu enumeration).

Découvertes :
- **field16 réel = blob chiffré EN BLOC** : décodé (base64url) = 2670 o de **haute entropie, PAS de chunks 0x62** (distribution d'octets plate). ≠ structure du pur (chunks 0x62 visibles) — mais les DEUX passent le parse de Google.
- **Le cipher du field16 n'est PAS celui hooké par `__cc`** (ligne 147, m[32]) : ce dernier chiffre 3 blobs (17KB coverage / 12B / 92KB worker-05AL) — aucun ≈ 2670 o. C'est une **4ᵉ fonction cipher distincte, non localisée**.
- `__cc2` (ligne 2616) capture bien les **762 valeurs de signaux** (`String(r)`) + hash → on a le CONTENU, pas la disposition chiffrée.
- Infra localisée dans `recaptcha_pretty.js` : table base64 `UJ` = `["+/=","+/","-_=","-_.","-_"]` (~ligne 5631) ; primitive LCG `N=()=>{A=(D*A+w)%d; return A/d}` (~ligne 5625).

PROCHAIN PAS (déobfuscation dédiée) : générer une variante instrumentée qui hooke l'**encodeur base64url** (input = ciphertext field16 ~2670 o) + logge la **stack du caller** → remonter à la fonction cipher du field16, puis hooker son plaintext. Nécessite de patcher le script (outils deob_*.js) + une session de reverse manuel. Sans validation TM (IP propre) en parallèle.

## Hook field16 — session 3 (2026-07-18) : findings majeurs

Infra de hook construite : `tools/capture_field16.js` (patche recaptcha_pretty.js → recaptcha_hooked.js, injecte `self.__b64` dans l'encodeur base64 ligne 299) + canal `__b64` câblé dans `field16_jsdom.js` (~910) et `tools/shims.js` (~717, worker). `recaptcha_pretty.js` est **exécutable** (produit token+field16, reload 200) → servable via `RC_SCRIPT_FILE` pour instrumenter.

Découvertes :
1. **field16 n'est PAS base64-encodé par le script** : ce sont des **octets chiffrés bruts** dans le protobuf field 16. (Le "field16" b64 de last_field16.json = MON harnais qui encode les octets bruts.) → le hook b64 (70 appels : anchor/05AL/autres) ne voit PAS field16.
2. **Google ACCEPTE le pur** (/reload 200) → Google décrypte et valide l'encodage/cipher du pur. **Donc PAS besoin de reverser le cipher field16** : il suffit d'AJOUTER le contenu manquant via l'encodage existant du pur.
3. **Le gap n'est PAS 730 signaux séparés** : +1075 o pour ~730 propriétés = ~1,5 o/propriété → l'énumération d'environnement est un **blob COMPACT** (probable bitmap de présence + hash(s) agrégé(s)), pas des chunks séparés. Plus tractable.
4. **hashString exact** (revérifié). L'**encodage `deriveSignalCode` (hash→code) est construit dynamiquement depuis le config bytecode** (result.md §9/§10) = le crux irréductible.

Prochain pas : reconstruire le blob compact d'énumération. Deux voies : (a) décrypter le field16 réel pour voir le format exact (nécessite localiser son cipher — opcodes m[32] 16/18/19, cf. ligne 4543 `.xor()`), ou (b) interpréter le config bytecode pour l'encodage deriveSignalCode (VmBytecodeRunner). Puis émettre ce blob dans VmPureReloadBuilder (encodage pur déjà accepté par Google) et valider proxyless.

## ⚠️ Résultat négatif clé (2026-07-18, session 3) : le contenu seul ne suffit PAS

Expérience : injecté les 523 valeurs d'énumération capturées dans `VmPureReloadBuilder` (via `Collectors` + `RC_ENUM=1`, données `scripts/env_enum.json`, signalKey=`hash%2048`, plaintext=valeur). Résultat :
- pur enrichi = 541 signaux, field16 = 24 KB (vs réel 2,6 KB), **/reload accepté par Google (score démo 0.9)**.
- Test TM **proxyless, IP propre** (contrôle jsdom = PASS 2/2 au même instant) : **pur ENUM=0 ET ENUM=1 = BLOCK 403 (0/3)**.

**Conclusion** : ajouter le contenu d'énumération ne fait PAS passer TM. Donc TM ne score pas la simple présence des signaux — il valide vraisemblablement l'**encodage/structure EXACTE** : signalKeys = `deriveSignalCode(name)` (encodage dynamique, PAS `hash%2048`) + format COMPACT (pas des chunks de 44 o/signal → réel = 1,5 o/signal). Le field16 24 KB anormal peut aussi flagger.

⇒ Pas de raccourci par le contenu. Il faut l'**encodage deriveSignalCode exact** (construit dynamiquement depuis le config bytecode) + le **format compact** du blob d'énumération. C'est le crux : interpréter le config bytecode (`VmBytecodeRunner`) pour reproduire deriveSignalCode. Reverse VM dédié, multi-sessions.

Note : le code d'injection reste (guardé par `RC_ENUM`, off par défaut → prod intacte) pour de futures expériences avec le bon encodage.

## ★★ deriveSignalCode CRACKÉ (2026-07-18, session 4) — vérifié 349/349

CE N'EST PAS une table/permutation (théorie précédente réfutée). C'est **arithmétique fixe** :
```js
deriveSignalCode(w, seed):                    // seed CHAÎNÉ = résultat de l'appel précédent
  d = (typeof w === "number") ? (w+seed)|0 : hashString(w, seed)   // seed = 2e arg de hashString
  d = (d>>16 ^ d) * 2642172555     // multiply FLOTTANT (PAS Math.imul ; ToInt32 via >> ensuite)
  d = (d>>16 ^ d) * 2642172555
  return d>>16 ^ d                 // int32 = signalKey
```
Const `2642172555` en dur (recaptcha_pretty.js:5180). 243 string-path + 106 numeric-path = **349/349 exact**.
Implémenté : `api/vm/DeriveSignalCode.js` (vérifié). Capture : `tools/capture_dsc.js` (hook `__dsc`).

## Ce qui reste : la SÉQUENCE de valeurs

deriveSignalCode = la fonction KEY, résolue. MAIS field16 = deriveSignalCode appliqué à une **séquence ORDONNÉE de valeurs** avec seed CHAÎNÉ. Il faut donc reproduire la séquence exacte des valeurs collectées (énumération window/globalThis constante + mesures dynamiques + stacks). C'est essentiellement reproduire la collecte de fingerprint de jsdom à l'identique. Défi séparé, substantiel, mais deriveSignalCode (le verrou crypto) est levé.

## ★★★ CHAMP 22 CRACKÉ (session 6) — Bloom filter reproduit BIT-EXACT (2810/2810 octets)

Découverte : le champ 22 du /reload (PAS le 16) = un **Bloom filter** (classe Ot, ~19254) de l'énumération d'environnement. Reproduit exactement (voir mémoire field22-bloom-cracked) :
- Ot.D = 22480 bits (2810 o), densité ~17% (sparse = bloom confirmé).
- 319 valeurs (parseFloat, String, Symbol, RTC*, WebGL*, fuites jsdom _resourceLoader…).
- Par valeur : seed=Math.abs(hashString(value)), LCG(1664525, 1013904223, 2^32), 13 bits (N=lcg%22480).
- field22 = P + base64_M5(Ot.D). Repro = 2810/2810 octets identiques, 2176 bits set = 2176. ✅
- Outils : tools/capture_bloom.js (hooks Ot.add/toString).

### ✅ Générateur champ 22 LIVRÉ : api/vm/Field22Bloom.js
`Field22Bloom.build(values)` → string champ 22 EXACTE (vérifié 3748/3748 chars identiques). M5=base64 standard "+/", préfixe "B", sans padding. Input = liste des ~319 valeurs d'énumération (constantes JS globals + ~11 session : DOM ids t1-t6/boxes_container/be, g-recaptcha-response-N, a-<random>, location). Défaut dans api/vm/field22_enum_values.json.

## ★★★ CHAMP 16 CIPHER CRACKÉ via node:inspector (debugger en code)

Le hooking a échoué (~28 essais) mais un **debugger programmatique `node:inspector`** (breakpoints CDP conditionnels + evaluateOnCallFrame) a tout craqué. `tools/debug_field16.js`.
- Pipeline localisé : plaintext U (tableau JSON de signaux) → J[46](UTF8) → v[44] opcode 26 (cipher) → base64 ligne 300 (+ préfixe "0" ligne 4844) → field16.
- **Cipher (vérifié byte-exact 2736/2736, encrypt+decrypt)** : `field16="0"+base64url([A, ...cipher])`, `A`=nonce aléatoire préfixé, `cipher[i]=(D[i]+D.length+(d+A)*(i+A))%256`, `D`=UTF8(plaintext), `d=DC%1E6`.
- **DC non-issue** : seul (d+A)%256 compte, et field16 est SELF-DECRYPTING (Google récupère (d+A)%256 du préfixe connu `[null,null,null,null,"`). DC libre (Date.now()).
- Impl : `api/vm/Field16Cipher.js` (encrypt+decrypt).
- Plaintext = `[null×4,"<4hex>",1,null×10,["<40c>"],1,"<b64>",...,["<value>",key1,key2]×N,...,[[["Not;A=Brand","8"],["Chromium","150"],["Google Chrome","150"]],0,"Windows"],...]`.

TOUT le crypto field16/field22 est cracké. RESTE : reproduire le tableau plaintext de signaux (contenu fingerprint + signalKeys via deriveSignalCode). Débloqué par l'inspector.

## Champ 16 — ~26 hooks essayés, builder introuvable (avant inspector)
field16 = base64url d'un blob CHIFFRÉ (~2660 o, densité 48.8%, préfixe "0"), posé sur le message protobuf et sérialisé. ÉLIMINÉ / ESSAYÉ sans succès : encodeurs base64 (300 UJ, Ot/19256 M5=champ22, 7578 btoa/a[25], 19692 scrypt), ciphers (__cc op17, opcodes 16/18/19, scrypt), Array.join (main+worker), Uint8Array alloc ~2660 (main+worker, seul 2810=bloom champ22), sérialiseur tag 130 (générique, mauvais message), correlation avec les 349 deriveSignalCode outputs (0 match → chiffré). Le builder du champ 16 (cipher+base64) évite TOUS les hooks standards → probablement string char-par-char dans le worker + closure-protobuf. NÉCESSITE un debugger pas-à-pas ou demux complet du dispatch (multi-jours). C'est le cœur durci de reCAPTCHA (raison d'être de jsdom).

## Champ 16 : chiffré (densité 48.8% ≈ aléatoire) — cipher toujours non localisé
field16 (2708 o décodés, densité bits 48.8% = uniforme/chiffré, hex d1f66dd1…) ≠ bloom. C'est le stream de signaux CHIFFRÉ. Son cipher n'est pas Ot, pas __cc (op17), pas scrypt. Reste le dernier verrou.

## Plongée code (session 6) — crypto identifiée, cipher field16 toujours non localisé

Lecture du code déobfusqué (recaptcha_pretty.js) :
- **Région 19540-19730 = scrypt** (messages "scrypt: N parameter…", `ja`=PBKDF2 ipad/opad 0x36/0x5c, Salsa20/8 core à 19590 = BlockMix scrypt `d<8`). C'est un KDF standard (challenge PoW), **PAS le cipher field16** — fausse piste.
- **Ligne 3810 = MD5/SHA1** (constantes 0x67452301, 0xEFCDAB89…). Hash standard.
- field16 décodé = **haute entropie dès l'octet 0** (`d1bf4532…`), NE parse PAS en protobuf → genuinement chiffré, pas un stream clair.

Éliminés pour le cipher field16 : cipher `__cc` (opcode 17, 3 blobs ≠ 2655o), opcodes 16/18/19 (RNG/hash), encodeurs base64 (300, 19692), compression (zlib/gzip/brotli KO), scrypt, protobuf-clair. Le cipher field16 reste **non localisé**.

## Piste 1 — localisation du pipeline field16 (session 5, en cours)

Objectif : capturer le plaintext du field16. Résultats :
- **Piste 2 (décrypt) = bloquée** : field16 réel = bloc chiffré (pas de chunks 0x62), le SignalEncryptor pur est par-signal → incompatible ; cipher+clé réels inconnus.
- `pb.extractField16` renvoie le champ 16 en UTF8 = une **string base64url** (~3540c → ~2655 o chiffrés). Donc le script base64-encode field16.
- **MAIS** : le hook sur l'encodeur base64 principal (ligne 300, UJ) = 79 appels, **aucun input de ~2655 o** → field16 ne passe PAS par cet encodeur. Ni par le 2e (ligne 19692, standard +/=). Ni par le cipher `__cc` (3 blobs 17K/12B/92K).
- ⇒ Le pipeline field16 (cipher + base64) est ailleurs dans le dispatch obfusqué (peut-être worker, ou routine inline custom). Non localisé malgré hooks b64 (window+worker) + match calculé.

Outils créés : `tools/capture_field16.js` (hook b64 + match), `tools/capture_dsc.js` (hook deriveSignalCode). Canaux `__b64`/`__dsc` câblés (field16_jsdom ~910, shims ~717).

Stack du send /reload capturée (RC_RELOAD_STACK=1) : chaîne VM = send(14318) ← 5881:210 ← FP.<anonymous>(6370:340) ← X.Sr(16604) ← s_(7102) ← X.hY(16506) ← X.XZ(16504) ← X.send(16613). Le body est déjà assemblé à ce point. Les fonctions candidates du builder field16 = ~6370, ~16604, ~5881 (dans recaptcha_pretty.js).

PROCHAIN PAS = LECTURE déobfusquée des fonctions 6370/16604/5881 pour trouver où field16 (cipher + base64) est assemblé, PUIS hooker précisément. Le hooking aveugle ne converge pas (cipher pas dans opcodes 16/17/18/19 testés, ni encodeurs b64 300/19692). C'est de la lecture de code obfusqué, multi-sessions. Outils deob_*.js pour demux le dispatch.

## ✅ CORRECTION (session 5) : le self-stack-hashing EST reproductible

Le verdict "impossible" ci-dessous était FAUX. Test : 2 captures dsc du même profil → **348/349 valeurs IDENTIQUES**, seule #0 diffère (`6215.9287` vs `6310.4227` = performance.now(), timing). Les stack traces, 586, 1, etc. sont CONSTANTS par version de script. Donc reproductible : capturer la séquence une fois par version + gérer le seul timing dynamique + la clé anchor par session. La stratégie (utilisateur) : hooker la génération pour CETTE version → hardcoder le constant → reproduire. Approche valide.

Reste à capturer : la composition EXACTE du field16 (quels signaux, ordre, encodage/cipher) — localiser la sérialisation du stream (dispatch obfusqué) ou le cipher field16 (≠ __cc, prob. opcode m[32] 16/18/19). Puis reproduire + valider proxyless.

## ⛔ (obsolète, corrigé ci-dessus) Verdict "final" session 4 : le field16 hashe ses propres STACK TRACES

Le hook `__dsc` (349 appels deriveSignalCode) révèle que le contenu est dominé par le **hachage des STACK TRACES d'exécution du script lui-même** (`at v5.<anonymous> (https://www.gstatic.com/recaptcha/releases/<ver>/recaptcha__*.js:LIGNE:COL)`) + un motif d'intégrité répété (586,586,1). C'est de l'**anti-reimplémentation auto-référentiel** : le field16 dépend des noms de fonctions obfusqués, numéros de ligne/colonne, et de l'ordre d'appel du VRAI script.

**Conséquence** : on ne peut PAS reproduire le field16 en réimplémentant la logique — il faut EXÉCUTER le vrai script (ses stacks font partie du fingerprint). Les primitives crypto sont cassées (hashString ✅, deriveSignalCode ✅ 349/349) mais **le contenu exige les stack traces du script réel**, irreproductibles à la main.

⇒ Conclusion définitive et étayée : **le field16 exact nécessite d'exécuter le vrai recaptcha__*.js** (jsdom OU vm léger le servant). Pas de réimplémentation pure possible (défense anti-reimplémentation par self-stack-hashing). Le seul axe d'optimisation reste le **vm léger** (exécuter le vrai script sans jsdom) — estimé ~1,5-2× (§5bis), pas 10×. Le plancher CPU (~4 tok/s/cœur) tient. Voir SCALING.md : 500/s = fleet jsdom ~125 cœurs, OU vm léger ~65-80 cœurs (gros chantier, gain modeste).

## Estimation
Reste : mapper tous les signaux du plaintext + reproduire le cipher exact. Substantiel (plusieurs sessions) mais **la voie est tracée et déterministe** (plaintext réel capturable + hash déjà exact). Si abouti → génération 500/s ~10× moins chère que le fleet jsdom.
