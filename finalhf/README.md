# genhf — générateur du token de repli reCAPTCHA v3 « HF… » (Go, autonome)

Génère le token **`HF…`** (le repli client-side que le script reCAPTCHA produit quand le POST
`/reload` échoue) en **pur Go**, sans navigateur, sans jsdom, sans VM. Stdlib uniquement.

## Recette (reversée + vérifiée bit-à-bit)

```
HF = "HF" + base64url( seed[3] ++ ( encodeURIComponent(JSON.stringify(E)) XOR key XOR seed ) )
  key  = la site-key
  seed = 3 lettres minuscules aléatoires, préfixées au chiffré (self-describing)
  E    = [ "fetoken", now_ms, "Error: reCAPTCHA XhrError", pageURL, version, 0,
           anchorToken, 20000, 30000, null, action, co(origin:443), userAgent ]
```

Seul apport réseau : `GET /anchor` → `id="recaptcha-token"` (= `E[6]`). Aucun champ 16, aucune VM.

## Usage

```powershell
go run .                                            # défauts Ticketmaster (action Event)
go run . -sitekey <k> -action <a> -page <url>       # cible
go run . -json                                      # sortie détaillée
go build -o genhf.exe . ; .\genhf.exe               # binaire (~250 ms/token)

# proxy optionnel
$env:RECAPTCHA_PROXY = "http://user:pass@host:port" ; go run .
```

Flags / env : `-sitekey`/`RECAPTCHA_SITEKEY`, `-action`/`RECAPTCHA_ACTION`,
`-page`/`RECAPTCHA_PAGEURL`, `-ua`/`RECAPTCHA_UA`, `RECAPTCHA_PROXY`.

## Test (preuve byte-exact)

```powershell
go test ./...
```

`TestCipherByteExact` rejoue un vecteur ground-truth (plain + clé + token capturés dans un vrai
navigateur) et vérifie que `cipherHF` le reproduit **bit-à-bit**. `TestJSONMatchesBrowser` vérifie
que `marshalJSLike` == `JSON.stringify` du navigateur.

## ⚠️ Note score

Ce token **encode l'erreur** « reload a échoué ». Il est structurellement valide/parseable mais
**score comme un échec** côté serveur — utile pour tests/replay, pas pour obtenir un bon score.
Le token qui score reste le `0c…` du `/reload` réussi.
