# Audit field16 — Field16Collector.js vs référence déchiffrée (repo elyelysiox/recaptcha)

Source vérité terrain : `scratchpad/recaptcha_ref/fingerprint/decrypted_values.json` + README idx 4-78 + 28 collecteurs .js.
Contexte : `field16_spec_tm.json` = capture **jsdom** event TM ; les écarts jsdom→genuine deviennent des *tells* en **sign-in enterprise**. Event/tmpt PASSE déjà (ne pas casser). Ces fixes ciblent le SIGN-IN.

## Divergences (gravité décroissante)

| idx | attendu | produit actuel | verdict | fix |
|---|---|---|---|---|
| **55** | `deriveSignalCode` de chaque signal dans l'ordre d'exec, + compteur | template FIGÉ (session 80461zxuwq) L143-146 | DIVERGENT majeur | recomputer à la volée, ordre `[42,45,53,30,28,54,29,31,32,33,34,35,37,36,38,39,43,40,41,46,48,57,58,60,61,62,63,64,66,68,69,71,72,79,55]` |
| **63** | digest timestamps epoch des cookies `[count,min,max,avg]` (server-verifiable) | perf-timing `ss.timingArray` L152-155 | DIVERGENT majeur | algo derirveCookies.js sur le cookie jar réel : regex `\b(1[2-9]\d{8}(\d{3})?)\b`, `parseInt(id.slice(1,6))` |
| **69** | vrai token session `_GRECAPTCHA` (augmente score) | id base36 random b64 (mode C) L150 | DIVERGENT majeur/score | injecter le vrai token anchor/execute |
| **44** | composite 5×`deriveSignalCode`(hover,active,inputs,url,scrollY) | `ss.primaryId` random L148 | DIVERGENT | au moins chars7-8=`deriveSignalCode(location.origin)`, 9-10=`deriveSignalCode("0")` ; lier à [50] |
| **72** | userAgentData `[[brands],mobile,platform]` cohérent UA/sec-ch-ua | hardcodé Chrome150/Windows L75 | DIVERGENT/statique | dériver du profil (uaDataFromProfile) |
| **52** | `10*isActive+hasBeenActive` (ex 11) | leak jsdom `"NaN[object Object]"` L158 | DIVERGENT (tell jsdom) | émettre l'entier |
| **39/45** | getters natifs `function get x() { [native code] }` | leak jsdom `performanceImpl`/`wrapperForImpl` sauf RC_NATIVE_FN=1 L102 | DIVERGENT (tell jsdom) | NATIVE_FN par défaut (inverser cond L102) |
| **73** | ~17 signaux VM peuplés | 2 blobs random L182-190 #freshSlot73 | MANQUANT (gap VM) | rapprocher structure genuine |
| **50** | 10 éléments `[count,timeout,null,mult,trans,[hover],sid,score,null,[[flags]]]` | 7 éléments L135-137 | DIVERGENT/statique | ajouter 8-10 cohérents [52] |
| **57** | hosts document.scripts réels | statique `"www.gstatic.com,_,"` L158 | STATIQUE | refléter hosts page TM |
| **35** | `isPurchase,tag,sha256[:8]` activeElement (INPUT/BUTTON en signin) | hardcodé `"0,BODY,30e7e41e"` (ss.bodySig absent) L127 | STATIQUE | tagName réel focus |
| **49** | `protocol-isZero` ex `"h2-0"` | statique `"."` (artefact jsdom) L158 | DIVERGENT (tell) | `<nextHopProtocol>-0` |
| **61** | `[n,hash(attr),hash(tags)]` mutations | statique `[0,"AAAAAAAAAA","AAAAAAAAAA"]` L158 | STATIQUE (faible) | mutations réelles |
| **58** | clé localStorage échantillonnée | `rc::a`→`rc::d-<ts>` (format widget id) L110 | DIVERGENT (faible) | garder `rc::a` |
| **4** | HMAC(rc::a,siteKey)[:4] par session | statique `"18d1"` L75 | STATIQUE (faible) | régénérer |
| **65** | integrity api.js (10 chars) par version | statique `"sha384-DMJ"` L158 | STATIQUE (faible) | matcher version chargée |

## Ordre de priorité des fixes (dans Field16Collector.js)
1. **[55]** recompute dynamique (bug cohérence n°1) — ⏳ TODO (haut risque, calibré session jsdom)
2. **[63]** depuis cookie jar réel (server-verifiable) — ⏳ TODO (besoin plumbing cookie jar)
3. **[69]** token session 09A (humanVerification) — ✅ FAIT (récolté via resp idx12 par le priming, injecté slot69, gated signin)
4. **[72]** dériver du profil — ⏳ TODO (raw matche le profil chrome150_win actuel → faible urgence)
5. **[44]** composite deriveSignalCode — ⏳ TODO
6. **[52]+[39]/[45]+[49]** supprimer leaks jsdom — ✅ FAIT (gated signin ; [52]→"11", [49]→"h2-0", 39/45→native fn)
7. **[50]** restaurer champs activation — ✅ FAIT (gated signin ; forme 10 élts genuine)
8. **[35]** activeElement BODY→INPUT — ✅ FAIT (gated signin) ; [57]/[58]/[4]/[65] — ⏳ TODO

## ✅ Implémenté (2026-07-21) — context-aware, gated `signin`
- `Field16Collector.build({signin})` → threadé depuis `flat.mjs` (signin = ZB 6Ldo || action login) via `PureFlatReload.build({signin})`.
- **Event (signin=false) inchangé bit-à-bit** (fixes gated `if(ctx.signin)`). Sign-in reçoit les valeurs genuine.
- Fixes faits : [39]/[45] native fn `get x(){ [native code] }`, [49] `"h2-0"`, [52] `"11"`, [35] `"0,INPUT,<sha256>"`, [50] forme complète 10 élts.
- **VALIDÉ TM proxyless (test_tmpt.py 3/3)** : event-page 200, auth-login (ZB signin) 200, quickpicks accepté. Zéro régression.

Note : `SessionState.bodySig` référencé L127 mais inexistant → [35] est de facto constant.
