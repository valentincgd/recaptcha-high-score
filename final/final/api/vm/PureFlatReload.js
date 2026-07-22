/**
 * PureFlatReload — assemble le body /reload FLAT (12 champs) 100 % pur Node, avec les builders
 * byte-exact reversés (Field16Builder, Field22Bloom, hashString) + données mockées plausibles.
 *
 * Format aligné sur la capture réelle acceptée (HTTP 200) : champs 1,2,5,6,8,14,16,20,22,25,28,29
 * (PAS de 7 ni 21 — comme le vrai /reload navigateur).
 *
 *   1  version        (input, du bootstrap)
 *   2  anchorToken    (input, du GET /anchor)
 *   5  fingerprintHash = hashString(field16_plaintext)     ← CRACKÉ
 *   6  challengeType  = "q"
 *   8  action         (input)
 *   14 siteKey        (input)
 *   16 blob chiffré   = Field16Builder (template + nonces frais)   ← byte-exact
 *   20 telemetry      = base64(JSON template).slice(2)             ← byte-exact
 *   22 bloom filter   = Field22Bloom(enum)                          ← byte-exact
 *   25 events         = "W10"  ([])
 *   28 anchorMs / 29 executeMs = constants
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { ProtobufWire } from "../ProtobufWire.js";
import { HashUtil } from "../HashUtil.js";
import { Field16Builder } from "./Field16Builder.js";
import { Field16Collector } from "./Field16Collector.js";
import { Slot73Collector } from "./Slot73Collector.js";
import { Field22Bloom } from "./Field22Bloom.js";
import { Field20Telemetry } from "./Field20Telemetry.js";
import { Field7Aux } from "./Field7Aux.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const F22_ENUM = JSON.parse(readFileSync(join(__dir, "field22_enum_values.json"), "utf8"));

// Template field16 par host : TM utilise un template capturé sur www.ticketmaster.com (script
// enterprise), sinon le template démo. Le contexte du template doit matcher la cible.
function pickTemplate(host) {
  const isTM = /ticketmaster/i.test(host || "");
  const path = join(__dir, isTM ? "field16_template_tm.json" : "field16_template.json");
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch { return JSON.parse(readFileSync(join(__dir, "field16_template.json"), "utf8")); }
}

// field25 (sign-in) = table de fréquence de 6 codes FIXES (session-invariants, vérifiés 2 sessions) +
// compteurs comportementaux plausibles. Format : base64(JSON [[[code,count],...]]).
// field25 = compteurs d'events du VRAI login (genuine : focusin=6, pointermove=3, pointerdown=3,
// pointerup=3, keydown=40, keyup=40). Les 40 frappes = email(~24)+password(~16). STRUCTURE cohérente :
// keydown==keyup≈longueur creds, pointerdown≈pointerup (clics), focusin quelques-uns. Random 2-41 sur les 6
// (ancien) = incohérent (bot). On reproduit la structure humaine d'un login.
function buildField25() {
  const keys = 34 + Math.floor(Math.random() * 12); // ~34-45 frappes (email+password)
  const pd = 2 + Math.floor(Math.random() * 3);      // clics (pointerdown≈pointerup)
  const pairs = [
    [35837, 4 + Math.floor(Math.random() * 5)],      // focusin
    [5006, 2 + Math.floor(Math.random() * 4)],       // pointermove
    [64607, pd],                                     // pointerdown
    [45464, pd],                                     // pointerup
    [31617, keys],                                   // keydown
    [37178, keys],                                   // keyup
  ];
  return Buffer.from(JSON.stringify([pairs]), "utf8").toString("base64").replace(/=+$/, "");
}

export class PureFlatReload {
  /**
   * @param {object} o
   * @param {string} o.version, o.anchorToken, o.siteKey, o.action
   * @param {string} [o.originHost]  host de la page (pour le champ 20). Défaut : déduit du referer.
   * @param {string} [o.referer]
   * @param {number} [o.anchorMs=20000], [o.executeMs=30000]
   * @param {object} [o.f16opts]  options passées à Field16Builder.build
   * @returns {{body:Buffer, reloadBytes:number, field16:string, field5:string}}
   */
  static build({ version, anchorToken, siteKey, action, originHost = null, referer = null,
                 anchorMs = 20000, executeMs = 30000, profile = null, encryptionKey = null, anchor = null, f16opts = {} }) {
    if (!version || !anchorToken || !siteKey || action == null) {
      throw new Error("version, anchorToken, siteKey, action requis");
    }
    const host = originHost || (referer ? new URL(referer).host : "");

    // Champ 16 : DYNAMIQUE via Field16Collector (génère les 79 signaux depuis le profil + session,
    // tout ce qui doit varier varie : IDs, timestamps, hex, cookie GA, timings, anchor-split, DC).
    // Fallback sur le template Field16Builder si pas de collector/spec.
    // UN SessionState partagé → cohérence entre field16, field22, field20 (mêmes IDs/timestamps/widget).
    // Contexte SIGN-IN (auth TM, sitekey ZB, action login) → spec dédié capturé du browser genuine
    // (valeurs auth : URL oauth, titre "Ticketmaster Sign In", écran, hosts nudata…). Sinon spec event.
    const isSignin = /auth\.ticketmaster/i.test(host) || String(siteKey).startsWith("6LdoaXQr") || /^login$/i.test(String(action));
    let field16, session = null;
    if (profile && /ticketmaster/i.test(host)) {
      const specPath = isSignin ? join(__dir, "field16_spec_signin.json") : undefined;
      const col = new Field16Collector(specPath);
      // Sign-in : encKey botguard du slot73 = 3ème constante du config anchor (≠ DC field16).
      let slot73EncKey = null;
      if (isSignin && anchor) { try { slot73EncKey = Slot73Collector.extractEncKey(anchor); } catch (_) {} }
      const built = col.build({ profile, anchorToken, version, origin: referer || ("https://" + host), pageUrl: referer || ("https://" + host), signin: isSignin, slot73EncKey, now: Date.now(), DC: encryptionKey != null ? Number(encryptionKey) : null });
      field16 = built.field16; session = built.session;
    } else {
      const builder = new Field16Builder(pickTemplate(host));
      const f16o = { profile, ...f16opts };
      if (encryptionKey != null && f16o.DC == null) f16o.DC = Number(encryptionKey);
      field16 = builder.build(f16o);
    }
    const slots = Field16Builder.decode(field16);
    const field5 = String(HashUtil.hashString(JSON.stringify(slots)));

    // Télémétrie : profil "heavy" (page lourde) pour www.ticketmaster.com — [0]=[[1,92,40]], perf élevée,
    // sinon profil démo (léger). Un field20 démo envoyé à TM est un tell (perf trop basse). Cf. captures genuine.
    const isTMhost = /ticketmaster/i.test(host);
    // field20 : flat tourne en mode STANDARD (comme le jsdom qui passe) → structure SIMPLE heavy
    // ([[1,92,40]],null,...) et PAS enterprise-riche (qui ne correspond pas au mode standard).
    // enterprise=true seulement si RC_FORCE_ENTERPRISE (cohérence mode/telemetry).
    const isEnt = process.env.RC_FORCE_ENTERPRISE === "1";
    const field20 = Field20Telemetry.build({ pageHost: host, heavy: isTMhost, enterprise: isEnt, signin: isSignin });
    // field22 COHÉRENT avec la session (widget id + g-recaptcha-response-<counter> = mêmes que field16)
    const field22 = session ? Field22Bloom.buildCoherent(session) : Field22Bloom.build(F22_ENUM);

    // Champs 7/21 (blobs botguard) : ajoutés en sign-in pour un payload STRUCTURELLEMENT complet
    // (12 champs comme le genuine). Contenu chiffré non-validable serveur (mur botguard) mais forme exacte.
    const aux = isSignin ? Field7Aux.build() : null;

    const parts = [
      ProtobufWire.writeString(1, version),
      ProtobufWire.writeBytes(2, Buffer.from(anchorToken, "utf8")),
      ProtobufWire.writeString(5, field5),
      ProtobufWire.writeString(6, "q"),
    ];
    if (aux) parts.push(ProtobufWire.writeString(7, aux.field7));
    parts.push(
      ProtobufWire.writeString(8, action),
      ProtobufWire.writeString(14, siteKey),
      ProtobufWire.writeBytes(16, Buffer.from(field16, "utf8")),
      ProtobufWire.writeString(20, field20),
    );
    if (aux) parts.push(ProtobufWire.writeString(21, aux.field21));
    parts.push(
      ProtobufWire.writeString(22, field22),
      ProtobufWire.writeString(25, isSignin ? buildField25() : "W10"),
      ProtobufWire.writeInt32(28, Number(anchorMs) || 20000),
      ProtobufWire.writeInt32(29, Number(executeMs) || 30000),
    );
    const body = Buffer.concat(parts);

    return { body, reloadBytes: body.length, field16, field5 };
  }
}
