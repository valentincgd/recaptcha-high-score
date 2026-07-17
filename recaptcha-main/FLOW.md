# Flux token (pipeline automatique)

**TM enterprise** : JSDOM anchor VM en premier (capture POST `/reload`), repli JS pur si capture incomplète.

**Autre siteKey** : `POST /api/token` avec `origin` + `referer` du domaine enregistré Google. Enterprise → JSDOM auto ; api2 → JS pur. Clés **v3** (`grecaptcha.execute`) : anchor OK mais reload souvent 500 — pas encore supportées nativement.

## Pipeline

1. `GET api.js` / `enterprise.js` + `recaptcha__fr.js`
2. `GET anchor` → token `03AF…` + `encryptionKey`
3. **Reload** (auto) : JSDOM VM → ou JS pur + bytecode config ; identique si `RECAPTCHA_IDENTICAL=1` ou `RECAPTCHA_RELOAD_TEMPLATE`
4. `POST reload` → token `0cAF…`

```powershell
npm run token:tm:native
npm start   # puis POST /api/token/tm
```

## Variables utiles

| Variable | Effet |
|----------|--------|
| `fingerprint` / `fingerprintProfile` | `chrome_win_intel`, `chrome_mac_amd`, ou objet custom |
| `RECAPTCHA_RELOAD_TEMPLATE` | Chemin vers `reload.bin` Chrome (pipeline identique) |
| `RECAPTCHA_IDENTICAL=1` | Force reload identique |
| `RECAPTCHA_JSDOM_BROWSER=0` | Désactive JSDOM auto (TM → JS pur seulement) |
| `RECAPTCHA_JSDOM_BROWSER=1` | Force JSDOM même hors TM enterprise |
| `RECAPTCHA_VM_CAPTURE_MS` | Attente capture POST `/reload` (défaut 8000) |
| `RECAPTCHA_ANCHOR_VM_PARENT=1` | Page TM + iframe (lent ; défaut = anchor seul) |
| `RECAPTCHA_PARENT_GEXECUTE=1` | `grecaptcha.execute` parent (sinon skip, évite blocage) |
| `RECAPTCHA_VM_STRICT=1` | Échec si VM n'a pas capturé /reload |
| `RECAPTCHA_RELOAD_NESTED=0` | Fallback flat top-level au lieu de nested |

Réponse API : champ `pipeline` (`dynamic-jsdom`, `dynamic-pure`, …) — lecture seule.
