# Captures (optionnel)

Pour un reload **100 % identique** au navigateur, place ici un POST `/reload` capturé dans Chrome :

1. DevTools → Network → filtre `reload`
2. Clic droit → Copy → Copy as cURL **ou** « Copy response » / sauvegarde du body (Request payload, format binaire)
3. Fichier : `reload-6LdoaXQr.bin` (ou `-api2.bin`) + `tm-session.json` avec le même `encryptionKey` que la capture

```powershell
$env:RECAPTCHA_RELOAD_TEMPLATE="captures/reload-6LdoaXQr.bin"
npm run token:tm
# RECAPTCHA_IDENTICAL=1 ou template ci-dessus
```

Sans `reload.bin`, le flux tente la **capture VM** (iframe TM + `Main.execute`) — seul moyen d’obtenir le même body sans Chrome manuel.

Le flux API génère tout à la volée :

- anchor HTTP live
- reload via **JSDOM auto** (TM enterprise), repli JS pur
- repli protobuf plat si la VM n’a pas capturé `/reload`

Fichiers utiles (optionnels) :

| Fichier | Rôle |
|---------|------|
| `tm-cookies.txt` | Cookies Google seed (`RECAPTCHA_USE_COOKIES`) |
| `tm-session.json` | `encryptionKey` session (`capture-tm-session`) |
| `anchor-sample.html` | Référence HTML anchor (debug VM) |
| `main-bytecode.txt` | Bytecode MAIN capturé (`npm run capture:main-bytecode`) — requis pour SEND/05AL VM en mode pur |
| `vm-runtime.json` | Métadonnées capture (`bytecodes`, horodatage) |

```powershell
npm run token:tm
# ou
curl -X POST http://127.0.0.1:3847/api/token/tm -H "Content-Type: application/json" -d "{\"siteKey\":\"6LdoaXQrAAAAADQviABd-eByJu6kPL8awKDyc1zb\",\"enterprise\":true,\"action\":\"login\"}"
```
