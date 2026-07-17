# Mettre à jour le générateur `HF` après une rotation de `recaptcha__fr.js`

Google fait tourner régulièrement `recaptcha__fr.js` (nouvelle `version`, code réobfusqué).
Ce document explique **quoi vérifier** et **quoi corriger** pour garder le générateur Go
(`final/`) valide. Prévoir 5 min pour le check, plus si le cipher a bougé.

## TL;DR — ce qui est stable vs fragile

| Élément | Rotation ? | Géré comment |
|---|---|---|
| `version` (`v` du script) | **change souvent** | ✅ **auto** : le générateur la lit via `GET enterprise.js` à chaque run. Rien à faire. |
| Préfixe `"HF"` | quasi jamais | à revérifier |
| Cipher `fn_H_3` = `data ^ key ^ seed`, `key` = site-key | quasi jamais | à revérifier (§B) |
| Structure du tableau `E` (13 champs) | rare | à revérifier (§A) |

Le seul paramètre qui bouge en pratique (`version`) est **récupéré dynamiquement** → la plupart
des rotations ne cassent RIEN. Le check ci-dessous le confirme en < 5 min.

---

## §A — Check rapide (à faire à chaque rotation)

But : confirmer que cipher + structure sont inchangés. On génère un vrai `HF` avec le **nouveau**
script (via jsdom, qui exécute le vrai code), puis on le **déchiffre** avec notre cipher actuel.

```powershell
cd E:\Projets\recaptcha-V3-main

# 1. Rafraîchir le script en cache + meta.json (nouvelle version)
node tools/fetch_scripts.js

# 2. Générer un vrai token de repli depuis le NOUVEAU script (reload bloqué → chemin HF)
$env:RC_MODE="enterprise"; $env:RC_BLOCK_RELOAD="1"
node token.js 6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV Event https://www.ticketmaster.com > oracle_hf.txt

# 3. Déchiffrer ce token avec NOTRE cipher (clé = site-key) et vérifier les invariants
node tools/decrypt_hf.js --file oracle_hf.txt 6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV
```

Lecture du résultat de `decrypt_hf.js` :

- **`✓ invariants OK`** + `éléments : 13 (attendu 13 ✓)` → **rien n'a changé**. Le générateur Go
  est toujours correct (il refetch la version tout seul). **Fini.** Tu peux supprimer `oracle_hf.txt`.
- **`✖ déchiffrement KO`** (JSON illisible / garbage) → le **cipher ou la clé** ont changé → **§B**.
- Déchiffre mais **`⚠ ATTENDU 13`** ou **`invariants cassés`** → la **structure `E`** a changé → **§C**.

Optionnel — revalider le test byte-exact embarqué (ne dépend pas de la rotation, mais bon réflexe) :

```powershell
cd final ; go test ./...
```

---

## §B — Le cipher a changé (déchiffrement KO)

Rare. Il faut re-reverser le cipher à partir du nouveau script. On capture un **ground truth**
(plaintext + clé + token réels) puis on résout l'opération empiriquement.

1. **Redéobfusquer** le script pour retrouver un `recaptcha_readable.js` lisible
   (pipeline AST Babel, cf. mémoire *deob-pipeline* / `tools/deob_*.js`).

2. **Retrouver la fonction assembleuse** du `HF` (les noms `fn_X_i` changent à chaque rotation) :

   ```powershell
   $env:RC_TOKGEN="1"; $env:RC_BLOCK_RELOAD="1"; $env:RC_SCRIPT_FILE="recaptcha_readable.js"
   node field16_jsdom.js 6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV Event https://www.ticketmaster.com
   ```

   → logge `assemblé par fn_?_?` + la stack (historiquement `fn_S_39 → fn_L_44 → fn_R_2`).
   La fonction du milieu (ex-`fn_L_44`) contient `d = H[3](...clé, plaintext...)` puis
   `x = R[2](.., "HF", d)`.

