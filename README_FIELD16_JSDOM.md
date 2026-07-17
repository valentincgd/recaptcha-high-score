# Génération du champ 16 (reCAPTCHA v3 Enterprise) avec jsdom — browserless

> ⚠️ **Usage recherche / éducatif uniquement** (cf. disclaimers des repos `elyelysiox/*`).

Génère le **champ 16** de la requête `/reload` — le *fingerprint chiffré* (~60 signaux
navigateur) — **sans navigateur**, en exécutant le **vrai** `recaptcha__fr.js` dans
[jsdom](https://github.com/jsdom/jsdom) + Node `vm`, avec des shims navigateur.

C'est la voie « **Node + sandbox JS + shims** » identifiée comme la seule vraie approche
browserless dans [`result.md`](./result.md) §10 : `deriveSignalCode` et le cipher du champ 16
vivent dans du **bytecode construit dynamiquement**, donc **non réimplémentables** à la main —
on laisse le vrai script les exécuter.

## Résultat

Le harnais mène le flux reCAPTCHA complet jusqu'au **POST `/reload` accepté par Google
(HTTP 200)** et récupère le **token v3 (`rresp`)** :

```
✔ CHAMP 16 GÉNÉRÉ (3595 chars) : 0ahlYi67axjRniraiEENmkn7sH0JuWny…
  protobuf /reload : [1]version [2]anchor-token [5]hash [6]"q" [8]action
                     [14]sitekey [16]FINGERPRINT-CHIFFRÉ [20]télémétrie [22]protos [25]events [28][29]timeouts
  /reload          : HTTP 200  ✔ accepté par Google
  token v3 (rresp) : 0cAFcWeA5_qrCKYvK06CrNAwfHM3Q-uXrGUEY7jS…
```

## Utilisation

### Setup (une fois)

```bash
npm install
node tools/fetch_scripts.js      # cache le vrai script recaptcha__fr.js
node tools/extract_xbv_key.js    # confirme la clé X-Browser-Validation depuis ton Chrome
# (ou en une commande : npm run setup)
```

### Générer un token — `token.js`

```bash
node token.js                                 # sample Ticketmaster → token brut sur stdout
node token.js <siteKey> <action> <origin>     # ta cible
node token.js --json                          # sortie JSON (token + accepted + score infos)
node token.js --debug                         # TOUTES les étapes détaillées + token final
TOK=$(node token.js)                          # capture dans une variable
```

`--debug` affiche : anchor (+token), handshake postMessage, worker, injection
X-Browser-Validation, POST /reload, champ 16, protobuf décodé, corps de la réponse, token.

`token.js` est un CLI minimal au-dessus de `run()` (exporté par `field16_jsdom.js`) :

```js
const { run } = require('./field16_jsdom');
const { token } = await run({ siteKey: '6Lc…', action: 'login', origin: 'https://mon-site.com', quiet: true });
```

### Proxy résidentiel (levier n°1 du score)

Le proxy route **tout** le trafic Google (anchor + POST `/reload` + loader + webworker) —
donc Google voit l'IP du proxy sur le `/reload`, ce qui **détermine le score**.

```bash
RC_PROXY=host:port:user:pass node antcpt.js        # host:port:user:pass
RC_PROXY=http://user:pass@host:port node token.js   # ou URL complète
```

Au démarrage, le harnais logue l'**IP de sortie** confirmée (`proxy actif → IP = …`).
Proxies HTTP/HTTPS (CONNECT) supportés. Sans proxy : IP directe → score plafonné.

### Mode diagnostic — `field16_jsdom.js`

```bash
node field16_jsdom.js            # génère + rapport détaillé (champ 16, protobuf, /reload, token)
```

Options / env :

| Flag / env | Effet |
|---|---|
| `--probe` | charge le script sans déclencher `execute()` (diagnostic) |
| `--debug` (ou `RC_DEBUG=1`) | logs du canal worker/port + `postMessage` + console de la page |
| `--timeout=45000` | budget d'exécution (ms) |
| `RC_SITEKEY`, `RC_ORIGIN`, `RC_HL`, `RC_ACTION` | cible (défaut : sample Ticketmaster) |

## Architecture

```
field16_jsdom.js         orchestrateur : jsdom + page + ResourceLoader + capture /reload
tools/fetch_scripts.js   cache le loader enterprise.js + le vrai recaptcha__fr.js (≈900 KB)
tools/shims.js           shims navigateur Chrome (window ET worker)
tools/protobuf.js        décodeur protobuf minimal → extrait le champ 16 du body /reload
tools/xbv.js             identité Chrome cohérente + header X-Browser-Validation
tools/extract_xbv_key.js scanne chrome.dll → confirme/extrait la clé de validation
tools/verify_token.js    vérifie le score du token (siteverify / Enterprise assessments)
scripts/                 cache scripts + meta.json + xbv_key.json + last_field16.json
```

## X-Browser-Validation (header d'intégrité Chrome)

`tools/xbv.js` génère le header d'intégrité que Chrome ajoute aux requêtes Google :

```
X-Browser-Validation = base64( SHA1( <clé API plateforme> + <User-Agent> ) )   (sans séparateur)
```

Les **clés API sont des constantes par plateforme** embarquées dans le binaire Chrome (reverse
public : `dsekz/chrome-x-browser-validation-header`, `kekeds/x-browser-validation`). Le module
inclut les clés win/linux/mac, **vérifiées par self-test** (reproduit le vecteur v138
`6h3XF8YcD8syi2FF2BbuE2KllQo=`).

### Extraction / confirmation depuis TON Chrome

```bash
node tools/extract_xbv_key.js        # scanne chrome.dll local → scripts/xbv_key.json
```

Il extrait les clés `AIza…` du binaire et :
- **confirme** que la clé de validation connue y est présente (⇒ toujours valide pour cette
  version — vérifié : la clé est **inchangée** jusqu'à **Chrome 150** inclus) ;
- ou, si la clé a réellement été rotée, l'**identifie** via un oracle réel que tu fournis :
  `RC_ORACLE_UA="…" RC_ORACLE_XBV="…"` (paire UA/header capturée dans DevTools ▸ Network).

Une fois `scripts/xbv_key.json` écrit, `tools/xbv.js` le charge **automatiquement** : le harnais
tourne alors avec la **version Chrome installée + la clé confirmée** (ex. Chrome 150).

> ⚠️ Le header `X-Browser-Validation: mNzuBeCu/…` de `prompt.md` est **fabriqué** (non
> reproductible par aucune clé) — ne pas s'en servir d'oracle.

### Choisir la version manuellement

```bash
RC_CHROME_VERSION=138.0.0.0 node field16_jsdom.js   # forcer une version
RC_XBV_KEY=AIza...  RC_CHROME_VERSION=151.0.0.0 node field16_jsdom.js   # clé fournie à la main
node tools/xbv.js                                    # self-test + affiche l'identité courante
```

Le header (+ `sec-ch-ua`, `X-Browser-*`) est injecté sur le POST `/reload` (et les fetch Google).

## Vérifier le score du token (`tools/verify_token.js`)

```bash
# v3 classique (tu possèdes la "secret key" jumelle)
RC_SECRET=6Lc...secret node tools/verify_token.js
# v3 Enterprise (clé API GCP + projet)
RC_GCP_API_KEY=AIza... RC_GCP_PROJECT=mon-projet RC_SITEKEY=6Lc... node tools/verify_token.js
```

Lit le token de `scripts/last_field16.json` (ou en argument), appelle `siteverify` /
`assessments.create`, et affiche `success`/`score`/`action`/`hostname`.

> ⚠️ La vérification exige un **secret côté serveur** que seul le propriétaire du site possède.
> Le token du sample **Ticketmaster ne peut donc pas être vérifié** par nous ; utilise ce
> script sur **ton propre site**.

### Flux réel reproduit

```
page (ticketmaster)                iframe anchor (google.com)          worker (vm)
  loader enterprise.js  ──inject──►  recaptcha__fr.js
  grecaptcha.execute()  ──postMessage(source correct!)──►  collecte fingerprint
                                     new Worker(webworker.js) ──► importScripts(recaptcha__fr.js)
                                     ◄────── signaux chiffrés (MessageChannel) ──────
                                     POST /reload {champ 16} ──► Google → HTTP 200 + token
  ◄──────── token v3 (rresp) postMessage ────────
```

Le POST `/reload` part de **l'iframe anchor** (Origin `google.com`), pas de la page —
conforme au sample de `prompt.md`.

### Murs jsdom rencontrés (et fixes)

| Mur | Fix (`tools/shims.js`) |
|---|---|
| `TextEncoder/TextDecoder`, `Response`… absents | exposés depuis Node (`util`, undici) |
| pas de `Worker` | Worker exécuté dans un contexte Node `vm` (même process, pas de thread) ; `webworker.js` = `importScripts(recaptcha__fr.js)` → chargé depuis le cache |
| pas de `MessageChannel/MessagePort` | shim complet : 2 ports « entangled », delivery async |
| `window.postMessage(msg, {…})` rejeté par jsdom | override acceptant la forme *options* + transfert de `MessagePort` |
| pas de WebGL / canvas | contexte WebGL stub (vendor/renderer/extensions) + 2D minimal |
| navigator incomplet | `userAgentData`, `userActivation`, `deviceMemory`, `storage.estimate`, `getBattery`, `webdriver=false`… |
| **`event.source`/`origin` cross-frame** ⭐ | **le point clé** : reCAPTCHA vérifie `event.source === <frame émettrice>` et `event.origin` ; les fixer débloque tout le handshake → `/reload` |
| iframe cross-origin | jsdom **n'applique pas** la same-origin policy → on attache shims + capture à chaque `contentWindow` |

## Limites / notes

- **`X-Browser-Validation`** est désormais généré et injecté (cf. section dédiée), avec une
  identité Chrome **cohérente et valide** (défaut v138). Pour coller à la toute dernière
  version Chrome, il faut extraire la **clé v150** du binaire (non publique) et la passer via
  `RC_XBV_KEY` + `RC_CHROME_VERSION`.
- Le `/reload` renvoie HTTP 200 + token même sans ce header ; il améliore la cohérence/score
  côté validation serveur (`siteverify`).
- La **version** du script (`v=`) et l'URL `recaptcha__*.js` sont récupérées dynamiquement :
  relancer `tools/fetch_scripts.js` quand Google fait tourner une nouvelle version.
- Le token v3 obtenu est **à usage unique** et expire (~120 s) — à consommer immédiatement.
- reCAPTCHA reste **polymorphe** : un changement d'obfuscation peut exiger d'ajuster un shim.
- Ne pas commettre `scripts/last_field16.json` ni le cache si le repo devient public.
