# Plan de reverse complet — field16 100% généré (zéro hardcode, zéro template)

Objectif : générer le body /reload entièrement en JS pur, chaque octet calculé depuis
la session vivante (anchor, encryptionKey, timings, état navigateur simulé). Aucun
template mort, aucune valeur figée. Cible : event-page + quickpicks en 200.

Statuts : FAIT = reversé et vérifié byte-exact. A REVERSER = pas encore. PARTIEL = crypto
faite mais contenu encore issu d'un template.

Outils de reverse disponibles (établis cette session) :
- node:inspector en code (CDP) : Debugger.setBreakpointByUrl (avec condition), Debugger.paused,
  Debugger.evaluateOnCallFrame, Runtime.getProperties. C'est ce qui a cassé les ciphers.
- Canaux de hook injectables dans la window jsdom (__dsc, __cc, __b64, __bloomAdd, __f16enc...).
- Source lisible scripts/recaptcha_pretty.js (embellie) exécutable via RC_SCRIPT_FILE.
- Ciphers reversés (Field16Cipher, PerSignalCipher) pour décrypter n'importe quel field16 capturé.

---

## PHASE 0 — Infrastructure de reverse (prérequis à tout)

- [ ] 0.1 Instrumenter la construction du tableau field16 (les 79 slots) AVANT le chiffrement.
  Méthode : dans recaptcha_pretty.js, le tableau plaintext U est sérialisé puis chiffré à la
  ligne 17854 (opcode 26 du cipher externe). Poser un breakpoint node:inspector à 17854,
  capturer U complet (evaluateOnCallFrame) + un timestamp. On a déjà U dans field16_pipeline.json,
  mais il faut le capturer AVEC la correspondance slot -> fonction productrice.
- [ ] 0.2 Localiser la coroutine de collecte. La pile au cipher par-signal (L[40]@6760) remonte
  6760 <- 802 <- 5883 <- 1457 <- 322(driver coroutine) <- 3133(f.next) <- 2917 <- 2913(Promise).
  Donc les valeurs sont produites par une coroutine async (generator) drainée par le driver 320-324.
  Méthode : poser un breakpoint DANS le corps de la coroutine (pas le driver) en cherchant les
  yield. Identifier chaque fonction collectrice appelée entre deux yields.
- [ ] 0.3 Construire un mapping slot -> (fonction productrice, données lues, transformation).
  Méthode : pour chaque slot dynamique, breakpoint conditionnel sur la valeur produite ;
  à l'arrêt, remonter la pile (callFrames) jusqu'à la fonction collectrice réelle, dumper ses
  arguments et les objets window/navigator/performance lus (Runtime.getProperties).
- [ ] 0.4 Harnais de vérification byte-exact : pour chaque signal reversé, comparer octet-à-octet
  la sortie de mon impl JS pur vs la valeur jsdom réelle capturée, sur 3 sessions différentes.

---

## PHASE 1 — Champs top-level du /reload

### Champ 1 (version) — FAIT
- [x] Récupéré du bootstrap /enterprise.js. Rien à faire.

### Champ 2 (anchorToken) — FAIT (obtenu, pas généré)
- [x] GET /anchor -> AnchorParser. C'est un token serveur, non générable par design ; on le récupère
  en HTTP pur. Rien à hardcoder.

### Champ 5 (fingerprintHash) — FAIT
- [x] hashString(JSON(field16_plaintext)). Recalculé à la volée depuis mon field16. Vérifié exact.

### Champ 6 (challengeType) — FAIT
- [x] "q" (constante du protocole, pas un hardcode de valeur session).

### Champ 7 (secondaryToken 05AL) — A REVERSER (si un flux le requiert)
- [ ] 7.1 Déterminer si event/quickpicks l'exigent. Constat actuel : absent du flat, et event/quickpicks
  bloquent pour une autre raison (field16). A confirmer une fois field16 réglé.
- [ ] 7.2 Si requis : c'est un SEND de la VM bytecode de l'anchor. Reverser via node:inspector en
  capturant l'argument du postMessage/SEND qui produit la string 05AL (RecaptchaVmRunner/VmBytecodeRunner
  existent déjà comme point de départ). Le 05AL encode un sous-message (8=action,14=sitekey,2088=blob).

### Champ 8 (action), 14 (siteKey), 28 (anchorMs), 29 (executeMs) — FAIT
- [x] Inputs / constantes protocolaires.

