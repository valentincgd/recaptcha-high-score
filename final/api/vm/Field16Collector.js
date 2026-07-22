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
  1300596863, 1536057308, 1625, 1619, 1888, 1899401862, 3055,
]);

const __dir = dirname(fileURLToPath(import.meta.url));

function rnd(n) { return Math.floor(Math.random() * n); }
function randB36(len) { const A = "abcdefghijklmnopqrstuvwxyz0123456789"; let s = ""; for (let i = 0; i < len; i++) s += A[rnd(36)]; return s; }
function randHex(len) { const A = "0123456789abcdef"; let s = ""; for (let i = 0; i < len; i++) s += A[rnd(16)]; return s; }
function b64(s) { return Buffer.from(String(s), "utf8").toString("base64"); }

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
  build({ profile, anchorToken = "", version = "", origin = "https://www.ticketmaster.com", now = Date.now(), DC = null, session = null, signin = false, token69 = null }) {
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
      if (e.raw !== undefined && e.i === 73) { slots.push(this.#freshSlot73()); continue; }
      // slot 64 : raw numérique, genuine ~489-520 (varie par session) ; la spec figeait 1081 (périmé). Régénère.
      if (e.raw !== undefined && e.i === 64) { slots.push(485 + rnd(40)); continue; }
      if (e.raw !== undefined) { slots.push(e.raw); continue; }
      let v = this.#coherentValue(e, ss, { tzOff, version, origin, poolIdxRef: () => poolIdx++, signin, token69 });
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

    // --- Fixes SIGN-IN (context-aware) : aligner sur le genuine browser là où le spec jsdom fuit ---
    // Event garde le spec (il passe déjà) ; sign-in (forte scrutation enterprise) reçoit les vraies valeurs.
    // Réf : repo elyelysiox/recaptcha (fingerprint/decrypted_values.json) + REVERSE_FIELD16_AUDIT.md.
    if (ctx.signin) {
      // [52] userActivation : jsdom fuit "NaN[object Object]" (navigator.userActivation absent en jsdom).
      // Genuine = 10*isActive+hasBeenActive. En sign-in l'utilisateur a saisi ses creds → hasBeenActive=1 → "11".
      if (e.i === 52) return '"11"';
      // [49] resourceTiming du script recaptcha : jsdom "." (entrée introuvable). Genuine = "<proto>-0" ex "h2-0".
      if (e.i === 49) return '"h2-0"';
      // [35] activeElement : jsdom "0,BODY,…" (focus body). En sign-in le focus est un <input> (email/pwd) →
      // "0,INPUT,sha256('INPUT')[:8]" (isPurchase=0). BODY comme activeElement pendant une saisie = tell.
      if (e.i === 35) return '"0,INPUT,' + domHash8("INPUT") + '"';
      // [69] token session (09A humanVerification) : "increments the score if valid" (README idx69). NON
      // calculable — signature serveur = réponse /reload idx 12 d'un reload antérieur, échotée (comme le
      // champ 7). Récolté par le priming (flat.mjs) et injecté ici. Sinon on garde le fake (id random).
      if (e.i === 69 && ctx.token69) return '"' + String(ctx.token69).replace(/"/g, '\\"') + '"';
    }

    // slot 41 (clé spec 2103480962) : signal court qui VARIE par session (jsdom "nn"/";;"/""). flat gardait
    // "" figé → mini replay tell. On régénère une chaîne courte quotée variable (même mode shuffle du spec).
    // Vérifié sur 2 runs jsdom frais : slot 41 émet STABLEMENT "" (vide). L'ancienne règle (doublé "cc")
    // produisait une valeur que jsdom n'émet pas → on aligne sur le stable observé.
    if (e.key === 2103480962) return '""';
    // fnToString (getters performance/history) : on GARDE la source exacte du spec (= ce que jsdom émet
    // et qui PASSE), au lieu de forcer "[native code]". RC_NATIVE_FN=1 pour revenir au natif Chrome.
    // Getters performance/history : jsdom fuit `get x() { return idlUtils.wrapperForImpl… }` — chaîne
    // qui n'existe dans AUCUN Chrome réel (tell pur). En sign-in (forte scrutation) OU RC_NATIVE_FN,
    // on émet le natif Chrome `get x() { [native code] }`. Event garde le spec jsdom (il passe).
    const fn = /get (\w+)\(\)/.exec(inner);
    if (fn) return (process.env.RC_NATIVE_FN === "1" || ctx.signin) ? '"' + NATIVE_FN(fn[1]).replace(/"/g, '\\"') + '"' : v;
    // timezone + timestamp : [-120,null,<ts>]. Genuine = STRING QUOTÉE "[-120,null,ts]" (vérifié jsdom [68]).
    // BUG corrigé : flat retournait l'array NU (sans guillemets) → type différent côté Google. On garde les guillemets.
    if (/^\[-?\d+,null,\d{13}\]$/.test(inner)) { const a = `[${ctx.tzOff},null,${ss.tEvent}]`; return q ? '"' + a + '"' : a; }
    // cookie GA
    if (/^GA1\.\d/.test(inner)) return '"' + ss.gaCookie + '"';
    // widget id : genuine émet TOUJOURS "rc::d-<timestamp>" (vérifié 2 runs jsdom : rc::d-1784487833415).
    // La spec avait "rc::a" (périmé) → on émet systématiquement ss.widgetId (rc::d-<tWidget>).
    if (/^rc::/.test(inner)) return '"' + ss.widgetId + '"';
    // URL gstatic release (version)
    if (/gstatic\.com\/recaptcha\/releases/.test(inner)) return (q ? '"' : "") + inner.replace(/releases\/[A-Za-z0-9_-]+/g, `releases/${ctx.version || "VER"}`) + (q ? '"' : "");
    // URL de la page (origin)
    if (/^https:\/\/[a-z0-9.-]*(ticketmaster|appspot|google)/i.test(inner)) {
      if (/google\.com/.test(inner)) return v; // google.com reste
      return '"' + ctx.origin.replace(/\/$/, "") + "/" + '"';
    }
    // signal ressource "N,<hex8>" (genuine ex "6,ed19bca9") = index + sha256(ressource)[:8] (MÊME algo DOM,
    // SHA-256 reversé). Varie par session (jsdom "6,ed19bca9"/"2,b773097d"). On applique le VRAI hash sur
    // une ressource plausible (script gstatic recaptcha) + composante session → "N,sha256hex8" genuine.
    if (/^\d+,[0-9a-f]{8}$/.test(inner)) {
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
    // structure [50] user-activation : genuine (10 élts) = [count,timeout,null,mult,transitions,
    // [hoverHashed],sessionId_b64,userActivationScore,null,[[flags]]]. Le spec jsdom TM droppe les 3
    // derniers (7 élts) → OK pour event, mais tell en sign-in. En sign-in on émet la forme COMPLÈTE.
    if (/^\[1,0,null,1,1,\[/.test(inner)) {
      const core = [1, 0, null, 1, 1, [ss.primaryId], b64(ss.embeddedId)];
      const full = ctx.signin ? [...core, 0, null, [[1]]] : core;
      return '"' + JSON.stringify(full).replace(/"/g, '\\"') + '"';
    }
    // [55] = énumération d'intégrité env encodée (paires [type,code2char] + compteur). Reversé exact
    // (4 runs jsdom, session id déterministe "80461zxuwq") : TEMPLATE de 35 paires DÉTERMINISTE (env +
    // session-id-pieces + hash "26"), avec SEULEMENT 5 positions per-run-random (16,29,30,31,32) de types
    // [1,3,1,3,3], + compteur "47". L'ancien handler cassait tout (types perdus, pas de compteur, split naïf).
    // NB : ce template suppose session id = "80461zxuwq" (déterministe jsdom) → SessionState.primaryId doit matcher.
    if (/^\[\[\[[134],/.test(inner)) {
      const T = [[1,"80"],[1,"21"],[1,"1r"],[1,"78"],[1,"xu"],[1,"op"],[1,"1r"],[1,"wq"],[1,"1z"],[1,"5z"],[1,"jk"],[1,"1z"],[1,"80"],[1,"46"],[1,"1u"],[1,"1u"],[1,randB36(2)],[4,"tz"],[1,"wq"],[4,"9f"],[1,"wq"],[1,"zn"],[1,"pu"],[1,"80"],[1,"e5"],[1,"67"],[1,"80"],[1,"42"],[1,"26"],[3,randB36(2)],[1,randB36(2)],[3,randB36(2)],[3,randB36(2)],[1,"1g"],[1,"1r"]];
      return '"' + JSON.stringify([T, "47"]).replace(/"/g, '\\"') + '"';
    }
    // id simple 10 chars = primaryId
    if (/^[a-z0-9]{10}$/.test(inner)) return q ? '"' + ss.primaryId + '"' : ss.primaryId;
    // C session id (base64 d'un base36 10-15)
    if (e.mode === "C") { try { const dec = Buffer.from(e.value, "base64").toString("utf8"); if (/^[a-z0-9]{10,15}$/.test(dec)) return b64(ss.idPool[ctx.poolIdxRef() % ss.idPool.length].slice(0, dec.length)); } catch (_) {} }
    // tableau de timings [5,77850,...] — STABLE via l'identité persistée (jsdom le réutilise à l'identique)
    if (/^\[\d+,\d{4,}/.test(inner)) {
      if (ss.timingArray) { const a = JSON.stringify(ss.timingArray); return v[0] === '"' ? '"' + a.replace(/"/g, '\\"') + '"' : a; }
      return this.#freshTiming(v, ss.now);
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
