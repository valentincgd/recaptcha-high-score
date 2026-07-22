/**
 * Field16Collector — génère le field16 (79 slots) 100% en JS pur, DYNAMIQUEMENT, depuis
 * UN profil fingerprint + les données de session (anchor, timestamps). Tout ce qui doit varier
 * varie à chaque appel : IDs session, timestamps, hex IDs, cookie GA, timings, DC.
 *
 * Base : un spec décodé d'une capture jsdom (api/vm/field16_spec_tm.json) = la STRUCTURE
 * (par slot : key, mode C/plain/shuffle, type, valeur de référence). Le collector remplace
 * chaque valeur dynamique par une fraîche cohérente avec {profil, session}, garde les statiques,
 * remet les function.toString en NATIF Chrome (plus propre que le leak jsdom idlUtils), puis
 * ré-encode (L40 +shuffle) et chiffre via Field16Cipher.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createHash } from "crypto";
import { Field16Cipher } from "./Field16Cipher.js";
import { encodeSignalMode } from "./PerSignalCipher.js";
import { SessionState } from "./SessionState.js";
import { DeriveSignalCode } from "./DeriveSignalCode.js";
import { Slot73Collector } from "./Slot73Collector.js";
import { DynamicValues } from "./DynamicValues.js";

// Hash DOM du vrai script (reversé) : xH = SHA-256 ; signal élément = tagName+","+sha256(tagName+id+className)[:8].
// Vérifié : sha256("BODY")[:8] === "30e7e41e" (= slot 8 jsdom). Reconstruction GENUINE (pas de template).
function domHash8(str) { return createHash("sha256").update(String(str)).digest("hex").slice(0, 8); }

// Clés (2e élt du triple) qui VARIENT par session dans le genuine (13, cf full-payload-audit) :
// leur code est un deriveSignalCode seedé par perf.now runtime (non transmis → non validable serveur).
// Dans le spec figé, ce sont ces valeurs ; on les régénère fraîches à chaque run (sinon field16
// quasi-statique = tell de replay). On préserve la classe de magnitude observée (petite ~1500-3900
// vs grande int32) pour rester dans la distribution genuine.
const DYNAMIC_KEYS = new Set([
  1627, 2103480962, 1780321274, 1746531948, 1979933535, 949382213,
  1300596863, 1536057308, 1625, 1888, 1899401862, 3055,
]);

const __dir = dirname(fileURLToPath(import.meta.url));

function rnd(n) { return Math.floor(Math.random() * n); }
function randB36(len) { const A = "abcdefghijklmnopqrstuvwxyz0123456789"; let s = ""; for (let i = 0; i < len; i++) s += A[rnd(36)]; return s; }
function randHex(len) { const A = "0123456789abcdef"; let s = ""; for (let i = 0; i < len; i++) s += A[rnd(16)]; return s; }
function b64(s) { return Buffer.from(String(s), "utf8").toString("base64"); }
function randB64u(len) { const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"; let s = ""; for (let i = 0; i < len; i++) s += A[rnd(64)]; return s; }

// function.toString NATIF Chrome (au lieu du leak jsdom "get history(){ return idlUtils.wrap... }")
const NATIVE_FN = (name) => `get ${name}() { [native code] }`;

export class Field16Collector {
  constructor(specPath) {
    this.spec = JSON.parse(readFileSync(specPath || join(__dir, "field16_spec_tm.json"), "utf8"));
  }

  /**
   * @param {object} o
   *   o.profile      profil fingerprint (fingerprints.json) — source de vérité
   *   o.anchorToken  token anchor de la session (pour les signaux anchor-dérivés)
   *   o.version      version du script recaptcha (pour les URLs gstatic / integrity)
   *   o.origin       origine de la page (ex https://www.ticketmaster.com)
   *   o.now          timestamp ms (défaut Date.now())
   *   o.DC           clé session cipher externe (défaut = now)
   * @returns {{field16:string, plaintext:string}}
   */
  build({ profile, anchorToken = "", version = "", origin = "https://www.ticketmaster.com", pageUrl = null, signin = false, slot73EncKey = null, now = Date.now(), DC = null, session = null, siteKey = "", title = "" }) {
    const ss = session || new SessionState({ profile, anchorToken, now });
    // Le timezone du field16 doit être cohérent avec la GÉOLOC de l'IP (sinon tell : UA/tz US depuis IP DE).
    // RC_TZ override (ex -120 = UTC+2 CEST Europe été). Sinon profil.
    const tzOff = process.env.RC_TZ != null && process.env.RC_TZ !== "" ? Number(process.env.RC_TZ) : ss.tzOffset;
    let poolIdx = 0;              // pour piocher dans le pool d'IDs partagé
    const slots = [];

    for (const e of this.spec) {
      // slot 73 = signaux de collecte/bg (sparse [null,0,0,"b64"] aux idx 7/[20]/23). Genuine les VARIE
      // par session (blobs 9/24 octets), flat rejouait le spec figé (N=3, blob statique) = tell de replay.
      // On régénère : blobs random frais, N=0, présence [20] stochastique.
      // slot 73 : si encKey botguard dispo (sign-in) → slot73 RICHE (17 signaux device+comportement,
      // Slot73Collector). Sinon fallback #freshSlot73 (2 blobs random, event/thin).
      if (e.raw !== undefined && e.i === 73) {
        if (slot73EncKey != null) {
          // Event (page challenge, AUCUNE interaction) → template dont les signaux comportementaux sont
          // VIDES/minimaux (vérifié en déchiffrant le slot73 genuine : [11]/[12]/[15]/[16]/[17]/[18] vides).
          // Le template signin (interaction login) les populait → fausse activité = flag.
          const t73 = signin ? undefined : join(__dir, "slot73_template_event.json");
          try { slots.push(new Slot73Collector(t73).build({ encKey: slot73EncKey, profile })); continue; }
          catch (_) { /* fallback ci-dessous */ }
        }
        slots.push(this.#freshSlot73()); continue;
      }
      // slot 64 : raw numérique, genuine ~489-520 (varie par session) ; la spec figeait 1081 (périmé). Régénère.
      // slot 64 = temps d'exécution anchor→reload. Event (rapide, jsdom) ~489-520. SIGN-IN : le vrai
      // navigateur met ~10-15s (l'utilisateur tape email+password) → genuine=13073. Un ~500ms en signin
      // = tell de bot majeur (score bas). On émet un temps humain réaliste en signin.
      if (e.raw !== undefined && e.i === 64) { slots.push(signin ? (9000 + rnd(7000)) : (600 + rnd(1000))); continue; } // [64] exec-time : genuine EVENT auto-execute ~775-1411ms (varie). Signin (frappe user) ~10s.
      if (e.raw !== undefined && e.i === 17) { slots.push(2); continue; } // [17] : genuine = 2 (le spec figeait 1, périmé).
      // slot 77 = timestamp conditionnel : genuine sign-in le porte (ex 1784674053983). spec=null. On l'émet en signin.
      if (e.raw !== undefined && e.i === 77) { slots.push(signin ? ss.now : (e.raw)); continue; }
      // slot 72 = navigator.userAgentData [[brands],mobile,platform] — DÉRIVÉ DU PROFIL (plus de valeur
      // figée du spec : sinon tous les profils émettraient le même device = fingerprint hardcodé).
      if (e.raw !== undefined && e.i === 72) { slots.push([profile.brands || [], profile.mobile ? 1 : 0, profile.uaPlatform || "Windows"]); continue; }
      // slot 18 = valeur aléatoire base64 (clé) → FRAÎCHE à chaque solve (le spec la figeait = tell de replay).
      if (e.raw !== undefined && e.i === 18) { slots.push(b64(randB36(13 + rnd(2)))); continue; }
      // slot 4 = HMAC(rc::a, siteKey)[:4] : rc::a est aléatoire par session → 4-hex frais (le spec figeait "18d1").
      if (e.raw !== undefined && e.i === 4) { slots.push(signin ? randHex(4) : ""); continue; } // genuine event = "" (vide)
      if (e.raw !== undefined && e.i === 5) { slots.push(signin ? e.raw : -1); continue; } // genuine challenge [5] = -1
      if (e.raw !== undefined) { slots.push(e.raw); continue; }
      let v = this.#coherentValue(e, ss, { tzOff, version, origin, pageUrl: pageUrl || origin, signin, siteKey, title, poolIdxRef: () => poolIdx++ });
      // Clé : fraîche par session pour les signaux dynamiques (anti-replay), sinon la clé stable du spec.
      // La clé sert AUSSI de clé de chiffrement par-signal (encodeSignalMode) → on utilise la MÊME
      // partout (triple[1] == clé de chiffrement) pour rester auto-déchiffrable et cohérent.
      const key = (process.env.RC_NO_DYNKEYS !== "1" && DYNAMIC_KEYS.has(e.key)) ? this.#freshKey(e.key, ss) : e.key;
      slots.push([encodeSignalMode(v, key, e.mode), key, this.#freshTimingVal(e.timing, ss)]);
    }
    const plaintext = JSON.stringify(slots);
    return { field16: Field16Cipher.encrypt(plaintext, DC ?? ss.now), plaintext, session: ss };
  }

  // Régénère la valeur d'un signal de façon COHÉRENTE avec l'état de session (matching par pattern
  // sur la valeur de référence — plus robuste que les types du spec).
  #coherentValue(e, ss, ctx) {
    let v = e.value;
    const q = v[0] === '"'; // valeur quotée ?
    const inner = q ? v.slice(1, -1) : v;

    // slot 41 (clé spec 2103480962) : signal court qui VARIE par session (jsdom "nn"/";;"/""). flat gardait
    // "" figé → mini replay tell. On régénère une chaîne courte quotée variable (même mode shuffle du spec).
    // Vérifié sur 2 runs jsdom frais : slot 41 émet STABLEMENT "" (vide). L'ancienne règle (doublé "cc")
    // produisait une valeur que jsdom n'émet pas → on aligne sur le stable observé.
    // Le vrai navigateur (capture genuine) émet 2 chars qui VARIENT par session ("bb","FF"…), pas "" (jsdom).
    if (e.key === 2103480962) return '""'; // [41] : genuine EVENT auto-execute = "" (vide, décrypté field16 genuine), pas 2 chars random.
    // slot 67 = résolution écran [width,height,availHeight,innerW,innerH,outerH] — DÉRIVÉ DU PROFIL
    // (le spec avait un b64 random "signal manquant"). Chaque profil → son écran → device non figé.
    // [67] = [screen.w, screen.h, availHeight, innerW, innerH, outerHeight]. Le reCAPTCHA tourne dans une
    // IFRAME → innerW/innerH = viewport iframe (WINDOWED, < écran) et outerHeight = 0 (pas de fenêtre outer).
    // Genuine décodé : [1440,900,852,1037,739,0]. L'ancien code mettait innerW=screen.width (maximisé) et
    // outerHeight=824 > availHeight (IMPOSSIBLE physiquement = tell device fake). On émet une viewport
    // windowed cohérente (< availWidth/availHeight) + outerHeight=0.
    if (e.i === 67) {
      const s = ss.profile.screen || {}; const availW = s.availWidth || s.width || 1440; const availH = s.availHeight || 852;
      const innerW = Math.max(900, availW - (280 + rnd(200)));   // windowed : plus étroit que l'écran dispo
      const innerH = Math.max(600, availH - (100 + rnd(40)));    // < availHeight (chrome navigateur)
      return '"' + JSON.stringify([s.width, s.height, availH, innerW, innerH, 0]) + '"';
    }
    // [39] navigation.type (0=navigate/1=reload) et [45] history.length : le spec jsdom FUIT le getter
    // fnToString (`get history(){…}`) ; un vrai navigateur émet des NOMBRES. On aligne (event + signin).
    if (e.i === 39) return "0";                    // [39] performance.navigation.type : chargement FRAIS = navigate (0), pas reload (1). Genuine event = 0.
    if (e.i === 45) return String(1 + rnd(3));      // [45] history.length : chargement frais 1-3 (genuine=3), pas 2-6.
    // [36] nextHopProtocol du document : "h2" (le spec avait "" — jsdom sans navigation timing).
    if (e.i === 36) return '"h2"';
    // [27] location.origin : l'origin de la REQUÊTE (le spec fuit "[object Object]" = bug de sérialisation jsdom).
    // [27]/[32] = location.href COMPLÈTE de la page (avec le path), pas juste l'origin — le genuine
    // event porte l'URL entière (ex .../event/<id>). Dynamique depuis le body (pageUrl/websiteUrl).
    if (e.i === 27) return '"' + String(ctx.pageUrl || ctx.origin || "").replace(/\/$/, "") + '"';
    // [52] userActivation = 10*isActive+hasBeenActive : event = 0 (chargement, aucun geste), signin = 11
    // (l'utilisateur a saisi email+mot de passe → isActive & hasBeenActive vrais). Le spec fuit
    // "NaN[object Object]" (navigator.userActivation absent en jsdom).
    if (e.i === 52) return ctx.signin ? '"11"' : "0"; // [52] userActivation : genuine EVENT (auto-execute, AUCUN geste) = 0 (décrypté field16 genuine). 11 = prétendre une activation = tell. Signin (user a tapé) = 11.
    if (e.i === 49) return '"h2-0"';
    // ── 5 slots event enrichis, RÉELS mais RÉGÉNÉRÉS à chaque solve (structure genuine, valeurs fraîches) ──
    // Contexte page COMPLET depuis le body (pageUrl/origin) → dynamique, scalable, aucun hardcode figé.
    let _pgHost = "", _base = "", _origin = String(ctx.origin || "").replace(/\/$/, "");
    // _origin = protocole+host SEUL (pas l'URL complète). PureFlatReload passe origin=referer (full URL),
    // donc on re-parse l'origine propre depuis pageUrl/origin (sinon [60] met le full URL = incohérent).
    try { const u = new URL(ctx.pageUrl || ctx.origin); _pgHost = u.host; _base = u.hostname.split(".").slice(-2).join("."); _origin = u.origin; } catch (_) {}
    // [46] : la capture PROPRE de la page challenge donne "." (le spec original était correct). Mon
    // ancienne "URL:ligne:col" venait de la page CHARGÉE (mauvais contexte) et cassait le score.
    if (e.i === 46) return '"."';
    // [32] = 2e URL : VIDE sur la page challenge (le [27] porte l'URL, pas le [32]).
    if (e.i === 32 && !ctx.signin) return '""';
    // [50] = méta session. STRUCTURE EXACTE genuine event (décodé) : [1,0,null,1,1,[primaryId],b64,0,null,[[0]]]
    // — 1 SEUL id = ss.primaryId (cohérent avec [44]/[55]), b64 d'un id 11-char, dernier = [[0]]. (L'ancien
    // [3,1000+,null,1,2,[3 ids],...,[[0,0,-1,0]]] était FAUX = 54 octets de trop + incohérence primaryId.)
    if (e.i === 50 && !ctx.signin) {
      const arr = [1, 0, null, 1, 1, [ss.primaryId], b64(randB36(11)), 0, null, [[0]]];
      return '"' + JSON.stringify(arr).replace(/"/g, '\\"') + '"';
    }
    // [57] = hosts des <script> de la page challenge epsf (peu de scripts) : gstatic (recaptcha) + host
    // de la page + google. Dérivé du host (body). La page challenge n'a PAS les scripts analytics du site.
    if (e.i === 57) {
      let h = ""; try { h = new URL(ctx.pageUrl || ctx.origin).host; } catch (_) {}
      return '"www.gstatic.com,_,,' + h + ',www.google.com"'; // genuine : double virgule (entrée vide) après _,
    }
    // [60] = origines des iframes : origine de la page (body) + google (iframe recaptcha).
    if (e.i === 60 && !ctx.signin) return '"' + [_origin, "https://www.google.com"].join(",") + '"';
    // [69] = cSessionId (mode C = base64 d'un id court base36). Décrypté du genuine : "MTV0b2hmN3ZmbjZ3bQ=="
    // = base64("15tohf7vfn6wm"). PAS un token "09A" (c'était faux). On laisse le handler C-mode générique
    // (plus bas) produire un b64(idPool) frais → aligné sur le genuine.
    // ── Corrections de VALEUR alignées sur le genuine CHALLENGE page (le contexte RÉEL du token tmpt) ──
    if (!ctx.signin) {
      if (e.i === 54) return "true";                            // booléen true (challenge + loaded)
      if (e.i === 56) return '"-1,-1"';                         // "-1,-1" (challenge + loaded)
      // [58] : la capture PROPRE donne "rc::d-<ts>" (= ss.widgetId, valeur d'origine) ; "rc::f" était un
      // artefact de ma page gelée. On laisse passer vers le handler rc:: (ss.widgetId).
      if (e.i === 70) return '"[null,null,\\"\\",\\"\\"]"';     // [null,null,"",""] (challenge + loaded)
      if (e.i === 51) return "0";                               // [51] count mots-clés d'erreur (try again|incorrect|invalid|declined) = 0 (page normale). NOMBRE, pas "[0]".
      if (e.i === 53) { let n = 0; try { n = Array.from(String(ctx.pageUrl || ctx.origin || "")).slice(0, 100).length; } catch (_) {} return String(n % 2 === 0 ? 5 : 4); } // [53] parité longueur location[:100] → 5 (pair) / 4 (impair). CALCULÉ depuis l'URL réelle.
      if (e.i === 31) return '"' + DynamicValues.bitfield31() + '"';  // [31] bitfield features — DYNAMIQUE (harvester par version script)
      if (e.i === 65) return '"' + DynamicValues.sri65() + '"';       // [65] hash intégrité — DYNAMIQUE (harvester par version script)
      if (e.i === 38) return String(rnd(13));                   // [38] DNS timing delta (domainLookup) : petit, VARIE par load (genuine 4/9/10). Pas figé.
      if (e.i === 59) return '""';                              // challenge = "" (chaîne vide quotée)
      if (e.i === 63) return '"[]"';                            // challenge = "[]" (VIDE, pas un tableau de timings)
      // [71] = infos mémoire performance : [totalJSHeapSize, usedJSHeapSize, ...] — 1er ~4.4e9 constant,
      // les suivants VARIENT par solve. (Le spec l'émettait comme un ID base36 = faux.)
      // [71] totalJSHeapSize = limite heap V8 (quasi-constante par version Chrome, PAS un discriminant device) →
      // du profil si présent (fingerprint.jsHeapSizeLimit), sinon la valeur Chrome desktop standard. usedJSHeapSize varie.
      if (e.i === 71) return '"' + JSON.stringify([ss.profile.jsHeapSizeLimit || 4395630592, 20000000 + rnd(8000000), 18000000 + rnd(6000000)]) + '"';
    }
    // [62] : la capture PROPRE de la page challenge donne "QQ" (= la valeur du spec original). Ce n'est PAS
    // le document.title (le token tmpt s'exécute avant que le title "Let's Get..." soit posé). On garde le
    // spec. (Override par ctx.title uniquement pour un autre site qui en aurait besoin.)
    if (e.i === 62 && ctx.title && ctx.signin) return '"' + String(ctx.title).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    // [29] = hash SHA-256 de grecaptcha.execute (stable par sitekey+version : ZB="e2b68587"). Le handler
    // hex8 générique l'écrasait par ss.hex8 (session, "202a957a"=XV) → FAUX pour ZB. En signin, garder le spec.
    // [29] = hash SHA-256 de grecaptcha.execute — PAR SITEKEY + version (VÉRIFIABLE serveur). DYNAMIQUE
    // (harvester) : XV="202a957a", ZB="e2b68587". Ne PAS écraser par ss.hex8 aléatoire.
    if (e.i === 29) return '"' + DynamicValues.executeHash29(ctx.siteKey) + '"';
    // fnToString (getters performance/history) : on GARDE la source exacte du spec (= ce que jsdom émet
    // et qui PASSE), au lieu de forcer "[native code]". RC_NATIVE_FN=1 pour revenir au natif Chrome.
    const fn = /get (\w+)\(\)/.exec(inner);
    if (fn) return process.env.RC_NATIVE_FN === "1" ? '"' + NATIVE_FN(fn[1]).replace(/"/g, '\\"') + '"' : v;
    // timezone + timestamp : [-120,null,<ts>]. Genuine = STRING QUOTÉE "[-120,null,ts]" (vérifié jsdom [68]).
    // BUG corrigé : flat retournait l'array NU (sans guillemets) → type différent côté Google. On garde les guillemets.
    if (/^\[-?\d+,null,\d{13}\]$/.test(inner)) { const a = `[${ctx.tzOff},null,${ss.tEvent}]`; return q ? '"' + a + '"' : a; }
    // cookie GA (slot 78) : flat émettait un GA PÉRIMÉ (ex GA1.1.354395113.1778502448 = date ancienne)
    // = tell d'incohérence. En signin on le RETIRE (vide "") — le genuine XV LoginPage l'a vide aussi
    // (conditionnel GTM). RC_GA_FRESH=1 pour émettre un GA frais à la place.
    if (/^GA1\.\d/.test(inner)) {
      // [78] cookie GA : notre flow est un VISITEUR FRAIS (aucun cookie _ga) → vide, comme le genuine
      // event capturé ("\\"/vide). Un GA synthétique qui ne correspond à AUCUNE session GTM = tell.
      // RC_GA_FRESH=1 pour émettre un GA frais (session réchauffée mono-usage).
      if (process.env.RC_GA_FRESH === "1") return '"' + ss.gaCookie + '"';
      return '""';
    }
    // widget id : genuine émet TOUJOURS "rc::d-<timestamp>" (vérifié 2 runs jsdom : rc::d-1784487833415).
    // La spec avait "rc::a" (périmé) → on émet systématiquement ss.widgetId (rc::d-<tWidget>).
    if (/^rc::/.test(inner)) return '"' + ss.widgetId + '"';
    // URL gstatic release (version)
    if (/gstatic\.com\/recaptcha\/releases/.test(inner)) return (q ? '"' : "") + inner.replace(/releases\/[A-Za-z0-9_-]+/g, `releases/${ctx.version || "VER"}`) + (q ? '"' : "");
    // URL de la page (origin)
    if (/^https:\/\/[a-z0-9.-]*(ticketmaster|appspot|google)/i.test(inner)) {
      // Sign-in : les URLs auth (oauth path/query, listes d'origines) sont DÉTERMINISTES → garder la
      // valeur exacte du spec (sinon la troncature à origin/ perd le path → tell). Uniquement en mode
      // signin pour ne pas toucher le flux event (qui remplace l'URL par l'origin courant).
      if (ctx.signin) return v;
      if (/google\.com/.test(inner)) return v; // google.com reste
      // event : URL COMPLÈTE de la page (location.href), pas l'origin tronqué (dynamique depuis le body).
      return '"' + String(ctx.pageUrl || ctx.origin || "").replace(/\/$/, "") + '"';
    }
    // signal ressource "N,<x>" = un PerformanceResourceTiming. Décrypté du genuine www EVENT [42] :
    // "9,https://www.ticketmaster.com/epsf/717364df/asset/abuse-component.js" → une ressource CROSS-ORIGIN
    // (asset epsf TM, cross-origin à l'iframe google.com reCAPTCHA → pas de Timing-Allow-Origin → l'URL
    // COMPLÈTE est émise, pas un hash). Le hash (spec "6,ed19bca9") ne vaut que pour les ressources
    // same-origin (gstatic). Pour le contexte TM on émet une vraie URL d'asset epsf de la page challenge.
    if (/^\d+,[0-9a-f]{8}$/.test(inner)) {
      let host = ""; try { host = new URL(ctx.pageUrl || ctx.origin).host; } catch (_) {}
      if (/ticketmaster/i.test(host)) {
        // asset epsf de la page challenge (cross-origin → URL complète, avec le hash de déploiement).
        // Genuine décodé : "11,https://www.ticketmaster.com/epsf/717364df/asset/abuse-component.js".
        return '"' + (9 + rnd(4)) + ',https://' + host + '/epsf/717364df/asset/abuse-component.js"';
      }
      const resUrl = "https://www.gstatic.com/recaptcha/releases/" + (ctx.version || "") + "/recaptcha__" + (this.hl || "en") + ".js";
      return '"' + rnd(9) + ',' + domHash8(resUrl + ss.now + rnd(1e6)) + '"';
    }
    // DOM "0,BODY,<hex8>" : hash = sha256(tagName+id+className)[:8] (vraie logique, pas random).
    // BODY sans id/class → sha256("BODY")[:8]="30e7e41e" (= jsdom). ss.bodySig porte id+class éventuels.
    if (/^0,BODY,[0-9a-f]{8}$/.test(inner)) return '"0,BODY,' + domHash8("BODY" + (ss.bodySig || "")) + '"';
    // hex8 quoté ("202a957a")
    if (/^[0-9a-f]{8}$/.test(inner)) return '"' + ss.hex8 + '"';
    // id principal "80461zxuwq" (10 base36) — partagé [44]/[50]
    if (/^[a-z0-9]{10}$/.test(inner) && inner === e.value.replace(/"/g, "")) {
      // [50] structuré contient l'id + un base64 ; sinon id simple
    }
    // structure [50] : [1,0,null,1,1,["<primaryId>"],"<b64 embeddedId>"]
    if (/^\[1,0,null,1,1,\[/.test(inner)) {
      return '"' + JSON.stringify([1, 0, null, 1, 1, [ss.primaryId], b64(ss.embeddedId)]).replace(/"/g, '\\"') + '"';
    }
    // [55] = énumération d'intégrité env encodée (paires [type,code2char] + compteur). Reversé exact
    // (4 runs jsdom, session id déterministe "80461zxuwq") : TEMPLATE de 35 paires DÉTERMINISTE (env +
    // session-id-pieces + hash "26"), avec SEULEMENT 5 positions per-run-random (16,29,30,31,32) de types
    // [1,3,1,3,3], + compteur "47". L'ancien handler cassait tout (types perdus, pas de compteur, split naïf).
    // NB : ce template suppose session id = "80461zxuwq" (déterministe jsdom) → SessionState.primaryId doit matcher.
    if (/^\[\[\[[134],/.test(inner)) {
      // [55] = énum d'intégrité env : pièces ENV (statiques) + pièces DÉRIVÉES du session-id (primaryId).
      // Reversé du genuine (id="80461zrrwq" → [55] a "80","46","rr","wq" aux positions id) : les positions
      // id-dérivées = slices de primaryId. On les rend COHÉRENTES avec ss.primaryId ([44]/[50]) au lieu de
      // hardcoder "80461zxuwq" (sinon [44]≠[55] = incohérence cross-signal détectable par tm-bl).
      const pid = String(ss.primaryId || "80461zrrwq");
      const s = (a, b) => pid.slice(a, b);
      const T = [[1,s(0,2)],[1,"21"],[1,s(8,10)],[1,"78"],[1,s(6,8)],[1,randB36(2)],[1,"1r"],[1,s(8,10)],[1,s(4,6)],[1,"5z"],[1,"jk"],[1,s(4,6)],[1,s(0,2)],[1,s(2,4)],[1,"1u"],[1,"1u"],[1,randB36(2)],[4,"tz"],[1,s(8,10)],[4,"9f"],[1,s(8,10)],[1,"zn"],[1,"pu"],[1,s(0,2)],[1,"e5"],[1,"67"],[1,s(0,2)],[1,"42"],[1,"26"],[3,randB36(2)],[1,randB36(2)],[3,randB36(2)],[3,randB36(2)],[1,"1g"],[1,"1r"]];
      return '"' + JSON.stringify([T, "47"]).replace(/"/g, '\\"') + '"';
    }
    // id simple 10 chars = primaryId
    if (/^[a-z0-9]{10}$/.test(inner)) return q ? '"' + ss.primaryId + '"' : ss.primaryId;
    // C session id (base64 d'un base36 10-15)
    if (e.mode === "C") { try { const dec = Buffer.from(e.value, "base64").toString("utf8"); if (/^[a-z0-9]{10,15}$/.test(dec)) return b64(ss.idPool[ctx.poolIdxRef() % ss.idPool.length].slice(0, dec.length)); } catch (_) {} }
    // tableau de timings [5,77850,78290,78026] — 4 éléments, 1er PETIT (<1000). STABLE via l'identité
    // persistée. NB : distinguer du tableau MÉMOIRE [4395630592,...] (1er ÉNORME) ou autres arrays.
    if (/^\[\d+,\d{4,}/.test(inner)) {
      let parsed = null; try { parsed = JSON.parse(inner); } catch (_) {}
      const isTiming = Array.isArray(parsed) && parsed.length === 4 && typeof parsed[0] === "number" && parsed[0] < 1000;
      if (isTiming) {
        // Event genuine : [petit, X, X, X] — 1er élément petit (1-4), les 3 suivants ÉGAUX (une seule
        // mesure perf répétée). Frais par solve. (Signin garde son tableau d'identité persistée.)
        if (!ctx.signin) { const x = 78000 + rnd(1200); const a = JSON.stringify([1 + rnd(4), x, x, x]); return v[0] === '"' ? '"' + a.replace(/"/g, '\\"') + '"' : a; }
        if (ss.timingArray) { const a = JSON.stringify(ss.timingArray); return v[0] === '"' ? '"' + a.replace(/"/g, '\\"') + '"' : a; }
        return this.#freshTiming(v, ss.now);
      }
      // pas un timingArray (ex mémoire) → garder la valeur du spec (contexte déterministe)
      return v;
    }
    // sessionId base36 nu (plain)
    if (/^[a-z0-9]{10,15}$/.test(inner) && !q) return ss.idPool[ctx.poolIdxRef() % ss.idPool.length].slice(0, inner.length);
    return v; // static : garder (env-constant)
  }

  #anchorSplit(anchor) {
    if (!anchor || anchor.length < 20) return null;
    // le signal [55] = anchor découpé en paires [1,"xx"] (observé "[[[1,\"80\"],[1,\"21\"],...")
    const pairs = [];
    for (let i = 0; i < anchor.length; i += 2) pairs.push([1, anchor.slice(i, i + 2)]);
    return '"' + JSON.stringify([pairs]).replace(/"/g, '\\"') + '"';
  }

  // Génère une clé de signal FRAÎCHE via le vrai mécanisme deriveSignalCode (fmix), seedée par
  // le keySeed de session (mime le perf.now runtime). Préserve la classe de magnitude du stale :
  //   - grande (>100000) → fmix brut positif < 2^31 (comme les clés dynamiques int32 du genuine)
  //   - petite → 1500 + (fmix % 2400) (plage des clés "table", cf 1573..3892 observées)
  #freshKey(staleKey, ss) {
    const raw = DeriveSignalCode.one(ss.keyCounter++ * 2654435761, ss.keySeed) | 0;
    const u = raw >>> 0;
    if (staleKey > 100000) return u % 2147483647; // grande, positive < 2^31
    return 1500 + (u % 2400);                       // petite (plage table)
  }

  // slot 73 : tableau sparse de 24, entrées [null,0,0,"b64"] aux idx 7 (9o), 23 (24o), et 20 (9o, ~50%).
  // Genuine varie ces blobs par session (collecte). On régénère frais (anti-replay).
  #freshSlot73() {
    const b64 = (n) => Buffer.from(Array.from({ length: n }, () => rnd(256))).toString("base64");
    const arr = new Array(24).fill(null);
    arr[7] = [null, 0, 0, b64(9)];
    // PAS de arr[20] : vérifié sur 2 runs jsdom frais, [73] n'a de blobs QU'aux positions 7 et 23.
    // L'ancien arr[20] stochastique (~50%) était un TELL (structure que genuine ne produit jamais).
    arr[23] = [null, 0, 0, b64(24)];
    return arr;
  }

  #freshTiming(v, now) {
    // ex "[5,77850,78290,78026]" : garder la forme, jitter les valeurs
    try {
      const arr = JSON.parse(v.replace(/^"|"$/g, ""));
      const j = arr.map((x) => (typeof x === "number" && x > 1000 ? x + rnd(2000) - 1000 : x));
      return (v[0] === '"' ? '"' + JSON.stringify(j).replace(/"/g, '\\"') + '"' : JSON.stringify(j));
    } catch { return v; }
  }

  #freshTimingVal(t, ss) {
    // le 3e élément du triple (timing key2) : SHIFT global cohérent (ss.tShift), PAS un jitter indépendant.
    // rnd(40) par slot détruisait la structure en bandes du genuine (vérifié : jsdom varie d'un shift
    // uniforme ~±5, flat faisait +0..40 indépendant = hors enveloppe). On applique le même delta partout.
    return typeof t === "number" && t > 0 ? t + ss.tShift : t;
  }
}