### Champ 20 (telemetry) — FAIT (généré dynamiquement)
- [x] Structure reversée, Field20Telemetry génère des valeurs perf fraîches plausibles.
- [ ] 20.1 (durcissement) Vérifier que les valeurs perf (long task, cpu ms) tombent dans les plages
  exactes observées sur N captures réelles, et que arr[4][1] (scriptCount) suit la vraie règle
  (constant 317 observé — vérifier s'il dépend du nb de scripts chargés).

### Champ 21 (auxToken 0aAL) — A REVERSER (si requis)
- [ ] 21.1 Même approche que 7.2 (dérivé VM/session). A confirmer nécessité.

### Champ 22 (bloom) — PARTIEL
- [x] Algo bit-exact (Field22Bloom).
- [ ] 22.1 Générer la liste d'énumération d'environnement DYNAMIQUEMENT (pas le JSON figé).
  Méthode : hooker Ot.add (déjà repéré, canal __bloomAdd) pour capturer l'ordre exact des ~319
  valeurs énumérées par le script (noms de propriétés navigator/window testées). Reproduire cette
  énumération en JS depuis le profil (les propriétés présentes dépendent du navigateur simulé).

---

## PHASE 2 — Champ 16 : couches crypto — FAIT (tout vérifié)

- [x] Cipher externe Field16Cipher (encrypt/decrypt byte-exact)
- [x] base64url + préfixe "0"
- [x] Cipher par-signal L[40] = valeur XOR tile(keystream)
- [x] Keystream g[37] (chunks -> h38 chaîné -> Fisher-Yates)
- [x] h[38] (hash, table [3,6,4,11]), h[16] (XOR), y[5] (LCG), J[22] (shuffle)
- [x] Clé par-signal (nonce transmis / ID de type de signal)
- Rien à faire ici : toute la crypto du field16 est reversée.

---

## PHASE 3 — Champ 16 : structure des 79 slots (rendre 100% généré)

### Slots fixes (0-3, 5, 6-15, 17, 19-26) — FAIT
- [x] Constantes structurelles (null / 1). Générées.

### Slot 4 (id 4-hex), 18 (id session), 64 (compteur) — FAIT (générés)
- [x] Régénérés frais.
- [ ] 3.1 Vérifier la LOI de génération réelle : slot 4 est-il vraiment random ou dérivé ?
  slot 64 (compteur ~5800-6400) : reverser la règle d'incrément (probable nb d'événements/opérations
  cumulées pendant la collecte). Hook du compteur dans la coroutine.

### Slot 16 (blob ["SFCjYhyQ…"] 40 chars) — A REVERSER
- [ ] 3.2 Identifier la source. 40 chars base64 = 30 octets. Probable : ID d'instance / clé dérivée
  de la session (encryptionKey ou anchor). Méthode : capturer ce blob sur 2 sessions, décoder le b64,
  comparer aux bits de l'encryptionKey/anchor. Si dérivé -> reproduire la dérivation ; si random ->
  générer 30 octets aléatoires au bon format.

### Slots 27-38 (12 signaux device) — A REVERSER (actuellement verbatim template)
- [ ] 3.3 Ce sont des stacks d'erreurs + compteurs, STABLES par (version script, navigateur simulé).
  Pour ne rien hardcoder : reverser leur génération.
  Méthode par signal : node:inspector, breakpoint là où chaque valeur est poussée ; identifier
  l'erreur lancée et la stack lue (Error().stack), + les compteurs. Reproduire en JS :
  - Stacks : construire des stacks V8 au format exact du script courant (noms de fonctions obfusqués
    extraits en parsant scripts/recaptcha__xx.js de la version, + lignes:colonnes). Node produit des
    stacks V8 comme Chrome -> format compatible.
  - Compteurs/petits ints : reproduire la logique de comptage.

### Slots 39-78 (mix) — voir PHASE 4 pour les dynamiques
- [x] IDs session "C" (66,67,69,70,71,75) : régénérés.
- [ ] 3.4 Slot 72 (userAgentData) : FAIT depuis profil, mais vérifier le format exact des brands
  (ordre, "Not;A=Brand" vs "Not/A)Brand" selon version) -> dériver de la version Chrome du profil.
- [ ] 3.5 Slot 73 (tableau imbriqué) : décoder sa structure, identifier ce qu'il encode
  (probable client hints étendus / userAgentData high-entropy). Générer depuis le profil.
