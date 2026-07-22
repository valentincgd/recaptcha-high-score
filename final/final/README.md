# recaptcha-flat-clean

Générateur de **token reCAPTCHA v3** + cookie **`tmpt` Ticketmaster**, 100 % JavaScript pur.

- ❌ **Aucun jsdom**, ❌ **aucun node:vm**, ❌ aucune exécution du script Google.
- ✅ Le token est reconstruit et chiffré byte-exact en Node (field16/20/22, cipher, deriveSignalCode…).
- ✅ Dossier **autonome** : ne dépend que de `node-tls-client` (empreinte TLS/HTTP2 de Chrome 150, indispensable — Node natif est détecté par Google/Ticketmaster).
- ✅ Passe `www.ticketmaster.com` **Event** (event-page + quickpicks) sur IP résidentielle propre.

## Installation

```bash
cd final          # ce dossier
npm install       # installe node-tls-client (+ lib native)
```

## API HTTP

```bash
npm start          # démarre le serveur (PORT, défaut 3000)
```

**`POST /token`** — génère un token reCAPTCHA v3 pour n'importe quel site :

```jsonc
// requête
{
  "websiteUrl": "https://auth.ticketmaster.com",
  "recaptchaSitekey": "6LdoaXQrAAAAADQviABd-eByJu6kPL8awKDyc1zb",
  "proxy": "http://user:pass@host:port",   // optionnel (résidentiel recommandé)
  "action": "pageView",
  "isEnterprise": false
}
// réponse
{
  "status": "success",
  "version": "1.0.1",
  "solveMethod": "A",
  "data": {
    "gResponseToken": "0cAFcWeA5_...",
    "header": {
      "userAgent": "Mozilla/5.0 ...",
      "secChUa": "\"Chromium\";v=\"148\"...",
      "secChUaPlatform": "\"Windows\"",
      "secChUaMobile": "?0",
      "acceptLang": "en-US,en;q=0.9"
    }
  }
}
```

Rejouer la requête cible avec les `header` renvoyés (mêmes UA + client-hints) **et le même proxy**.

**`POST /login`** — login complet Ticketmaster (100 % request) : `{ websiteUrl, email, password, proxy? }`.
**`GET /health`** — `{ status: "ok", version }`.

> Toutes les constantes (versions, URLs, sitekeys, config OAuth des sites…) sont dans **`constants.json`** — aucun hardcode dans le code.

## Usage (bibliothèque)

```js
import { solveToken, solveTmpt, solveLogin } from "./index.mjs";

// 1) juste le token reCAPTCHA v3
const t = await solveToken({
  siteKey: "6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV",
  action:  "Event",
  origin:  "https://www.ticketmaster.com",
  proxy:   "http://user:pass@host:port",   // résidentiel recommandé (voir « Réputation IP »)
});
// t.token, t.headers (à rejouer sur la requête cible : user_agent + sec-ch-ua* + même proxy)

// 2) le cookie tmpt complet (token → /eps-mgr → /epsf)
const r = await solveTmpt({
  url:     "https://www.ticketmaster.com/.../event/<EVENT_ID>",
  action:  "Event",
  siteKey: "6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV",
  proxy:   "http://user:pass@host:port",
});
// r.tmpt, r.token, r.headers, r.eps_sid, r.ms

// 3) LOGIN complet 100 % request (sans navigateur) : 2 tokens reCAPTCHA + session OAuth + POST sign-in
const login = await solveLogin({
  email:    "user@example.com",
  password: "…",
  proxy:    "http://user:pass@host:port",   // résidentiel propre recommandé
});
// login.ok  = true  → anti-bot passé + identifiants acceptés
// login.body = réponse TM (étape post-login : add-passkey ou vérification Persona selon la réputation device ;
//              le lien `continueWithoutVerification` permet de poursuivre sans la vérification)
```

CLI rapide :

```bash
node index.mjs "https://www.ticketmaster.com/.../event/<EVENT_ID>" "http://user:pass@host:port"
node index.mjs login "user@example.com" "password" "http://user:pass@host:port"
```

## Structure

```
server.mjs         API HTTP : POST /token, POST /login, GET /health
constants.json     TOUTES les constantes/IDs (versions, URLs Google, sitekeys, config OAuth des sites)
index.mjs          cœur : solveToken() + solveTmpt() + solveLogin() + siteConfigFor()
tlsClient.cjs      client TLS Chrome-150 (node-tls-client) — le seul truc externe
fingerprints.mjs   profils navigateur (UA + client hints) — tirés au hasard à chaque solve
fingerprints.json
api/               parsers (anchor/bootstrap/reload) + Config + HttpClient + protobuf/hash
api/vm/            reconstruction field16 (cipher, deriveSignalCode, collecteur, bloom field22, télémétrie field20)
                   + JSON de spec/enum/identité
```

