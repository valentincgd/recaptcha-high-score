import { decryptConfigWithKeyCandidates } from "./vm/VmBytecodeKeys.js";

export class AnchorParser {
  static parse(html) {
    const inputRe = /id="recaptcha-token"[^>]*value="([^"]*)"/i;
    const m = html.match(inputRe);
    const token = m?.[1]?.trim() || null;
    const initString = AnchorParser.#extractMainInitString(html);
    const initPayload = initString
      ? AnchorParser.#parseInitArrayLiteral(initString)
      : AnchorParser.#extractMainInit(html);
    const config = AnchorParser.#extractConfig(initPayload);

    return {
      anchorToken: token,
      initString,
      initPayload,
      config,
      encryptionKey: config?.encryptionKey ?? null,
      configBytecode: config?.configBytecode ?? null,
    };
  }

  static #decodeJsHexEscapes(s) {
    return s.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
  }

  static #parseInitArrayLiteral(raw) {
    const decoded = AnchorParser.#decodeJsHexEscapes(raw);
    try {
      return JSON.parse(decoded);
    } catch {
      try {
        return new Function(`return (${decoded})`)();
      } catch {
        return decoded;
      }
    }
  }

  static #extractMainInitString(html) {
    const marker = "recaptcha.anchor.Main.init";
    const start = html.indexOf(marker);
    if (start === -1) return null;

    const paren = html.indexOf("(", start + marker.length);
    if (paren === -1) return null;

    let i = paren + 1;
    while (i < html.length && /\s/.test(html[i])) i++;

    const q = html[i];
    if (q === '"' || q === "'") {
      const raw = AnchorParser.#readJsQuotedString(html, i + 1, q);
      return raw ? AnchorParser.#decodeJsHexEscapes(raw) : null;
    }
    return null;
  }

  static #extractMainInit(html) {
    const marker = "recaptcha.anchor.Main.init";
    const start = html.indexOf(marker);
    if (start === -1) return null;

    const paren = html.indexOf("(", start + marker.length);
    if (paren === -1) return null;

    let i = paren + 1;
    while (i < html.length && /\s/.test(html[i])) i++;

    const q = html[i];
    if (q === '"' || q === "'") {
      const str = AnchorParser.#readJsQuotedString(html, i + 1, q);
      if (!str) return null;
      return AnchorParser.#parseInitArrayLiteral(str);
    }

    if (html[i] === "[") {
      let depth = 0;
      let inString = false;
      let escape = false;
      let quote = "";

      for (let j = i; j < html.length; j++) {
        const c = html[j];
        if (inString) {
          if (escape) {
            escape = false;
            continue;
          }
          if (c === "\\") {
            escape = true;
            continue;
          }
          if (c === quote) inString = false;
          continue;
        }
        if (c === '"' || c === "'") {
          inString = true;
          quote = c;
          continue;
        }
        if (c === "[") depth++;
        if (c === "]") {
          depth--;
          if (depth === 0) {
            return AnchorParser.#parseInitArrayLiteral(html.slice(i, j + 1));
          }
        }
      }
    }
    return null;
  }

  static #readJsQuotedString(html, start, quote) {
    let out = "";
    for (let i = start; i < html.length; i++) {
      const c = html[i];
      if (c === "\\" && i + 1 < html.length) {
        const next = html[i + 1];
        if (next === "x" && i + 3 < html.length) {
          out += `\\x${html.slice(i + 2, i + 4)}`;
          i += 3;
          continue;
        }
        if (next === "u" && i + 5 < html.length) {
          out += `\\u${html.slice(i + 2, i + 6)}`;
          i += 5;
          continue;
        }
        out += html[i + 1];
        i++;
        continue;
      }
      if (c === quote) return out;
      out += c;
    }
    return null;
  }

  static #extractConfig(init) {
    if (!Array.isArray(init)) return null;

    const conf = init.find((x) => Array.isArray(x) && x[0] === "conf");
    const result = {
      siteKey: null,
      originUrl: null,
      encryptionKey: null,
      configBytecode: null,
      collectorIndexes: null,
      vmBytecodeKeys: [],
      bftSignature: null,
      sessionMeta: null,
    };

    const tailTs = init[init.length - 1];
    if (typeof tailTs === "number" && tailTs > 1e12) result.sessionMeta = tailTs;
    // DC (clé cipher field16) = le timestamp SUIVI DE `0, 0, [array]` dans init (motif …,1,<DC>,0,0,[100,171,…]).
    // PROUVÉ par round-trip : CE timestamp (pas le tail) donne le bon d%256 → Google déchiffre field16.
    // L'ancien code prenait tailTs (le dernier) = FAUX → field16 déchiffré en garbage → score bas → 403 event.
    const findDC = (arr, depth) => {
      if (!Array.isArray(arr) || depth > 4) return null;
      for (let i = 0; i < arr.length - 3; i++) {
        if (typeof arr[i] === "number" && arr[i] > 1e12 && arr[i + 1] === 0 && arr[i + 2] === 0 && Array.isArray(arr[i + 3])) return arr[i];
      }
      for (const x of arr) { const r = findDC(x, depth + 1); if (r != null) return r; }
      return null;
    };
    const dc = findDC(init, 0);
    if (dc != null) result.encryptionKey = dc;

    for (let i = init.length - 2; i >= 0; i--) {
      const v = init[i];
      if (typeof v === "string" && /^0[3d]AFcWeA/.test(v) && !result.bftSignature) {
        result.bftSignature = v;
      }
    }

    if (conf) {
      result.siteKey = typeof conf[2] === "string" ? conf[2] : null;
      result.collectorIndexes = Array.isArray(conf[7]) ? conf[7] : null;
      for (let i = conf.length - 1; i >= 0; i--) {
        const v = conf[i];
        if (typeof v === "string" && v.length > 100 && !result.configBytecode) result.configBytecode = v;
      }
    }
    // fallbacks si le motif n'a pas matché : premier timestamp de conf, sinon tailTs
    if (result.encryptionKey == null && conf) { for (let i = 0; i < conf.length; i++) { if (typeof conf[i] === "number" && conf[i] > 1e12) { result.encryptionKey = conf[i]; break; } } }
    if (result.encryptionKey == null && typeof tailTs === "number" && tailTs > 1e12) result.encryptionKey = tailTs;

    const collectorSet = new Set(
      Array.isArray(conf?.[7]) ? conf[7].map((n) => `${n}`) : [],
    );
    const VM_KEY_SKIP = new Set(["3,1,1"]);

    for (const item of init) {
      if (!Array.isArray(item) || item === conf?.[7]) continue;
      if (item.length < 1 || item.length > 8) continue;
      if (!item.every((x) => typeof x === "number" && x >= 0 && x < 256)) continue;
      const sig = item.join(",");
      if (VM_KEY_SKIP.has(sig) || collectorSet.has(sig)) continue;
      result.vmBytecodeKeys.push(item);
    }

    if (!result.vmBytecodeKeys.length) {
      result.vmBytecodeKeys = [[176, 170, 107], [76]];
    }

    const bestBlob = AnchorParser.#pickConfigBytecode(init, result.vmBytecodeKeys);
    if (bestBlob) result.configBytecode = bestBlob;

    const originCandidate = init.find(
      (x) => typeof x === "string" && x.startsWith("https://"),
    );
    if (originCandidate) result.originUrl = originCandidate;

    return result;
  }

  /** Choisit le blob qui se déchiffre en bytecode VM valide (bgdata[4] ≫ conf[23]). */
  static #pickConfigBytecode(init, vmBytecodeKeys) {
    if (!Array.isArray(init)) return null;
    const conf = init.find((x) => Array.isArray(x) && x[0] === "conf");
    const bgdata = init.find((x) => Array.isArray(x) && x[0] === "bgdata");
    const candidates = [];
    if (typeof bgdata?.[4] === "string" && bgdata[4].length > 1000) {
      candidates.push(bgdata[4]);
    }
    if (conf) {
      for (const v of conf) {
        if (typeof v === "string" && v.length > 100 && v.length < 80_000) {
          candidates.push(v);
        }
      }
    }
    const visit = (x) => {
      if (typeof x === "string" && x.length > 100 && x.length < 80_000) {
        if (!candidates.includes(x)) candidates.push(x);
      } else if (Array.isArray(x)) for (const v of x) visit(v);
    };
    visit(init);
    let best = null;
    let bestQuality = 0;
    for (const raw of candidates) {
      try {
        const { inner, quality } = decryptConfigWithKeyCandidates(raw, vmBytecodeKeys);
        const q = quality ?? 0;
        if (q > bestQuality || (q === bestQuality && raw.length > (best?.length ?? 0))) {
          bestQuality = q;
          best = raw;
        }
      } catch {
        /* ignore */
      }
    }
    return best;
  }
}
