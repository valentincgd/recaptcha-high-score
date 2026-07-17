# Inventaire VM reCAPTCHA — tout trouvé

Généré: 2026-06-03T04:43:58.460Z

## Pipeline JS pur (repo)

- `api/vm/BrowserSimulator.js`
- `api/vm/PureBrowserEnvironment.js`
- `api/vm/VmBytecodeRunner.js`
- `api/vm/VmSignalMapper.js`
- `api/vm/EnterpriseSignalStream.js`
- `api/vm/VmPureReloadBuilder.js`
- `api/level2/SignalEncryptor.js`

## Capture navigateur

- `api/vm/AnchorVmRunner.js`
- `api/vm/ParentAnchorVmRunner.js`
- `api/vm/NetworkCapture.js`
- `api/fresh/IdenticalReload.js`

## Référence Rust

- `recaptcha-vm-main/src/disassembler/disassemble.rs`
- `recaptcha-vm-main/src/encryption/parse.rs`
- `recaptcha-vm-main/src/encryption/mod.rs`
- `recaptcha-vm-main/src/bytecode/mod.rs`

## Outils CLI

- `tools/discover-all-vm.mjs`
- `tools/disassemble-anchor-vm.mjs`
- `tools/dump-vm.mjs`
- `tools/test-vm-anchor.mjs`
- `tools/test-fingerprint-profiles.mjs`
- `tools/decode-reload-to-body.mjs`
- `tools/compare-reload.mjs`

## Anchor local (`captures/anchor-sample.html`)

| Champ | Valeur |
|-------|--------|
| anchorToken | 1785 chars |
| encryptionKey | 1780541421352 |
| conf bytecode | 524 chars |
| bgdata[4] | 34808 chars |
| vmBytecodeKeys | [[71,125],[80,215,127]] |
| collectorIndexes conf[7] | null |
| inner bytecode | 5085 o (score 13.17) |
| signalKeys VM | 0 |
| SEND payloads | 0 |
| 05AL dans config | non |
| reg 586 (parse.rs) | null |
| signalKeys reg "1" |  |

## Asset `main_bytecode.txt`

- bytecode: 78464 octets, 838 instructions
- encryptionKey reg 586: **null**
- signalKeys: **0** — 
- SEND: 24 (05AL: 0, long: 0)
- opcodes: {"XOR":139,"SET_WINDOW_PROP":70,"OP_438":46,"CONCAT":44,"OP_0":43,"OP_26":41,"LOAD_CONST":38,"OP_341":37,"GET_PROP":16,"NULL":14,"CALL_METHOD":10,"JE":7,"OP_99":7,"OP_110":7,"OP_1464":5,"MOV":5,"OP_233":5,"OP_278":5,"SEND":5,"OP_899":4,"STR_TO_B":4,"APPLY":4,"OP_1846":4,"MATH_TRUNC":3,"OP_1596":3,"PERF":3,"JL":3,"OP_467":3,"OP_1369":3,"OP_56623103":3,"OP_107":3,"OP_1059":2,"OP_78":2,"ADD":2,"OP_234":2,"OP_1821":2,"OP_974":2,"MOD":2,"CALL_WINDOW_PROP":2,"OP_830":2,"OP_1732":2,"OP_1628":2,"OP_524":2,"OP_116":2,"OP_893":2,"OP_1842":2,"OP_1841":2,"OP_1454":2,"OP_654":2,"OP_1682":2,"OP_1371":2,"OP_561":2,"MUL":2,"OP_1909":2,"OP_122":2,"OP_505":2,"OP_1867":2,"OP_1195":2,"OP_1085":2,"OP_592":2,"OP_108":1,"OP_1080":1,"SET_PROP":1,"OP_586":1,"OP_939":1,"OP_482":1,"OP_1100":1,"OP_336":1,"OP_1340":1,"OP_1075":1,"OP_1002":1,"OP_718":1,"OP_2029":1,"OP_675":1,"OP_1262":1,"OP_1715":1,"OP_56":1,"OP_8712":1,"OP_1391":1,"OP_1629":1,"OP_704":1,"OP_317":1,"OP_114":1,"OP_1948":1,"OP_313":1,"OP_388":1,"OP_627":1,"OP_1510":1,"OP_923":1,"OP_1288":1,"OP_1689":1,"OP_33":1,"OP_191":1,"OP_1978":1,"OP_1954":1,"OP_88":1,"OP_783":1,"OP_51":1,"OP_94":1,"OP_916":1,"OP_1810":1,"OP_1878":1,"OP_398":1,"OP_1612":1,"OP_1090":1,"OP_1917":1,"OP_139":1,"OP_2012":1,"OP_279":1,"OP_1883":1,"OP_471":1,"OP_1957":1,"OP_75":1,"OP_100":1,"OP_2048":1,"OP_905":1,"OP_120":1,"OP_359":1,"OP_900":1,"OP_535":1,"OP_806":1,"OP_124":1,"OP_1711":1,"OP_1560":1,"OP_363":1,"OP_1435":1,"OP_10574":1,"OP_1102":1,"OP_1532":1,"OP_1631":1,"OP_263":1,"OP_1287":1,"UNKNOWN_OP":1,"OP_1983":1,"OP_1969":1,"OP_76":1,"OP_323":1,"OP_1160":1,"OP_1985":1,"OP_584":1,"OP_724":1,"OP_1993":1,"OP_1138":1,"OP_1154":1,"OP_412":1,"OP_439":1,"OP_1210":1,"OP_243":1,"OP_1053":1,"OP_1234":1,"OP_443":1,"OP_189":1,"OP_532":1,"OP_503":1,"OP_1126":1,"OP_1282":1,"OP_1021":1,"OP_92":1,"OP_819":1,"OP_45":1,"OP_534":1,"OP_1696":1,"OP_597":1,"OP_1024":1,"OP_123":1,"OP_5390":1,"OP_1717":1,"OP_402":1,"OP_1010":1,"OP_1538":1,"OP_194":1,"OP_414":1,"OP_649":1,"OP_1536":1,"OP_635":1,"OP_49":1,"OP_921":1,"OP_-1342177454":1,"OP_906":1,"OP_1627":1,"OP_221":1,"OP_1961":1,"OP_453":1,"OP_1082":1,"OP_1158":1,"OP_512":1,"OP_74":1,"OP_157":1,"OP_1782":1,"OP_1334":1,"OP_1152":1,"OP_816":1,"OP_1616":1,"OP_1959":1,"OP_56623102":1,"OP_1048":1,"OP_1220":1,"OP_425":1,"OP_1975":1,"OP_374":1,"OP_1882":1,"OP_576":1,"OP_1721":1,"OP_1378":1,"OP_1943":1,"OP_839":1,"OP_125":1,"OP_641":1,"OP_176":1,"OP_646":1,"OP_985":1,"OP_1666":1,"OP_187":1,"OP_1795":1,"OP_1828":1,"OP_752":1,"OP_370":1,"OP_798":1,"OP_1751":1,"OP_1327":1,"OP_1848":1,"OP_746":1,"OP_1455":1,"OP_96":1,"OP_1018":1,"OP_1504":1,"OP_379":1,"OP_1319":1,"OP_1600":1,"BIND_APPLY":1,"OP_369":1,"OP_656":1,"OP_381":1,"OP_1792":1,"OP_1046":1,"OP_181":1,"OP_725":1,"OP_826":1,"OP_54":1,"OP_326":1,"OP_813":1,"OP_1669":1,"OP_547":1,"OP_1451":1,"OP_818":1,"OP_1256":1,"OP_1295":1,"OP_373":1,"OP_1494":1,"OP_750":1,"OP_1518":1,"OP_539":1,"OP_1966":1,"OP_29":1,"OP_733":1,"OP_390":1}

