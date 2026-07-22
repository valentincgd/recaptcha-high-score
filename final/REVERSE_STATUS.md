# État du reverse reCAPTCHA v3 — full JS (sans jsdom)

DIRECTIVE : générer le token 100% en JS pur, sans jsdom, sans exécuter le script.

## Ce qui est ACQUIS (full JS, vérifié)

### Crypto (100%, byte-exact)
- `Field16Cipher` : cipher externe du field16 (encrypt/decrypt).
- `PerSignalCipher` : cipher par-signal L[40] (XOR keystream g37/h38/h16/y5/J22) + **shuffle J[22]** (les signaux "binaires opaques" = valeurs chiffrées PUIS mélangées ; décodables via un-shuffle).
- `Field22Bloom` : bloom filter (bit-exact).
- `DeriveSignalCode`, `hashString` : vérifiés.
- => **field16 entièrement DÉCODABLE** (plus rien d'opaque).

### Génération dynamique full JS
- `SessionState` : état de session unique (IDs, timestamps timeline ms, widget, counter, GA cookie, timezone du profil) → COHÉRENCE inter-champs (field16[44]==[50], field16↔field22 widget, field5=hash).
- `Field16Collector` : génère les 79 signaux dynamiquement depuis 1 profil + session. function.toString en NATIF Chrome (plus propre que jsdom).
- `Field20Telemetry`, `Field22Bloom.buildCoherent` : dynamiques + cohérents.
- `PureFlatReload` / `flat.mjs solveFlat` : body /reload 12 champs, piloté par 1 profil.
- `fingerprints.json` : 1 seul profil complet (source de vérité device).

### Résultats
- **auth.ticketmaster.com / login / démo** : PUR → score 0.9, accepté. MARCHE.
- **Flow /reload** : identique à jsdom (URL, headers, token accepté). Vérifié.
- **Worker** : pas requis (jsdom passe sans le webworker).

## Ce qui BLOQUE www (event/quickpicks) — le long tail

À IP/TLS/flow/headers/worker égaux, jsdom passe (200) et le flat pur non (403). Le SEUL
différenciateur = le CONTENU byte-parfait du field16. Résidu non encore reproduit :
- **[55]** : agrégat session (35 bigrammes), construit dans la coroutine async — source exacte non mappée (résiste au trace/corrélation).
- **slot 77** : présence conditionnelle (44 vs 45 triples).
- matching cross-champ widget id précis, [65] sha384, micro-signaux éventuels.

## SOLUTION QUI MARCHE aujourd'hui (hybride)

- **www event/quickpicks** : jsdom (pool warm, `server.mjs` route auto www→jsdom) + **REJOUER le tmpt avec un client TLS-Chrome** (`curl_cffi` impersonate="chrome", PAS Python requests qui est bloqué par tm-bl sur le TLS) + session cohérente (eps-mgr→epsf→cible même session) → **event-page 200 prouvé**.
- **auth / démo / reste** : flat pur (rapide, sans jsdom, 0.9).
- Token enterprise pour XV ; event valide/futur (event passé = 404).

## Fichiers clés
- Génération pure : `api/vm/{Field16Cipher,PerSignalCipher,Field16Collector,SessionState,Field22Bloom,Field20Telemetry,PureFlatReload}.js`, `flat.mjs`, `fingerprints.json`.
- jsdom (référence + www) : `vendor/rcjsdom/field16_jsdom.js`.
- Outils reverse : `vendor/rcjsdom/tools/{oop_trace,oop_child,trace653,vm_host,vm_field16,capture_dsc}.js`.
- Serveur : `server.mjs` (hybride www→jsdom / reste→flat).

## Pour finir le pur sur www
Reverser [55] (coroutine async), slot 77, cross-widget — signal par signal. Tout est décodable ;
c'est de l'ingénierie de collecte, version-fragile (re-casse à chaque release Google).
