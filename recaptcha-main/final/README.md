# API Final — reCAPTCHA TM (flat)

## API Go native (recommandée — sans Node)

```powershell
cd final
npm run build:go

$env:RECAPTCHA_TLS_INSECURE = "1"
$env:RECAPTCHA_FINAL_DIR = (Get-Location).Path
.\recaptcha-api.exe
```

- **100 % Go** (stdlib uniquement)
- Pipeline **dynamic-flat-go**
- **48 profils** `fingerprints.json`
- Port **3848**

Voir `go/README.md`.

## API Node (legacy, optionnel)

```powershell
npm install
npm start
```

## Requête

```http
POST http://127.0.0.1:3848/api/captcha/solve
Content-Type: application/json

{
  "url": "https://www.ticketmaster.fr",
  "sitekey": "6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV",
  "proxy": "http://user:pass@host:port",
  "action": "FREvent",
  "enterprise": true
}
```

## Réponse

```json
{
  "status": "success",
  "method": "A",
  "data": {
    "token": "0cAFcWeA…",
    "user_agent": "…",
    "accept_lang": "…",
    "sec_ch_ua": "…",
    "sec_ch_ua_mobile": "?1",
    "sec_ch_ua_platform": "\"Android\""
  },
  "pipeline": "dynamic-flat-go"
}
```
