/**
 * SessionState — état de session COHÉRENT partagé par TOUS les champs du /reload.
 * Généré UNE fois par token ; référencé identiquement dans field16, field22, field20.
 * C'est la clé de la cohérence : les mêmes IDs/timestamps/widget apparaissent au même endroit
 * partout (ex field16[44]==field16[50] id ; field16[58] rc::d-<ts> et [68] même timeline ;
 * field22 widget a-<id> + g-recaptcha-response-<counter>).
 *
 * Tout est DYNAMIQUE (change à chaque token). Le profil fingerprint fournit les constantes device
 * (timezone, UA, écran…).
 */
import { readFileSync, writeFileSync } from "fs";

function rnd(n) { return Math.floor(Math.random() * n); }
function b36(len) { const A = "abcdefghijklmnopqrstuvwxyz0123456789"; let s = ""; for (let i = 0; i < len; i++) s += A[rnd(36)]; return s; }
function hex(len) { const A = "0123456789abcdef"; let s = ""; for (let i = 0; i < len; i++) s += A[rnd(16)]; return s; }

// IDENTITÉ DE SESSION PERSISTÉE — comme le cookie-store d'un navigateur. jsdom RÉUTILISE la même
// identité (session id, GA cookie, hex8, DOM hash, timing array) entre runs → « client établi » → score
// haut. Vérifié : ces valeurs sont STABLES entre 2 runs jsdom frais. flat qui randomise à chaque token
// paraît un visiteur neuf → score bas. On persiste donc une identité stable (générée 1×, réutilisée),
// SANS hardcode : générée aléatoirement au 1er run puis vieillie. RC_IDENTITY_FILE = chemin ; RC_NO_IDENTITY=1 coupe.
let _identity = null;
function freshIdentity(now) {
  return {
    primaryId: b36(10), embeddedId: b36(13), domHex: hex(8), hex8: hex(8),
    gaCookie: "GA1.1." + rnd(2147483647) + "." + (Math.floor(now / 1000) - rnd(30000000)),
    idPool: Array.from({ length: 8 }, () => b36(13 + rnd(2))), // 13-14 chars (observé jsdom)
    timingArray: [10, 77000 + rnd(2000), 78000 + rnd(600), 77800 + rnd(500)],
  };
}
function loadIdentity(now) {
  if (process.env.RC_NO_IDENTITY === "1") return null;
  // DÉFAUT : identité FRAÎCHE à CHAQUE token — chaque token = un utilisateur unique (session-id, GA, hex8,
  // timing tous nouveaux), comme un vrai navigateur. Sinon TOUS les tokens partageraient la même identité
  // = tell de replay évident à l'échelle (reCAPTCHA flag). RC_IDENTITY_FILE=<chemin> → identité PERSISTÉE
  // (un seul "client vieilli", utile pour un usage mono-session à haut score, PAS pour du volume).
  const file = process.env.RC_IDENTITY_FILE || null;
  if (!file) return freshIdentity(now);
  if (_identity) return _identity;
  try { _identity = JSON.parse(readFileSync(file, "utf8")); return _identity; } catch (_) {}
  _identity = freshIdentity(now);
  try { writeFileSync(file, JSON.stringify(_identity, null, 1)); } catch (_) {}
  return _identity;
}

