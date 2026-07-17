# VM reCAPTCHA — de A à Z

## 1. Ce n’est pas `recaptcha__fr.js` en entier

| Couche | Fichier / lieu | Rôle |
|--------|----------------|------|
| JS obfusqué | `recaptcha__fr.js` (~800k lignes) | Chargeur, anchor `Main.init`, réseau |
| **Bytecode config** | `init` anchor → souvent **bgdata[4]** (~35k b64) | VM **statique** : clé LCG, registres signal |
| **Bytecode main** | Construit **à l’exécution** dans le navigateur | Fingerprints, blob champ 16, token **05AL** |

Le repo `recaptcha-vm-main/` désassemble le **format** d’instructions (LOAD_CONST, SEND, …), pas tout le JS.

## 2. Pipeline HTTP pur (`VmPureReloadBuilder`)

1. `GET api.js` ou `enterprise.js` → version + `apiBase`
2. `GET …/anchor` → HTML avec `03AF…`, `recaptcha.anchor.Main.init("…")`
3. Parser → `anchorToken`, `encryptionKey`, `initPayload`, clés VM
4. `resolveConfigBytecode(anchor)` → inner bytecode → `parse_encryption` (reg **586**, signalKeys `"1"`)
5. `BrowserSimulator` + `PureBrowserEnvironment` (profils `chrome_win_nvidia`, `chrome_win_intel`, …)
6. `VmBytecodeRunner` (SEND / reg 586) + `EnterpriseSignalStream` (chunks `0x62` + LCG session)
7. Champs protobuf 1–29 — `POST /api/token/tm` accepte `fingerprint` ou `fingerprintProfile`

Le petit champ `conf[23]` (~524 car.) n’est souvent **pas** le bon blob ; le vrai config est dans **bgdata[4]** (déchiffrement avec paires de clés numériques dans `init`).

Fichiers : `api/vm/VmPureReloadBuilder.js`, `PureBrowserEnvironment.js`, `api/level2/SignalEncryptor.js` (port Rust).

## 3. Pipeline JSDOM (VM)

```
AnchorVmRunner
  → JSDOM + BrowserPolyfills (Canvas, Worker, MessageChannel, setTimeout ciblé)
  → Scripts anchor (inline Main.init + recaptcha__fr.js)
  → runFullAnchorHandshake (postMessage parent simulé)
  → waitForMainExecute (15s)
  → Main.execute() → POST /reload capturé (XHR/fetch → Node)
```

**Succès VM JSDOM** = body reload **≥ 8000 octets** sur le fil (objectif flat ~12 ko).

**Succès capture Chrome TM (enterprise)** = **05AL ~1276 car.** + POST `/reload` souvent **~4–5 ko** — valide pour TM, pas une erreur tronquée.

## 4. Pourquoi `Main.execute` reste `undefined` (état actuel)

`Main.init` tourne, mais la suite attend une **iframe parent** réelle (page TM) + timing + parfois **Worker** / botguard. En anchor seul JSDOM :

- Handshake `postMessage` simulé ≠ parent Chrome complet
- Le bytecode **main** n’est pas exécuté jusqu’au bout
- Aucun POST `/reload` → **0 octet** capturé

D’où l’ancien **fallback flat** (reload ~15 ko synthétique). Par défaut c’est **désactivé** :

- Erreur si pas de capture : `RECAPTCHA_ALLOW_FLAT_FALLBACK` non défini
- Réactiver le plat : `RECAPTCHA_ALLOW_FLAT_FALLBACK=1`

## 5. Commandes de test

```powershell
$env:RECAPTCHA_TLS_INSECURE="1"
$env:RECAPTCHA_ALLOW_FLAT_FALLBACK="0"
npm run test:vm
npm run disasm:anchor
$env:RECAPTCHA_VM_DEBUG="1
npm run test:vm
```

## 6. Variables

| Variable | Effet |
|----------|--------|
| `RECAPTCHA_ALLOW_FLAT_FALLBACK=1` | Autorise le reload plat si VM échoue |
| `RECAPTCHA_ANCHOR_VM_PARENT=1` | Page TM + iframe (plus lent) |
| `RECAPTCHA_VM_DEBUG=1` | Logs POST + probe runtime |
| `RECAPTCHA_ERRORMAIN_DEBUG=1` | Diagnostic Main.init → ErrorMain (JSON complet) |
| `RECAPTCHA_ALLOW_STATIC_MAIN=1` | Autorise l’asset Rust 78464 o dans le resolver |
| `RECAPTCHA_JSDOM_BROWSER=0` | Défaut — reload pur (`dynamic-pure`) |
| `RECAPTCHA_JSDOM_BROWSER=1` | Active le pipeline §3 (capture VM) |

## 6b. Fingerprint frais + dump à chaque run (recommandé)

Par défaut le vieux `captures/vm-runtime.json` (Chrome) **n’est plus chargé**.

```powershell
# JS pur : profil aléatoire + 05AL dérivé + dump captures/sessions/native-*.json
npm run token:tm:native

# TM enterprise : JSDOM auto (alias token:tm:native)
npm run token:tm:jsdom

# JS pur seulement (plus rapide)
$env:RECAPTCHA_JSDOM_BROWSER="0"; npm run token:tm:native

# Réutiliser un 05AL Chrome figé (déconseillé si fingerprint ne match pas)
$env:RECAPTCHA_CHROME_CAPTURE="1"
```

| Variable | Défaut | Effet |
|----------|--------|--------|
| `RECAPTCHA_CHROME_CAPTURE` | off | `1` = injecte le 05AL importé |
| `RECAPTCHA_AUTO_DUMP` | on | `0` = pas de fichier session |
| `RECAPTCHA_FINGERPRINT_PROFILE` | random | `chrome_win_intel`, `rotate`, etc. |
| `RECAPTCHA_JSDOM_BROWSER` | auto TM | `0` = JS pur seulement ; `1` = force JSDOM |

## 6c. Import dump Chrome + diagnostic ErrorMain

```powershell
# Diagnostic pourquoi ErrorMain apparaît (sans execute)
npm run diagnose:errormain

# Import JSON exporté depuis la console iframe (___vmDump)
npm run import:vm-dump -- dumps/chrome-vm.json

# Le resolver ignore captures/main-bytecode.txt (78464 o statique) tant que vmDump.bytecodes est vide
```

## 7. Piste pour un vrai reload VM sans navigateur

1. Capturer depuis Chrome : **05AL** + reload enterprise (~4–5 ko TM) → `import:vm-dump` ; ou gros reload (~12 ko) pour rejouer tel quel, ou
2. Implémenter un **interpréteur** bytecode main (SEND + chiffrement signal) — gros chantier, ou
3. Parent VM + iframe qui finit par définir `Main.execute` (fragile en JSDOM).
