/**
 * tools/protobuf.js — Décodeur protobuf minimal (juste ce qu'il faut pour /reload).
 * Extrait les champs top-level d'un message protobuf en une map { field: [values...] }.
 * ⚠️ Recherche/éducatif.
 */
'use strict';

function readVarint(buf, pos) {
  let result = 0n, shift = 0n, byte;
  do {
    byte = buf[pos++];
    result |= BigInt(byte & 0x7f) << shift;
    shift += 7n;
  } while (byte & 0x80);
  return { value: result, pos };
}

/**
 * Décode les champs top-level. Retourne { [field]: [{wire, value}] }
 *  - wire 0 (varint) : value = BigInt
 *  - wire 2 (len)    : value = Buffer
 *  - wire 5 (i32)    : value = Buffer(4)
 *  - wire 1 (i64)    : value = Buffer(8)
 */
function decode(buf) {
  const out = {};
  let pos = 0;
  while (pos < buf.length) {
    const t = readVarint(buf, pos); pos = t.pos;
    const field = Number(t.value >> 3n);
    const wire = Number(t.value & 7n);
    let value;
    if (wire === 0) { const v = readVarint(buf, pos); value = v.value; pos = v.pos; }
    else if (wire === 2) { const l = readVarint(buf, pos); pos = l.pos; const len = Number(l.value); value = buf.slice(pos, pos + len); pos += len; }
    else if (wire === 5) { value = buf.slice(pos, pos + 4); pos += 4; }
    else if (wire === 1) { value = buf.slice(pos, pos + 8); pos += 8; }
    else throw new Error(`wire type ${wire} non supporté @${pos}`);
    (out[field] = out[field] || []).push({ wire, value });
  }
  return out;
}

/** Représentation lisible d'un message décodé (pour le dump). */
function summarize(buf) {
  const dec = decode(buf);
  const rows = {};
  for (const [field, items] of Object.entries(dec)) {
    rows[field] = items.map(({ wire, value }) => {
      if (wire === 0) return String(value);
      if (Buffer.isBuffer(value)) {
        const s = value.toString('utf8');
        const printable = /^[\x20-\x7e]*$/.test(s);
        return printable ? s : `<${value.length}B ${value.toString('base64').slice(0, 24)}…>`;
      }
      return value;
    });
  }
  return rows;
}

/** Récupère le champ 16 (string) d'un body /reload, en utf8. */
function extractField16(buf) {
  const dec = decode(buf);
  const f = dec[16];
  if (!f || !f.length) return null;
  return f[0].value.toString('utf8');
}

module.exports = { decode, summarize, extractField16, readVarint };