export class SessionState {
  /**
   * @param {object} o
   *   o.profile     profil fingerprint (source device : timezoneOffset, ...)
   *   o.anchorToken token anchor de la session
   *   o.now         base temporelle ms (défaut Date.now())
   */
  constructor({ profile = {}, anchorToken = "", now = Date.now() } = {}) {
    this.profile = profile;
    this.anchorToken = anchorToken;
    this.now = now;
    // Timezone du field16 [68] = celle du PROFIL (`timezoneOffset`, style getTimezoneOffset : 480 pour
    // America/Los_Angeles, -120 pour Europe/Paris été). Le fingerprint doit être cohérent : un profil macOS
    // Los Angeles doit émettre sa tz, pas celle du serveur. RC_TZ force une valeur (ex si le proxy impose
    // une géoloc). Fallback runtime puis 0 si le profil n'a pas de tz.
    let runtimeTz; try { runtimeTz = new Date().getTimezoneOffset(); } catch { runtimeTz = null; }
    this.tzOffset = process.env.RC_TZ != null && process.env.RC_TZ !== "" ? Number(process.env.RC_TZ)
      : (profile.timezoneOffset != null ? profile.timezoneOffset : (runtimeTz != null ? runtimeTz : 0));

    // Timeline COHÉRENTE (observé : [58] widget T, [68] event T+~37ms, reload T+~356ms).
    // On modélise une base T = now, puis des offsets ms réalistes distincts (jamais le même partout).
    this.tWidget = now;                          // création widget → [58] rc::d-<tWidget>
    this.tEvent = now + 25 + rnd(30);            // event/collecte → [68] [-tz,null,tEvent]  (+25-55ms)
    this.tReload = now + 300 + rnd(120);         // envoi reload (+300-420ms)
    this.elapsed = 650 + rnd(120);               // ms écoulées depuis load (key2 timings ~650-770)

    // Identité persistée (stable entre tokens = « client établi », comme jsdom). Fallback random.
    const idn = loadIdentity(now) || {};
    // ID principal (ex "80461zxuwq") — partagé field16[44], [50] ET slot 55. DÉTERMINISTE dans jsdom
    // (identique sur 4 runs, même sans cookie) → on prend la valeur persistée (défaut jsdom "80461zxuwq").
    this.primaryId = idn.primaryId || b36(10);
    // ID secondaire embarqué dans [50] : RANDOM par session dans jsdom (vérifié : [50] varie) → toujours frais.
    this.embeddedId = b36(13);
    // hex DOM (ex "30e7e41e") — field16[35]
    this.domHex = idn.domHex || hex(8);
    // widget id (ex "rc::d-<ts>") — field16[58], timestamp = création widget
    this.widgetId = "rc::d-" + this.tWidget;
    // widget id field22 (ex "a-bshe5ddqew9w") + compteur réponse
    this.gWidgetId = "a-" + b36(12);
    this.responseCounter = 100000; // base observée (le widget grecaptcha)
    this.gResponseId = "g-recaptcha-response-" + this.responseCounter;
    // ID unique Closure library : "closure_lm_" + Math.floor(Math.random()*1e6) — logique EXACTE du script
    // (readable L12947 : EI = "closure_lm_" + (D8()*1E6|0), D8=Math.random). Range [0,999999], fixé une fois
    // au load, ne dérive de RIEN d'antérieur (vérifié empiriquement 3 runs jsdom) → non validable serveur.
    this.closureLm = "closure_lm_" + rnd(1000000);
    // pool d'IDs session base36 (field16[66-71,75]) : RANDOM par session dans jsdom (vérifié : varient) → frais
    this.idPool = Array.from({ length: 8 }, () => b36(13 + rnd(2)));
    // cookie Google Analytics (field16[78]) — STABLE (persisté), comme le _ga d'un navigateur
    this.gaCookie = idn.gaCookie || ("GA1.1." + rnd(2147483647) + "." + (Math.floor(now / 1000) - rnd(30000000)));
    // hex 8 divers (ex "202a957a") — field16[29] — STABLE (hash d'env persistant)
    this.hex8 = idn.hex8 || hex(8);
    // timing array [63] (ex [10,77850,78290,78026]) — STABLE (perf de la session établie)
    this.timingArray = idn.timingArray || [10, 77000 + rnd(2000), 78000 + rnd(600), 77800 + rnd(500)];
    // hex 4 (field16[4])
    this.hex4 = hex(4);
    // compteur (field16[64])
    this.counter = 5800 + rnd(800);

    // Seed de la chaîne de clés signaux (deriveSignalCode). Dans le genuine il vient d'un
    // performance.now() runtime (trace : w≈6910.4375 → seed) → NON transmis, non recalculable serveur.
    // On le régénère frais à chaque session pour que les clés dynamiques VARIENT (pas de tell de replay).
    this.keySeed = (rnd(2147483647) ^ (now & 0xffffffff)) | 0;
    this.keyCounter = 0; // incrémenté par clé dynamique dérivée

    // Décalage GLOBAL cohérent des timings field16 (3e élément des triples). Observé jsdom-vs-jsdom :
    // les timings varient d'un SHIFT quasi-uniforme (~±5ms, max 16) qui PRÉSERVE la structure en bandes,
    // PAS d'un bruit indépendant par slot. Un seul delta par session → structure genuine conservée.
    this.tShift = rnd(9) - 4; // [-4, +4]
  }

  /** Nonces random du signal [55] (segments variables : 2-char et 8-char base36). */
  rand55a() { return b36(2); }
  rand55b() { return b36(8); }

  /**
   * Valeurs d'énumération session-spécifiques pour le bloom field22 (à MERGER avec les globals).
   * Vérifié contre capture jsdom genuine (reload HTTP 200) : t1-t6/be = labels STATIQUES réellement
   * insérés ; closureLm/gWidgetId/gResponseId = IDs qui VARIENT à chaque page (non validables serveur).
   */
  field22SessionValues() {
    return ["t1", "t2", "t3", "t4", "be", "t5", "t6", this.closureLm, this.gResponseId, this.gWidgetId];
  }
}
