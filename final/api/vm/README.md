# VM Node (JSDOM + dump + analyse)

## Commandes

```powershell
# Dump complet → dumps/vm-{timestamp}.json + report + disasm.txt
npm run dump:vm

# Via API (serveur démarré)
curl -s -X POST http://127.0.0.1:3847/api/vm/dump -H "Content-Type: application/json" -d "{}"
```

## Modules

| Fichier | Rôle |
|---------|------|
| `BrowserEnvironment.js` | JSDOM + canvas WebGL |
| `BrowserPolyfills.js` | addEventListener sur Array/Object/DOM |
| `RecaptchaVmHost.js` | Charge enterprise.js + recaptcha__fr.js |
| `VmDisassembler.js` | Désassemble bytecode config (port Rust) |
| `VmInterpreter.js` | Analyse + encrypt signaux collecteurs |
| `VmDumper.js` | Écrit dumps/ |
| `VmAnalyzer.js` | Rapport opcode / SEND / recommandations |

## État

- **grecaptcha** : chargé via `enterprise.js` + `recaptcha__fr.js` en DOM.
- **Bytecode config** : déchiffrement multi-clés (`VmBytecodeKeys.js`).
- **05AL / SEND** : nécessite bytecode **main** dynamique (construit à l’exécution du script), pas seulement config statique.

## Prochaine étape

Interpréter le bytecode **main** capturé à runtime (hook `window.___vmDump`) quand `recaptcha.anchor.Main.init` tourne.

### Bytecode MAIN (mode pur)

1. Capture JSDOM : `npm run capture:main-bytecode` → `captures/main-bytecode.txt`
2. `VmMainBytecodeResolver` choisit : fichier capture > `vmDump.bytecodes` > assets
3. `VmBytecodeRunner.analyze(anchor, key, { env, vmDump })` exécute config + main et collecte les 25 SEND
