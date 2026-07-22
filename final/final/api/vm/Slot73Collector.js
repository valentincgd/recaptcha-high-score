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
      // 2e élément (N) = compteur de collecte du signal — VARIE par signal (genuine décodé : [0]=4, [10]=1,
      // [26]=5, la plupart=0). L'ancien 0 systématique = tell. spec.n si présent, sinon 0.
      arr[idx] = [null, spec.n != null ? spec.n : 0, 0, Buffer.from(enc).toString("base64")];
    }
    return arr;
  }

  // Valeur du signal :
  //  - DEVICE (idx0=UA/sk417, idx26=WebGL/sk1310, idx25=hardware/sk1994) → depuis le profil fingerprint
  //    (varie en tournant de profil ; c'est de l'empreinte device, pas du comportement).
  //  - COMPORTEMENTAL + TIMING (souris sk352, clavier sk549, pressed sk659, scroll sk959, perf sk1092,
  //    clearTimeout sk41/43, visibilité sk895, runtime VM…) → RÉGÉNÉRÉ FRAIS à CHAQUE solve. Le template
  //    ne sert QUE de forme ; toutes les valeurs (timestamps, coordonnées, durées, timings ms) sont
  //    tirées neuves → deux solves n'ont JAMAIS les mêmes signaux (sinon = tell de replay évident).
  #valueFor(idx, tplValue, profile) {
    switch (idx) {
      case 0:
        return profile.userAgent || tplValue;
      case 26: {
        const w = profile.webgl;
        if (w && w.unmaskedVendor && w.renderer) return JSON.stringify([w.unmaskedVendor, w.renderer, w.extensionCount ?? 35]);
        return tplValue;
      }
      case 25: {
        const hc = profile.hardwareConcurrency, dm = profile.deviceMemory;
        if (hc != null && dm != null) return JSON.stringify([hc, dm * 2, dm * 1073741824]);
        return tplValue;
      }
      default:
        return this.#fresh(tplValue); // comportemental/timing/flags → valeurs neuves (forme préservée)
    }
  }

  /** Régénère un signal en gardant sa FORME (structure du template) mais avec des valeurs NEUVES.
   *  Chaque nombre est retiré selon sa magnitude : timestamps/ids (≥1000) ±30 %, coords/durées (≥20) ±15,
   *  petits entiers (flags/index) et non-finis (Infinity) inchangés, floats (timings ms) ±20 %. */
  #fresh(v) {
    try { return JSON.stringify(this.#walk(JSON.parse(v))); } catch { return v; }
  }
  #walk(x) {
    if (Array.isArray(x)) return x.map((e) => this.#walk(e));
    if (typeof x === "number") return this.#freshVal(x);
    return x;
  }
  #freshVal(v) {
    if (!Number.isFinite(v) || v === 0) return v;         // Infinity / 0 (structure) → gardés
    const a = Math.abs(v);
    if (Number.isInteger(v)) {
      if (a >= 1000) return Math.max(1, Math.round(v * (0.7 + Math.random() * 0.6))); // timestamps/ids
      if (a >= 20) return v + rnd(31) - 15;                                            // coords/durées
      return v;                                                                        // petits (flags/index)
    }
    return v * (0.8 + Math.random() * 0.4);                                            // floats (timings ms)
  }
}
