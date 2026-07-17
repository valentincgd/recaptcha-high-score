# Collector de fingerprint reCAPTCHA (post-BotGuard)

Depuis le retrait de BotGuard (04/01/2026), le score reCAPTCHA v3 dépend
entièrement de la **qualité du fingerprint** : signaux statiques (idx 4-72),
**biométrie** (souris/scroll/clavier — idx 73) et compteurs d'événements
(idx 25). Un payload statique = session « sans interaction humaine » → score
plancher, bloqué par les endpoints à seuil haut (`www.ticketmaster.com/event`).

Ce collector capture un **vrai fingerprint** dans un navigateur réel, puis on le
**rejoue** côté serveur (API Go) pour générer des tokens sans navigateur.

## 1. Capturer un fingerprint

1. Ouvrir la page cible dans un **vrai Chrome** (ex : une page event Ticketmaster).
2. Ouvrir DevTools → Console, coller le contenu de `collector.js`.
3. Pendant ~5 s : **bouger la souris, scroller, cliquer** (interaction humaine).
4. À la fin le collector :
   - log le fingerprint et le stocke dans `window.__rcFingerprint`,
   - télécharge `fingerprint-<timestamp>.json`,
   - POST optionnel vers l'API (voir plus bas).

Finaliser plus tôt : `window.__rcFinalize()` dans la console.

### Capture réseau reCAPTCHA (action réelle + requête reload)

Le collector pose aussi, **dès qu'il est collé**, des hooks sur :
- `grecaptcha.execute` / `grecaptcha.enterprise.execute` → capture la **vraie
  `action`** passée par la page (ex : la page event peut n'utiliser ni `"Event"`
  ni une action attendue). Résultat dans `fp.detectedActions` + `fp.action` est
  écrasé par l'action réelle si détectée.
- `fetch` et `XMLHttpRequest` → capture toute requête `/recaptcha/…`, dont le
  **POST `/reload`** (corps protobuf en base64) et sa réponse. Résultat dans
  `fp.network.reloads` / `.anchors` / `.executes`.

⚠ **Important** : ces hooks doivent être posés AVANT que reCAPTCHA n'exécute.
En pratique reCAPTCHA v3 rafraîchit son token toutes les ~2 min et à certaines
interactions ; après avoir collé le collector, **attends ~30 s ou déclenche une
action** (clic sur un bouton achat/checkout) pour capturer un `execute`+`reload`.
Si `fp.detectedActions` est vide, le hook a été posé trop tard.

Dump réseau seul, à tout moment : `window.__rcDumpNetwork()` (log + téléchargement
`rc-network-<ts>.json`). Ceci sert à **valider notre format de blob** côté Go en
comparant le corps reload réel avec celui généré par l'API.

### Options (en tête de `collector.js`)
- `captureMs` : durée de la fenêtre d'interaction.
- `harvestUrl` : ex `http://127.0.0.1:3848/api/fingerprint/harvest` pour envoyer
  directement à l'API (⚠ page https → localhost http peut être bloqué par le
  navigateur ; le téléchargement de fichier reste la voie fiable).
- `harvestKey` : clé `X-Valou-Key`.

## 2. Rejouer le fingerprint dans l'API Go

### Voie A — fichier au démarrage
```powershell
$env:RECAPTCHA_FINGERPRINT_CAPTURE = "E:\chemin\fingerprint-123.json"
$env:RECAPTCHA_TLS_INSECURE = "1"
.\recaptcha-api.exe
```
Au démarrage : `fingerprint capturé chargé: N signaux + M VM/biométrie`.

### Voie B — endpoint live (harvest)
```bash
curl -X POST http://127.0.0.1:3848/api/fingerprint/harvest \
  -H "X-Valou-Key: <clé>" -H "Content-Type: application/json" \
  --data-binary @fingerprint-123.json
```
Réponse : `{"status":"success","activated":true,...}`. Le fingerprint est
utilisé immédiatement par les prochains `/api/captcha/solve` et `/tmpt`.
Définir `RECAPTCHA_FINGERPRINT_DIR` pour aussi persister les captures reçues.

## 3. Ce que le collector capture

| Bloc | Signaux |
|------|---------|
| Statiques (idx 29-71) | origin, cookies (idx 31), inputs (idx 34), history, screen (idx 67), timezone (idx 68), heap (idx 71), script links (idx 57), title… |
| Positionnels | idx 4 (siteKey+6d SHA-256), idx 5, idx 16 (HEAD BitHash), idx 27/28, idx 72 (userAgentData) |
| **VM / biométrie (idx 73, clés fixes)** | **352 souris**, **959 scroll**, **549 clavier**, 659 éléments pressés, 895 visibilité, 417 UA, 545 webdriver, 370 touch, 1278 perf.now, 1313 android/chrome, 1994 hw/mémoire/quota, 614 batterie, 1310 WebGL, 291 prototypes |
| Événements (idx 25) | compteurs pointermove/down/up, keydown/up, focusin |

Côté Go, chaque valeur est chiffrée avec sa clé par-signal + la **clé anchor
live** (cipher LCG identique au vrai reCAPTCHA), via le conteneur chunks déjà
validé. Le profil (UA/WebGL/langues) est aligné sur la capture pour cohérence.

## Limites connues
- La dérivation de clé des signaux statiques (`deriveSignalCode`/`deriveKey`)
  reste une approximation (calibrée sur les paires connues). Les clés VM/biométrie
  sont fixes et fiables.
- Un fingerprint capturé est lié à un profil/navigateur ; le réutiliser en masse
  reste détectable. Idéalement : capturer plusieurs profils et faire tourner.