## Notes importantes

- **DC field16** : la clé de chiffrement de field16 est le timestamp de l'anchor **suivi du motif `,0,0,[collectorIndexes]`** (pas le dernier timestamp). `api/AnchorParser.js` l'extrait via `findDC`. C'était LE bug qui faisait échouer les anciennes versions (Google déchiffrait en garbage → score bas → 403).
- **Réputation IP** : le facteur limitant est l'IP, pas le payload. Les IP datacenter et les résidentielles brûlées sont bloquées par tm-bl (Akamai). Utiliser des IP résidentielles propres et ne pas les surcharger.
- **Aucun cookie** : pas de `_GRECAPTCHA` envoyé — chaque solve est un visiteur neuf.
- **Unicité par solve (anti-replay)** : rien n'est rejoué à l'identique. À CHAQUE token sont régénérés frais : le **profil device** (UA/WebGL/écran, tiré au hasard), l'**identité de session** (`SessionState` : session-id, cookie GA, hex, timings — plus de fichier `flat_identity.json` statique), et **tous les signaux comportementaux du slot 73** (souris/clavier/scroll/perf — `Slot73Collector` régénère les valeurs, le `slot73_template.json` ne sert que de forme). Option `RC_IDENTITY_FILE=<chemin>` pour figer une identité « vieillie » (usage mono-session à haut score), sinon frais par défaut.
- **Version du script** : `field16_spec_tm.json` / `field16_spec_signin.json` sont calés sur une version de `recaptcha__fr.js`. Si Google met à jour le script, ces specs (structure des slots) sont à re-capturer.

## Contextes supportés (sélection automatique)

Le contexte est détecté depuis `siteKey`/`action`/host (dans `PureFlatReload`) :

| Contexte | Détection | Spec field16 | État |
|---|---|---|---|
| **Event / tmpt** (www.ticketmaster.com) | défaut | `field16_spec_tm.json` | ✅ passe event-page 200 (IP propre) |
| **Sign-in / auth** (auth.ticketmaster.com, sitekey `6LdoaXQr`, action `login`) | auto | `field16_spec_signin.json` | ✅ `solveLogin()` passe /json/sign-in (voir ci-dessous) |

Le spec sign-in (`field16_spec_signin.json`) est décodé du token **browser genuine** : il fait matcher les slots stables de field16 avec le vrai navigateur (URL oauth, titre "Ticketmaster Sign In", écran, hosts nudata, DOM BUTTON, mémoire…). Les slots session-varying sont régénérés frais.

## ✅ Login sign-in — 100 % request (`solveLogin`)

Le POST `/json/sign-in` (sitekey `6LdoaXQr`, action `login`) **passe en flat pur**, sans navigateur ni `nds-pmd` (NuData). Le blocage `Operation Not Allowed / signInSimple` était un rejet sur le **score** du token reCAPTCHA (pas une absence de signal botguard — BotGuard a été retiré par Google le 2026-04-01). Ce qui fait monter le score au-dessus du seuil login :

- **field16 [64] exec-time** : ~10 s (un login humain met le temps de taper email+password) au lieu de ~500 ms — un login instantané = bot évident.
- **field25** : compteurs d'events cohérents avec un vrai login (`keydown`≈`keyup`≈nb de caractères tapés, quelques clics/focus), pas du random.
- **[29]** hash `grecaptcha.execute` correct pour la sitekey, **[77]** timestamp, **[78]** cookie GA retiré (un GA périmé = tell d'incohérence).

Côté flux, deux points **indispensables** (gérés par `solveLogin`) :
1. **GET `/as/authorization.oauth2` DEUX fois** : au bootstrap, puis **après avoir obtenu le tmpt** — le 2e GET pose `ma.paramsToken` (qui encode le `scope`). Sans lui : `"scope is missing in the request"`.
2. Envoyer **tous** les cookies `auth.ticketmaster.com` (eps_sid, tmpt, SID, BID, ma.\*, TMAUO) au sign-in.

Un sign-in accepté renvoie **HTTP 200** + une étape post-login (`add-passkey` ou vérification d'identité **Persona** selon la réputation device) — ce **n'est pas** un blocage. Le lien `continueWithoutVerification` de la réponse permet de poursuivre sans la vérification. Une session device réchauffée réduit ces step-ups.

> Validation : banc d'injection (token flat injecté dans un vrai navigateur nodriver avec `nds-pmd` genuine → 200) **et** flux 100 % HTTP (`solveLogin` → 200). À IP propre.