## Catalogue Rust (`disassembled.txt`)

- instructions: ~6232 lignes
- signalKeys (LOAD_CONST "1"): **20**
- 41, 43, 291, 352, 417, 545, 549, 614, 619, 659, 727, 779, 895, 959, 1019, 1092, 1310, 1313, 1994, 2033
- SEND sites: 0
- encryptionKey exemple reg 586: -940896859

## Signal keys README

`[417, 727, 545, 779, 659, 959, 895, 1092, 41, 43, 549, 352]`

## Collecteurs actuels (`Collectors.js`)

417, 1641, 1641, 1310, 352, 360, 1628, 16, 34, 31, 3553, 291, 4, 5, 32, 352, 291, 1626

## Lacunes pour 100 % byte-identique

- **main-bytecode-runtime** (missing): Bytecode MAIN construit à l'exécution — assets/main_bytecode.txt = référence statique seulement
- **vm-interpreter-window** (partial): GET_WINDOW_PROP / CALL_METHOD / HASH non exécutés — seulement LOAD_CONST + SEND rejoués
- **05AL** (synthetic): 05AL ~1276c produit par MAIN runtime ou SecondaryTokenGenerator
- **reload-size** (partial): Cible navigateur ~12–20 ko ; pur JS ~6–9 ko sans main VM
- **opcodes-total** (documented): 42 opcodes, ~36–38 utilisés (recaptcha-vm-main README)

## Champs protobuf reload (référence)

- **1**: 26 chars — `"hsFBb1u5wWWWkWP4in1ua2cQ"…`
- **2**: 1766 chars — `"03AFcWeA7as8q9tZ7Ki_jhEF1A_X337f8sp4yBqUpeB90hmtu-mhVmryOwP…`
- **5**: 13 chars — `"-2022119046"…`
- **6**: 3 chars — `"q"…`
- **7**: 558 chars — `"05AL2ClC46Rt18k6O1nQIXQoa3i_Ypl_7XL7pGnL480rK7C1QX2FOnCzO-K…`
- **8**: 13 chars — `"preregister"…`
- **14**: 42 chars — `"6LdoaXQrAAAAADQviABd-eByJu6kPL8awKDyc1zb"…`
- **16**: 7179 chars — `"010JDOB0Luenew7Ffj4RpVwU1Kg_9q4--f2dVNS0lCTkuEwGv39S5p1WFel…`
- **20**: 346 chars — `"51bGwsbnVsbCxbbnVsbCxudWxsLG51bGwsWzksNS44MjIyMjIyMjIwNTY2N…`
- **21**: 75 chars — `"0aAL2ClC49IAdbcj-gSamJGfbA8NIzwDeVuPYIUdbRevidsqu9YG8LGeCbw…`
- **22**: 3750 chars — `"BDCA7AYgHMUZaWs5O2vJKqBuiI1cgh7FgJ9CqgoIkUegLWoWRb5KZ/GtJnC…`
- **25**: 90 chars — `"W1tbNTAwNiw4NDldLFszNTgzNyw5XSxbNjQ2MDcsNl0sWzQ1NDY0LDZdLFs…`
- **28**: 5 chars — `20000…`
- **29**: 5 chars — `30000…`