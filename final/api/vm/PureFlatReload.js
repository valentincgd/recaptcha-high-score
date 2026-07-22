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
import { Field16Cipher } from "./Field16Cipher.js";
import { Field22Bloom } from "./Field22Bloom.js";
import { Field20Telemetry } from "./Field20Telemetry.js";

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
                 anchorMs = 20000, executeMs = 30000, profile = null, encryptionKey = null, f16opts = {},
                 field7 = null, signin = false, token69 = null }) {
    if (!version || !anchorToken || !siteKey || action == null) {
      throw new Error("version, anchorToken, siteKey, action requis");
    }
    const host = originHost || (referer ? new URL(referer).host : "");

    // Champ 16 : DYNAMIQUE via Field16Collector (génère les 79 signaux depuis le profil + session,
    // tout ce qui doit varier varie : IDs, timestamps, hex, cookie GA, timings, anchor-split, DC).
    // Fallback sur le template Field16Builder si pas de collector/spec.
    // UN SessionState partagé → cohérence entre field16, field22, field20 (mêmes IDs/timestamps/widget).
    let field16, session = null;
    // OVERRIDE TEMPLATE (RC_F16_PLAINTEXT=chemin) : utilise le plaintext field16 GENUINE capture
    // (contenu byte-exact d'un vrai navigateur), rafraichit les timestamps epoch (13 chiffres, prefixe 17),
    // et re-chiffre avec le DC de l'anchor flat. Sert a tester si la qualite du field16 est le gate.
    if (process.env.RC_F16_PLAINTEXT) {
      let pt = JSON.parse(readFileSync(process.env.RC_F16_PLAINTEXT, "utf8")).plaintext;
      const base = Date.now();
      pt = pt.replace(/17\d{11}/g, () => String(base - Math.floor(Math.random() * 4000)));
      field16 = Field16Cipher.encrypt(pt, encryptionKey != null ? Number(encryptionKey) : base);
    } else if (profile && /ticketmaster/i.test(host)) {
      const col = new Field16Collector();
      const built = col.build({ profile, anchorToken, version, origin: referer || ("https://" + host), now: Date.now(), DC: encryptionKey != null ? Number(encryptionKey) : null, signin, token69 });
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
    const field20 = Field20Telemetry.build({ pageHost: host, heavy: isTMhost, enterprise: isEnt });
    // field22 COHÉRENT avec la session (widget id + g-recaptcha-response-<counter> = mêmes que field16)
    const field22 = session ? Field22Bloom.buildCoherent(session) : Field22Bloom.build(F22_ENUM);

    // Champ 7 = usagePatternToken (05A…) : token émis par le serveur (réponse /reload idx 8) d'un reload
    // ANTÉRIEUR de la même session, ré-émis en écho. NON calculable côté client (signature serveur) — il
    // est récolté par round-trip HTTP (cf. flat.mjs priming) puis passé ici. Absent au 1er reload d'une
    // session (comme le genuine : reload#1 LoginPage sans f7, reload#2+ avec). Voir memory botguard-crack-todo.
    const parts = [
      ProtobufWire.writeString(1, version),
      ProtobufWire.writeBytes(2, Buffer.from(anchorToken, "utf8")),
      ProtobufWire.writeString(5, field5),
      ProtobufWire.writeString(6, "q"),
    ];
    if (field7) parts.push(ProtobufWire.writeBytes(7, Buffer.from(String(field7), "utf8")));
    parts.push(
      ProtobufWire.writeString(8, action),
      ProtobufWire.writeString(14, siteKey),
      ProtobufWire.writeBytes(16, Buffer.from(field16, "utf8")),
      ProtobufWire.writeString(20, field20),
      ProtobufWire.writeString(22, field22),
      ProtobufWire.writeString(25, "W10"),
      ProtobufWire.writeInt32(28, Number(anchorMs) || 20000),
      ProtobufWire.writeInt32(29, Number(executeMs) || 30000),
    );
    const body = Buffer.concat(parts);

    return { body, reloadBytes: body.length, field16, field5 };
  }
}
