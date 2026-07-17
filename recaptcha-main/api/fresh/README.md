# Génération fresh (A → Z)

Aucun fichier `captures/reload.bin` ni `reload.curl`.

## Pipeline

1. `GET enterprise.js` + `recaptcha__fr.js` (cache)
2. `GET anchor` → `03AF…` + `encryptionKey` + `configBytecode`
3. `BrowserEnvironment` (JSDOM + WebGL canvas)
4. `Collectors` → signaux TM
5. `SecondaryTokenGenerator` → `05AL…` (dérivé anchor + bytecode config)
6. `EnterpriseBlobEncoder` → blob f2088 chiffré
7. `POST reload` → token `0cAF…`

## Commande

```powershell
npm run token:tm
# ou
RECAPTCHA_RELOAD_STRATEGY=fresh node api.mjs --tm
```

## Limite

Google renvoie souvent `rresp: null` tant que le **`05AL`** et le **format blob** ne sont pas produits par l’interpréteur VM (`SEND`) — voir `recaptcha-vm-main`.

Flux **JSDOM auto** (TM enterprise) : `npm run token:tm:native`. Si la VM anchor ne capture pas `/reload`, repli JS pur (~5–9 ko).
