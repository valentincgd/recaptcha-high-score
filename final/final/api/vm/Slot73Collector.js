/**
 * Slot73Collector — génère le field16 slot 73 RICHE (signaux botguard), 100% flat.
 *
 * Reverse (2026-07-21) : slot73 = tableau sparse de 27, entrées [null,0,0,b64([cipher][runtimeSeed])].
 * Cipher = SignalEncryptor (LCG), byte-exact. encKey = 3ème constante numérique du config bytecode
 * de l'anchor (session-variante). signalKey = ID reCAPTCHA canonique FIXE par signal (417=UA vérifié
 * sur 2 sessions). Chaque signal = SignalEncryptor.encrypt(valeur, encKey, signalKey).
 *
 * Valeurs : device (UA/WebGL/mémoire) depuis le profil fingerprint ; comportement (souris/perf) et
 * flags/compteurs depuis un template capturé (slot73_template.json). runtimeSeed frais par signal.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { SignalEncryptor } from "./SignalEncryptor.js";
import { decryptConfigWithKeyCandidates } from "./VmBytecodeKeys.js";
import { VmDisassembler } from "./VmDisassembler.js";

const __dir = dirname(fileURLToPath(import.meta.url));

function rnd(n) { return Math.floor(Math.random() * n); }

export class Slot73Collector {
  constructor(templatePath) {
    this.tpl = JSON.parse(readFileSync(templatePath || join(__dir, "slot73_template.json"), "utf8"));
  }

  /**
   * Extrait l'encKey (3ème constante numérique du config bytecode) depuis un anchor parsé.
   * @param {object} anchor  résultat de AnchorParser.parse (avec configBytecode + config.vmBytecodeKeys)
   * @returns {number|null}
   */
  static extractEncKey(anchor) {
    try {
      const dec = decryptConfigWithKeyCandidates(anchor.configBytecode, anchor.config.vmBytecodeKeys);
      const dis = new VmDisassembler(dec.inner);
      try { dis.dispatch(); } catch (_) {}
      const nums = [];
      for (const ins of dis.instructions) {
        const v = ins.value;
        const n = v && typeof v === "object" ? (v.n ?? v.value) : v;
        if (typeof n === "number") nums.push(n);
      }
      // Ordre observé : [petit, petit, ENCKEY, 94906238(LCG mod), 13558035, 13037, ...]
      // → l'encKey est la 1ère grande constante AVANT les constantes LCG.
      const lcgIdx = nums.indexOf(94906238);
      if (lcgIdx >= 1) return nums[lcgIdx - 1];
      return nums[2] ?? null;
    } catch (_) { return null; }
  }

  /**
   * Construit le tableau slot73 (27) avec les 17 signaux chiffrés.
   * @param {object} o
   *   o.encKey   clé de session (Slot73Collector.extractEncKey)
   *   o.profile  profil fingerprint (UA, webgl, hardwareConcurrency, deviceMemory)
   * @returns {Array} slot73 (longueur 27)
   */
  build({ encKey, profile = {} }) {
    if (encKey == null) throw new Error("Slot73Collector: encKey requis");
    const arr = new Array(27).fill(null);
    for (const [idxStr, spec] of Object.entries(this.tpl)) {
      const idx = Number(idxStr);
      const value = this.#valueFor(idx, spec.v, profile);
      const enc = SignalEncryptor.encrypt(String(value), Number(encKey), Number(spec.sk));
      arr[idx] = [null, 0, 0, Buffer.from(enc).toString("base64")];
    }
    return arr;
  }

  // Valeur du signal : device depuis le profil, comportement/flags depuis le template (frais/jitter).
  #valueFor(idx, tplValue, profile) {
    switch (idx) {
      case 0: // UA
        return profile.userAgent || tplValue;
      case 26: { // WebGL ["vendor","renderer",extCount]
        const w = profile.webgl;
        if (w && w.unmaskedVendor && w.renderer) return JSON.stringify([w.unmaskedVendor, w.renderer, w.extensionCount ?? 35]);
        return tplValue;
      }
      case 25: { // [hardwareConcurrency, deviceMemory-ish, memoryBytes]
        const hc = profile.hardwareConcurrency, dm = profile.deviceMemory;
        if (hc != null && dm != null) return JSON.stringify([hc, dm * 2, dm * 1073741824]);
        return tplValue;
      }
      case 18: // événements souris : jitter léger des timings/coords pour ne pas rejouer à l'identique
        return this.#jitterMouse(tplValue);
      case 11: case 14: case 17: // perf/timing : jitter léger
        return this.#jitterNums(tplValue);
      default:
        return tplValue; // flags/compteurs : template (structure stable)
    }
  }

  #jitterNums(v) {
    try { const a = JSON.parse(v); const j = JSON.parse(JSON.stringify(a)); this.#walkJitter(j); return JSON.stringify(j); }
    catch { return v; }
  }
  #jitterMouse(v) { return this.#jitterNums(v); }
  #walkJitter(x) {
    if (Array.isArray(x)) { for (let i = 0; i < x.length; i++) { if (typeof x[i] === "number" && x[i] > 100 && Number.isFinite(x[i])) x[i] = x[i] + rnd(20) - 10; else this.#walkJitter(x[i]); } }
  }
}
