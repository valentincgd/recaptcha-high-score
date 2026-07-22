# Scaling — générer 500 tokens/sec (haut score, Ticketmaster)

> Plan + chiffres **mesurés** sur cette machine (8 cœurs). Objectif : 500 tok/s, score TM-acceptable.

## 1. La contrainte physique (établie par tests)

Un token **haut score sur TM** exige un **field16 exact**. Deux façons de le produire :

| Voie | field16 | Score TM | Coût | Débit mesuré |
|------|---------|----------|------|--------------|
| **jsdom** (vrai `recaptcha__fr.js`) | EXACT | ✅ accepté | CPU lourd | **~4 tok/s / fenêtre, ~25 tok/s / 8 cœurs** |
| **Voie B pure** (`VmPureReloadBuilder`) | approximé | ❌ bloqué (event-page PASS→BLOCK) | CPU léger, réseau | ~6 tok/s / IP (rate-limit Google) |

- La pure passe le `/reload` de Google (0.9 sur le démo) **mais TM la rejette** sur www (event-page). → jsdom obligatoire aujourd'hui pour TM.
- jsdom est **CPU-bound** : optimum ≈ `cœurs − 2` fenêtres (mesuré : 6 fenêtres = 25 tok/s ; 8 fenêtres = 20 tok/s, dégradation par context-switch).

## 2. Chiffres mesurés (8 cœurs, pool warm, demo sitekey)

```
1 fenêtre séquentiel : 3.8–4.1 tok/s   (p50 ~250 ms/token)
poolSize=3, conc=3   : 13.3 tok/s
poolSize=6, conc=6   : 25.2 tok/s      ← optimum (cœurs−2)
poolSize=8, conc=8   : 20.6 tok/s      ← trop de fenêtres, dégrade
```

**Débit jsdom ≈ 4 tok/s/cœur** (RAM ~150–250 Mo/fenêtre → ~1,5 Go pour 6 fenêtres).

## 3. Architecture 500/sec — Fleet jsdom (garantie haut score)

```
                       ┌─────────────┐
   clients ───────────►│ load-balancer│  (round-robin, stateless : proxy par requête)
                       └──────┬───────┘
        ┌─────────────┬───────┼───────┬─────────────┐
     box#1          box#2   box#3   …            box#N
  server.mjs      server.mjs …                server.mjs
  pool=cœurs−2    pool=cœurs−2                pool=cœurs−2
  (~25 tok/s      (~25 tok/s)                 (~25 tok/s)
   /8 cœurs)
```

**Dimensionnement pour 500 tok/s (~4 tok/s/cœur) :**

| Machines | tok/s |
|---|---|
| 20 × 8 cœurs | 500 |
| 5 × 32 cœurs | 500 |
| 2 × 64 cœurs | ~500 |
| **≈ 125 cœurs au total** | **500** |

L'API est **stateless par requête** (le proxy est passé par requête, hors clé de pool) → n'importe quel LB devant N instances `server.mjs`. Chaque instance auto-dimensionne son pool (`DEFAULT_POOL = cœurs−2`, override `RC_POOL_SIZE`).

**Déjà en place dans ce repo pour supporter le fleet :**
- Pool warm réutilisé (`api/WarmService.mjs`), boots **sérialisés** (pas de corruption cache).
- Cache `scripts/` fetché **1×** puis `RC_NO_FETCH=1` partout (zéro re-download concurrent).
- Auto-warm au 1er appel ; proxy **tournant par requête** (une fenêtre sert toutes les IP).
- `poolSize` auto = cœurs−2.

## 4. Réduire le coût 10× — Voie B pure EXACTE (R&D, la vraie cible)

Si le field16 pur devenait **exact**, le coût s'effondre : réseau-bound (~cheap CPU), 500/s = **~85 IPs proxy** au lieu de 125 cœurs jsdom. C'est **le** levier pour 500/s pas cher.

**Blocage** : `deriveSignalCode` + le cipher du field16 vivent dans du **bytecode dynamique** (`result.md §9/§10`). Le `VmPureReloadBuilder` les approxime → TM rejette.

