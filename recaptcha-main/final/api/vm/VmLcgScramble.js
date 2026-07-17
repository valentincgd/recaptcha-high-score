/** Boucles LCG du bytecode main (reg 1454 / 1846 / 1213) — pattern disassembled ~0x92ec. */

const DEFAULT_MOD = 94906238;
const DEFAULT_MUL = 13558035;
const DEFAULT_INC = 13037;

export function lcgScrambleBytes(bytes, seedState) {
  const buf = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  if (!buf.length) return buf;

  let state = ((seedState % DEFAULT_MOD) + DEFAULT_MOD) % DEFAULT_MOD;
  const out = new Uint8Array(buf.length + 4);
  out.set(buf, 0);
  const len = buf.length;
  out[len] = 0;
  out[len + 1] = 0;
  out[len + 2] = 0;
  out[len + 3] = 0;
  const limit = len + 4;

  for (let i = 0; i < limit; i++) {
    state = (state * DEFAULT_MUL + DEFAULT_INC) % DEFAULT_MOD;
    out[i] = (out[i] + state) % 256;
  }

  let hi = seedState >>> 0;
  for (let idx = limit - 1; idx >= len; idx--) {
    hi = (hi >>> 0) * 2654435761 >>> 0;
    out[idx] = hi % 256;
    hi = Math.floor(hi / 256);
  }

  return out.subarray(0, limit);
}

export function bytesToVmPayload(buf) {
  return String.fromCharCode(...[...buf].map((b) => b & 0xff));
}