3. **Instrumenter cette fonction** pour dumper `{clé, plaintext, token}`. Dans une COPIE
   `scripts/recaptcha_hfdump.js`, injecter après l'assignation `d=…, x=…` :

   ```js
   , (function(){try{(typeof self!=='undefined'?self:this).__HFDUMP={k:D,p:w,t:x};}catch(e){}})()
   ```

   (`D` = clé, `w` = plaintext `E.CE()`, `x` = token). Le hook `RC_HFDUMP` de `field16_jsdom.js`
   écrit ensuite le dump :

   ```powershell
   $env:RC_BLOCK_RELOAD="1"; $env:RC_SCRIPT_FILE="recaptcha_hfdump.js"; $env:RC_HFDUMP="scripts/hf_dump.json"
   node field16_jsdom.js 6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV Event https://www.ticketmaster.com
   ```

4. **Résoudre le combineur** : comparer octet par octet le corps base64url du token
   (moins les 3 octets de seed en tête) avec `encodeURIComponent(plaintext)`, la clé cyclée et le
   seed cyclé. Tester les candidats (`data^key^seed`, `data+key+seed`, …) jusqu'au match parfait.
   (C'est ce qu'a fait le script d'analyse d'origine : `data ^ key[f%len] ^ seed[f%3]`.)

5. **Reporter dans le code** : mettre à jour `cipherHF()` dans `final/main.go` **et**
   `gen_hf.js` (racine), puis regénérer le vecteur de test (§D) et `go test ./...`.

---

## §C — La structure `E` a changé (déchiffre mais champs différents)

`decrypt_hf.js` affiche le tableau réel avec l'étiquette attendue par position. Compare :
un champ ajouté/retiré/déplacé se voit tout de suite. Répercute l'ordre/les valeurs exacts dans le
tableau `E` de **`final/main.go`** (fonction `generateHF`) **et** de `gen_hf.js`. Rappel des champs
actuels :

```
[ "fetoken", now_ms, "Error: reCAPTCHA XhrError", pageURL, version, 0,
  anchorToken, 20000, 30000, null, action, co(origin:443), userAgent ]
```

Puis §D + `go test ./...`.

---

## §D — Regénérer le vecteur de test byte-exact

Après tout changement (§B ou §C), le test `final/verify_test.go` doit rejouer un ground truth frais :

```powershell
cd E:\Projets\recaptcha-V3-main
node -e "const fs=require('fs');const d=require('./scripts/hf_dump.json');const plain=Buffer.from(d.plainHex,'hex').toString('latin1');fs.writeFileSync('final/testdata/hf_vector.json',JSON.stringify({key:d.key,plain,token:d.token}));console.log('vecteur regénéré');"
cd final ; go test ./...   # TestCipherByteExact + TestJSONMatchesBrowser doivent passer
```

`TestCipherByteExact` échoue si `cipherHF`/`encodeURIComponent`/base64 ne reproduisent pas le token
réel bit-à-bit. `TestJSONMatchesBrowser` échoue si `marshalJSLike` ≠ `JSON.stringify` du navigateur.

---

## Fichiers impliqués

| Fichier | Rôle |
|---|---|
| `final/main.go` | générateur Go (tableau `E` + `cipherHF`) — **à éditer** en cas de changement |
| `gen_hf.js` (racine) | équivalent Node.js — garder synchro |
| `tools/decrypt_hf.js` | déchiffre un `HF` → diagnostic rapide (§A) |
| `tools/fetch_scripts.js` | rafraîchit `scripts/recaptcha__fr.js` + `meta.json` |
| `field16_jsdom.js` | oracle jsdom ; hooks `RC_BLOCK_RELOAD`, `RC_TOKGEN`, `RC_HFDUMP`, `RC_SCRIPT_FILE` |
| `scripts/recaptcha_hfdump.js` | copie instrumentée du readable (dump `__HFDUMP`) |
| `scripts/hf_dump.json` | dernier ground truth capturé |
| `final/testdata/hf_vector.json` | vecteur figé du test byte-exact |