**Plan R&D (méthode déterministe, pas de tir dans le noir) :**
1. **Harnais de diff pur↔réel** : lancer jsdom → capturer field16 RÉEL + ses inputs (anchor, clé, fingerprint) ; rejouer `VmPureReloadBuilder` avec les **mêmes** inputs ; **décrypter les deux blobs** (clé connue) et differ le **plaintext** (stream de signaux + fingerprint) → localiser exactement la divergence.
2. Corriger le pur segment par segment jusqu'à égalité byte-exact du field16.
3. Piste rapide à tester d'abord : `www` = reCAPTCHA **enterprise**, or on force `api2` → tester le pur en `mode:"enterprise"` pour 6Lcv.
4. Quand pur == réel → basculer le fleet sur la voie pure (85 IPs).

**Incertitude** : c'est du reverse profond, issue non garantie. Le fleet jsdom (§3) est la solution **livrable maintenant**.

## 5. Verdict pur vs jsdom — test PROXYLESS déterministe (2026-07-18)

Test A/B **sans proxy** (IP directe propre 88.185.243.14, back-to-back, même instant), replay event-page :

```
JSDOM = PASS 200  (3/3)
PUR   = BLOCK 403 (3/3)
```

**Conclusion ferme** : à IP égale et propre, jsdom passe, le pur est bloqué. Le field16 pur est **intrinsèquement inférieur** pour TM www — ce n'est PAS un artefact d'IP. (Les runs proxy où tout bloquait = IP PacketStream flaggée, un facteur SÉPARÉ qui s'ajoute.)

Deux bottlenecks distincts et cumulatifs :
1. **Qualité du field16** : seul jsdom est accepté par TM www. Le pur est KO même sur IP propre.
2. **Réputation IP** : même avec jsdom, une IP flaggée → 403. PacketStream (rotation partagée) est dégradé/insuffisant.

## 5bis. Profil CPU — peut-on rendre la génération beaucoup moins chère ? (mesuré)

Où part le CPU d'un token (profil `--cpu-prof`, hotspots déjà écartés : canvas stubbé en constantes, Worker créé 1× au boot et réutilisé — pas de re-parse 900 Ko par token) :

| Poste (CPU actif, warm) | ~% | Réductible ? |
|---|---|---|
| **recaptcha-script (le vrai algo)** | ~35% | **NON — plancher** (il FAUT le faire tourner pour un field16 exact) |
| jsdom (overhead DOM) | ~24% | oui, seulement via vm léger |
| node internal (piloté par jsdom) | ~29% | partiel |
| chargement modules (require) | boot only | amorti en warm |

**Verdict** : le vm léger (exécuter le vrai script sans jsdom) est un **gros chantier** (849 lignes de shims + tout le DOM + shim Worker à réécrire) pour un gain **~1,5-2× seulement** — l'algo reCAPTCHA est un plancher incompressible. **Ça ne donne PAS 500/s pas cher.**

La SEULE voie vers une génération 10× moins chère = la **Voie B pure** (pas d'algo réel, CPU quasi nul) — mais confirmée **TM-KO** (§5). La rendre exacte = reverse du bytecode dynamique (issue incertaine). **Il n'y a pas de raccourci bon marché tant que le field16 exact exige de faire tourner l'algo Google.**

## 6. Décision & plan

1. **Génération haut-score — RÉSOLU** : fleet jsdom horizontal, ~125 cœurs → 500 tok/s. Déployable tel quel (auto-poolSize, stateless, proxy par requête).
2. **IPs — bloqueur opérationnel** : pour 500/s d'ACCEPTÉS il faut un GROS pool de résidentiels PROPRES (sticky par token). PacketStream actuel insuffisant.
3. **Cost-killer (voie pure) — nécessite du reverse** : le pur étant confirmé KO à IP propre, le rendre viable exige de **fermer l'écart field16** : harnais de diff pur↔réel (décrypter les 2 blobs avec la clé anchor, differ le plaintext signaux+fingerprint), corriger `VmPureReloadBuilder` segment par segment jusqu'à égalité. Issue incertaine (bytecode dynamique, result.md §9/§10). Gain si réussi : 500/s sur ~85 IPs (~10× moins cher).
