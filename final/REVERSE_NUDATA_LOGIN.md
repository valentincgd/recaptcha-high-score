# Login TM = NuData (nds-pmd), pas reCAPTCHA — approche navigateur non-détecté

## Diagnostic (prouvé 2026-07-21/22)
Le blocage `/json/sign-in` → `403 "Operation Not Allowed / signInSimple"` n'est NI le token du corps (vide=bidon=le nôtre = même erreur), NI la qualité reCAPTCHA (flat=jsdom = même), NI le TLS (node vs chrome = même), NI Akamai/proxies. Le vrai navigateur (compte OK manuellement) passe ; puppeteer-stealth est **détecté**. Le mur = **NuData `nds-pmd`** (biométrie comportementale) + le **leak CDP `Runtime.enable`** qui flague puppeteer/playwright.

## Les 3 couches NuData (chacune disqualifie seule)
1. **Leak CDP `Runtime.enable`** (hard-fail instantané) : puppeteer/playwright émettent `Runtime.enable` → `consoleAPICalled` observable depuis la page. Stealth ne le corrige PAS. → utiliser un pilotage **CDP-direct sans shim** (nodriver/zendriver) ou Firefox (camoufox) ou un browser qui patche (Kameleo).
2. **Transport TLS JA4 + HTTP/2 + IP** : JA4 doit matcher le build Chrome + OS ; ordre pseudo-headers HTTP/2 ; **IP résidentielle OBLIGATOIRE** (datacenter flaggé pré-JS). NuData partage les fingerprints flaggés CROSS-site.
3. **Comportemental (`nds-pmd`)** : courbes souris (overshoot/correction), **dwell+flight clavier**, scroll, ~30s de validité, session-bound. Tell #1 = **régularité du timing** → il faut la FORME log-normale (variance dwell/flight), pas juste du jitter uniforme.

## Outils (benchmark indépendant 2026, 31 cibles, nodriver 0 hard-block)
| Outil | Lang | Corrige | Maintenance | Reco |
|---|---|---|---|---|
| **nodriver** | Python async | CDP-direct, pas de webdriver/cdc_, minimal CDP | actif mais 1 seul mainteneur | ⭐ top OSS |
| **zendriver** | Python async | idem (fork nodriver) | **activement maintenu** (v0.15.5 juil 2026) | ⭐ préférer pour la maintenance |
| patchright | Py & Node | Runtime.enable, console.enable, webdriver | actif | #2 (25/31) |
| camoufox | Python | fingerprint C++, pas de CDP (Firefox/Juggler) | gap maintenance→forks | alt Firefox |
| Kameleo (payant) | any | **patche Runtime.enable/console.enable**, strip __pw_*, TLS spoof | commercial €59+/mo | le + fort sur le leak CDP |
| rebrowser-patches | Node | Runtime.enable seul | actif | ⚠️ = vanilla en bench |
| undetected-chromedriver, puppeteer-real-browser, hero, Botright | — | — | legacy/abandonnés | ❌ éviter |

## Plan login TM
1. **nodriver/zendriver** (Chrome réel, CDP direct) → pas de leak Runtime.enable.
2. Interaction **OS-realiste** : la reco NuData p=paire nodriver + **input OS-level (PyAutoGUI / SeleniumBase CDP-mode)** car les events JS synthétiques ont des tells ; timing **log-normal** (dwell+flight), souris **Bézier + overshoot** (ghost-cursor).
3. Laisser NuData générer `nds-pmd` frais + reCAPTCHA sur la vraie page ; POST `/json/sign-in` **dans les 30s**.
4. **IP résidentielle/ISP propre** (pas PacketStream cramé, pas datacenter).

Script : `scratchpad/browser/login_nodriver.py` (nodriver + frappe gaussienne + capture status /json/sign-in). Itérations si bloqué : input OS-level, ghost-cursor, meilleure IP.

## Réalité
Rien n'est durablement indétectable (~48h de vie utile avant maj signatures). Les % de succès des blogs = marketing, directionnels. La couche décisive pour un login NuData = **comportemental + IP résidentielle**, le navigateur non-détecté n'est que la condition nécessaire (couche 1).
