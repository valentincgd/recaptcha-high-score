/** Port de recaptcha-vm-main/src/bytecode/mod.rs (config anchor). */

function base64CharToValue(c) {
  if (c >= "A" && c <= "Z") return c.charCodeAt(0) - 65;
  if (c >= "a" && c <= "z") return c.charCodeAt(0) - 97 + 26;
  if (c >= "0" && c <= "9") return c.charCodeAt(0) - 48 + 52;
  if (c === "+" || c === "-") return 62;
  if (c === "/" || c === "_") return 63;
  if (c === "=" || c === ".") return 64;
  return -1;
}

export function decodeBase64Custom(encoded, lowBitsShift = 6) {
  const PADDING = 64;
  const valid = [...encoded].filter((c) => base64CharToValue(c) >= 0);
  const output = [];
  let idx = 0;

  const readNext = (fallback) => {
    if (idx < valid.length) {
      const v = base64CharToValue(valid[idx++]);
      return v;
    }
    return fallback;
  };

  for (;;) {
    const sym0 = readNext(0xff);
    const sym1 = readNext(0);
    const sym2 = readNext(PADDING);
    const sym3 = readNext(PADDING);

    if (sym3 === PADDING && sym0 === 0xff) break;

    output.push((sym0 << 2) | (sym1 >> 4));
    if (sym2 !== PADDING) {
      output.push(((sym1 << 4) & 0xf0) | (sym2 >> 2));
      if (sym3 !== PADDING) {
        output.push(((sym2 << lowBitsShift) & 0xc0) | sym3);
      }
    }
  }

  return Buffer.from(output);
}

export function xorFold(key1, key2) {
  const a = Buffer.isBuffer(key1) ? key1 : Buffer.from(key1);
  const b = Buffer.isBuffer(key2) ? key2 : Buffer.from(key2);
  let acc = 0;
  for (const byte of a) acc ^= byte;
  for (const byte of b) acc ^= byte;
  return acc & 0xff;
}

class LcgXor {
  constructor(seed) {
    this.state = BigInt(Math.abs(Number(seed)));
  }

  nextByte() {
    this.state = (4391n * this.state + 277n) % 32779n;
    return Number(this.state % 255n);
  }
}

/**
 * Déchiffrement LCG — aligné recaptcha-vm-main/src/bytecode/mod.rs :
 * UTF-8 valide → un octet LCG par scalaire Unicode (pas par octet brut).
 */
export function xorDecrypt(ciphertextBytes, seed) {
  const str = new TextDecoder("utf-8", { fatal: true }).decode(ciphertextBytes);
  const lcg = new LcgXor(seed);
  const out = Buffer.alloc(str.length);
  let i = 0;
  for (const c of str) {
    out[i++] = (c.codePointAt(0) ^ lcg.nextByte()) & 0xff;
  }
  return out;
}

/** Chaîne latin1 pour decode_bytecode (octets 0–255 → caractères). */
export function decryptedToBytecodeString(decrypted) {
  return Buffer.from(decrypted).toString("latin1");
}

export function decodeBytecode(raw) {
  return decodeBase64Custom(raw, 6);
}

/** Première couche anchor : souvent base64 custom ; assets/README parfois standard. */
export function decodeOuterLayer(raw) {
  const s = String(raw).replace(/\s/g, "");
  try {
    const std = Buffer.from(s, "base64");
    if (std.length > 32) return std;
  } catch {
    /* ignore */
  }
  return decodeBase64Custom(s, 6);
}

/** Comme recaptcha-vm disassemble main.rs : STANDARD puis xor puis inner custom. */
export function decryptConfigLayers(raw, seed) {
  const s = String(raw).replace(/\s/g, "");
  let outer = null;
  try {
    const std = Buffer.from(s, "base64");
    if (std.length > 32) outer = std;
  } catch {
    /* ignore */
  }
  if (!outer) outer = decodeBase64Custom(s, 6);
  const decrypted = xorDecrypt(outer, seed);
  const inner = decodeBytecode(decryptedToBytecodeString(decrypted));
  return { outer, decrypted, inner };
}

export function decryptConfigBytecode(raw, vmKeys = [[176, 170, 107], [76]]) {
  const pairs = [];
  if (Array.isArray(vmKeys[0]) && Array.isArray(vmKeys[1])) {
    pairs.push([vmKeys[0], vmKeys[1]]);
  }
  for (let i = 0; i < (vmKeys?.length ?? 0); i++) {
    for (let j = i + 1; j < vmKeys.length; j++) {
      if (Array.isArray(vmKeys[i]) && Array.isArray(vmKeys[j])) {
        pairs.push([vmKeys[i], vmKeys[j]]);
      }
    }
  }
  let best = null;
  for (const [k1, k2] of pairs) {
    const folded = xorFold(k1, k2);
    const decoded = decodeBytecode(raw);
    const decrypted = xorDecrypt(decoded, folded);
    const inner = decodeBytecode(decryptedToBytecodeString(decrypted));
    if (!best || inner.length > best.inner.length) {
      best = { decrypted, inner };
    }
  }
  if (best) return best.decrypted;
  const folded = xorFold(vmKeys[0], vmKeys[1]);
  return xorDecrypt(decodeBytecode(raw), folded);
}