- [ ] 3.6 Slot 77 (présence variable null/triple) : reverser la CONDITION de présence.
  Méthode : capturer sur N sessions quand il est présent vs null ; corréler avec un événement
  de la collecte (probable : un signal optionnel déclenché par une condition d'environnement).

---

## PHASE 4 — LE BLOQUEUR : signaux hash-like dynamiques session-bound

Slots concernés : 39, 41, 42, 50, 51, 55, 58, 68, 78.
Ce sont des hashes/sérialisations de l'état d'exécution live, liés à la session (le test verbatim
prouve : même les valeurs correctes de jsdom échouent avec un anchor frais). C'est le coeur anti-bot.
Approche générale : réimplémenter le moteur de collecte (la coroutine) en JS pur, OU reverser chaque
signal individuellement jusqu'à pouvoir le regénérer frais et cohérent avec la session courante.

### 4.0 Cartographier la coroutine de collecte (prérequis PHASE 4)
- [ ] Suivre la coroutine (driver 320-324) pas à pas via node:inspector : lister chaque fonction
  collectrice appelée, dans l'ordre, entre les yields. Produire une carte "ordre -> signal -> slot".
- [ ] Pour chaque signal, noter : donnée source (API navigateur lue), transformation (hash/serial),
  clé de chiffrement utilisée, et le lien éventuel à la session (encryptionKey/anchor/timing).

### 4.1 Slot 55 (397 octets, 98% statique) — le plus proche
- [ ] Diff sur N sessions : seulement 8 octets varient (positions 44,67,73,108,163,229,322,369).
  Identifier ce que chacun de ces 8 octets encode (probable octets de poids faible de timings/compteurs).
  Méthode : capturer slot 55 + les timings/compteurs de la session, corréler chaque octet variable.
  Puis générer les 389 octets fixes (structure du signal, reversée une fois) + injecter les 8 octets
  dynamiques calculés depuis la session.

### 4.2 Slots 41 (2o), 51 (5o), 58 (7-21o) — petits signaux live
- [ ] Reverser chacun : breakpoint sur sa production, identifier la donnée (probable : petits
  compteurs, flags d'environnement, ou octets de timing). Reproduire la formule.
  51 : 3 octets fixes / 2 variables -> les 3 fixes = template du signal, les 2 = valeur live.
  58 : longueur variable -> encode une liste/séquence dont la taille dépend de l'exécution.

### 4.3 Slots 39 (59o), 50 (58o), 68 (27o), 78 (28o) — hash-like haute entropie
- [ ] Pour chacun : déterminer si c'est un hash (de quoi) ou une sérialisation chiffrée.
  Méthode : breakpoint sur la production ; capturer l'INPUT juste avant le hash/serial ;
  identifier la fonction de hash (comparer à hashString/deriveSignalCode/un digest custom déjà connu).
  Si l'input est de l'état live (timings, séquence d'événements, résultats de tests d'environnement),
  reproduire cet état en JS pur puis appliquer la même transformation.
- [ ] Vérifier le lien session : ces hashes intègrent-ils l'encryptionKey/anchor ? Si oui, la
  dérivation doit prendre ces valeurs de la session courante (pas du template).

### 4.4 Réimplémentation et intégration
- [ ] Écrire un module Field16Collector.js (JS pur) qui, depuis {profil, anchor, encryptionKey,
  timings simulés}, produit les 79 slots entièrement calculés.
- [ ] Remplacer le template dans Field16Builder par ce collector (plus aucun slot verbatim).
- [ ] Vérif byte-exact vs jsdom sur 3 sessions, puis test event/quickpicks -> 200.

---

## PHASE 5 — Génération de l'énumération et des états navigateur (support PHASE 4)

Pour que les signaux soient cohérents sans hardcode, il faut un modèle navigateur généré depuis le profil.
- [ ] 5.1 Modèle navigateur pur : navigator/screen/window/performance dérivés du profil fingerprints.json
  (déjà partiellement dans PureBrowserEnvironment/BrowserSimulator — auditer et compléter).
- [ ] 5.2 Générateur de stacks V8 : parser le script de la version courante pour extraire les noms de
  fonctions et offsets, construire des stacks au format exact attendu par chaque signal.
- [ ] 5.3 Modèle temporel : timeline anchor->execute->reload cohérente (performance.now simulé),
  alimentant tous les signaux de timing.

---

## PHASE 6 — Validation finale

- [ ] 6.1 Générer 20 tokens, 0 hardcode, profils tournants -> event-page 20/20 en 200.
- [ ] 6.2 quickpicks (nécessite chaînage cookies BID/SID via GET event page d'abord) -> 200.
- [ ] 6.3 Débit : mesurer tok/s en pur (cible 500/s -> dimensionner).
- [ ] 6.4 Robustesse version : script qui re-extrait automatiquement les éléments version-spécifiques
  (noms obfusqués, offsets) à chaque changement de version Google, pour ne rien re-hardcoder.

---

## Ordre d'exécution recommandé

1. PHASE 0 (infra) — indispensable, débloque tout le reste.
2. PHASE 4.0 (carte coroutine) + 4.1 (slot 55, le plus simple) pour prouver la voie.
3. PHASE 4.2 -> 4.3 (les hash-like), avec PHASE 5 en support.
4. PHASE 3.3 (device 27-38) et 3.2/3.5/3.6 (slots 16/73/77).
5. PHASE 4.4 (intégration Field16Collector) puis PHASE 6 (validation event/quickpicks).
6. PHASE 1 (champs 7/21) seulement si la validation montre qu'ils sont requis.
