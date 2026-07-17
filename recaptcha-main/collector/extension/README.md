# Extension — intercepteur reCAPTCHA reload

Capture le **corps exact du POST** `https://www.google.com/recaptcha/enterprise/reload?k=...`
(protobuf en base64) et sa **réponse** (token), directement dans le navigateur.
Sert de ground-truth pour comparer avec le blob généré par l'API Go, puis pour
la stratégie **bloquer → rejouer manuellement → remplacer les valeurs 1 par 1**.

## Installation (Chrome / Brave)

1. `chrome://extensions` (ou `brave://extensions`).
2. Activer **Mode développeur** (coin haut droit).
3. **Charger l'extension non empaquetée** → sélectionner le dossier
   `collector/extension`.
4. Épingler l'icône. Un badge affiche le nombre de captures.

> Requiert Chrome/Brave 111+ (`world: "MAIN"` des content scripts).

## Utilisation

1. Ouvrir la page cible, ex : `https://www.ticketmaster.com/event/020064BAD9B8236F`.
2. reCAPTCHA v3 s'exécute au chargement puis rafraîchit le token (~toutes les
   2 min et à certaines interactions). Chaque `reload` est capturé automatiquement.
3. Ouvrir le **popup** de l'extension :
   - liste des captures (`reload` / `anchor`), body req en base64 + réponse ;
   - **Télécharger JSON** → `rc-reload-captures-*.json` (à me renvoyer) ;
   - **Bloquer reload : ON/OFF** → quand ON, le POST reload navigateur est
     intercepté et **non envoyé** (réponse vide), pour qu'on rejoue le body
     nous-mêmes ;
   - **Vider** / **Rafraîchir**.

Le badge sur l'icône = nombre de captures en mémoire.

## Format d'une capture

```json
{
  "kind": "reload",
  "url": "https://www.google.com/recaptcha/enterprise/reload?k=6Lcv...",
  "method": "POST",
  "via": "xhr",
  "reqBodyB64": "bin:<base64 du protobuf>",   // ou "str:<base64 utf8>" si texte
  "respBody": "<réponse reCAPTCHA, contient le token>",
  "respStatus": 200,
  "blocked": false,
  "ts": 1782867029000,
  "frame": "https://www.google.com/recaptcha/enterprise/bframe?..."
}
```

- Préfixe `bin:` = corps binaire (protobuf) encodé base64.
- Préfixe `str:` = corps texte (base64 de l'UTF-8).

## Plan de diagnostic (étapes suivantes)

1. **Pull du body** ✅ (cette extension).
2. **Diff** : décoder `reqBodyB64` et comparer champ par champ avec le blob
   généré par l'API Go → repérer les écarts de structure/valeurs.
3. **Bloquer + rejouer** : activer le blocage, rejouer le body réel via notre
   client (proxy/UA identiques) → vérifier si le token obtenu passe le seuil TM.
4. **Bissection** : remplacer les valeurs une par une (les nôtres ↔ les réelles)
   pour isoler le(s) signal(aux) qui font chuter le score.
