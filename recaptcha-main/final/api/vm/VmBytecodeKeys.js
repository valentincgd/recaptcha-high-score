import {
  xorFold,
  xorDecrypt,
  decodeBytecode,
  decodeBase64Custom,
  decryptConfigLayers,
  decryptedToBytecodeString,
} from "./BytecodeDecoder.js";
import { scoreInnerBytecode } from "./VmBytecodeValidator.js";

/** Paires de clés VM à tester (anchor init + défaut README). */
export function buildKeyPairCandidates(vmBytecodeKeys) {
  const pairs = [];
  const src = vmBytecodeKeys ?? [];

  for (let i = 0; i < src.length; i++) {
    for (let j = i + 1; j < src.length; j++) {
      if (Array.isArray(src[i]) && Array.isArray(src[j])) {
        pairs.push([src[i], src[j]]);
      }
    }
  }
  if (Array.isArray(src[0]) && Array.isArray(src[1]) && !pairs.length) {
    pairs.push([src[0], src[1]]);
  }

  const defaults = [
    [[176, 170, 107], [76]],
    [[230, 6], [224, 3]],
  ];
  for (const d of defaults) {
    const sig = `${d[0].join(",")}|${d[1].join(",")}`;
    if (!pairs.some(([a, b]) => `${a.join(",")}|${b.join(",")}` === sig)) {
      pairs.push(d);
    }
  }

  return pairs;
}

function tryDecryptInner(configBytecodeRaw, seed) {
  const attempts = [];

  attempts.push(() => decryptConfigLayers(configBytecodeRaw, seed));

  attempts.push(() => {
    const s = String(configBytecodeRaw).replace(/\s/g, "");
    const outer = decodeBase64Custom(s, 6);
    const decrypted = xorDecrypt(outer, seed);
    const inner = decodeBytecode(decryptedToBytecodeString(decrypted));
    return { decrypted, inner };
  });

  attempts.push(() => {
    const s = String(configBytecodeRaw).replace(/\s/g, "");
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
    return { decrypted, inner };
  });

  let best = null;
  for (const fn of attempts) {
    try {
      const { decrypted, inner } = fn();
      if (!inner?.length) continue;
      const quality = scoreInnerBytecode(inner);
      if (!best || quality > best.quality || (quality === best.quality && inner.length > best.inner.length)) {
        best = { decrypted, inner, quality };
      }
    } catch {
      /* try next */
    }
  }
  if (!best) throw new Error("decrypt inner failed");
  return best;
}

export function decryptConfigWithKeyCandidates(configBytecodeRaw, vmBytecodeKeys) {
  const pairs = buildKeyPairCandidates(vmBytecodeKeys);
  const errors = [];
  let best = null;

  for (const [k1, k2] of pairs) {
    try {
      const seed = xorFold(k1, k2);
      const { decrypted, inner, quality } = tryDecryptInner(configBytecodeRaw, seed);
      if (inner.length < 32) {
        errors.push(`${seed}: inner ${inner.length}b`);
        continue;
      }
      if (quality < 1) {
        errors.push(`${seed}: inner ${inner.length}b score=${quality}`);
        continue;
      }
      const entry = {
        decrypted,
        inner,
        seed,
        keys: [k1, k2],
        quality,
      };
      if (
        !best ||
        entry.quality > best.quality ||
        (entry.quality === best.quality && inner.length > best.inner.length)
      ) {
        best = entry;
      }
    } catch (err) {
      errors.push(err.message);
    }
  }

  if (best) return best;
  throw new Error(`config bytecode: ${errors.slice(0, 4).join(" | ")}`);
}
