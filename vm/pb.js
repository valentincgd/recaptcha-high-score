'use strict';
/**
 * vm/pb.js — mini lecteur/écrivain protobuf (wire format) pour analyser/assembler le champ 16.
 * Sans dépendance. Suffisant pour : varint, len-delimited (2), fixed64 (1), fixed32 (5).
 */

// ---- Lecture ----
function readVarint(buf, pos) {
  let result = 0n, shift = 0n, p = pos;
  for (;;) {
    const b = buf[p++];
    result |= BigInt(b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7n;
  }
  return [result, p];
}

/** Décode un message en liste de {field, wire, value|bytes|raw}. Ne descend pas récursivement (voir decodeNested). */
function decode(buf, start = 0, end = buf.length) {
  const out = [];
  let p = start;
  while (p < end) {
    const [tag, p1] = readVarint(buf, p);
    const field = Number(tag >> 3n), wire = Number(tag & 7n);
    p = p1;
    if (wire === 0) { const [v, p2] = readVarint(buf, p); p = p2; out.push({ field, wire, value: v }); }
    else if (wire === 2) { const [len, p2] = readVarint(buf, p); const l = Number(len); const bytes = buf.subarray(p2, p2 + l); p = p2 + l; out.push({ field, wire, bytes }); }
    else if (wire === 1) { const raw = buf.subarray(p, p + 8); p += 8; out.push({ field, wire, raw }); }
    else if (wire === 5) { const raw = buf.subarray(p, p + 4); p += 4; out.push({ field, wire, raw }); }
    else throw new Error('wire type non supporté ' + wire + ' @' + p);
  }
  return out;
}

/** Heuristique : un blob len-delimited est-il un sous-message protobuf valide ? */
function looksLikeMessage(buf) {
  try {
    let p = 0;
    while (p < buf.length) {
      const [tag, p1] = readVarint(buf, p);
      const wire = Number(tag & 7n), field = Number(tag >> 3n);
      if (field === 0 || wire === 3 || wire === 4 || wire === 6 || wire === 7) return false;
      p = p1;
      if (wire === 0) { [, p] = readVarint(buf, p); }
      else if (wire === 2) { const [len, p2] = readVarint(buf, p); p = p2 + Number(len); }
      else if (wire === 1) p += 8;
      else if (wire === 5) p += 4;
      if (p > buf.length) return false;
    }
    return p === buf.length;
  } catch { return false; }
}

/** Décode récursivement en descendant dans les len-delimited qui ressemblent à des messages. */
function decodeNested(buf, start = 0, end = buf.length, depth = 0) {
  const items = decode(buf, start, end);
  return items.map(it => {
    if (it.wire === 2 && depth < 8 && it.bytes.length > 0 && looksLikeMessage(it.bytes)) {
      return { field: it.field, wire: it.wire, len: it.bytes.length, msg: decodeNested(it.bytes, 0, it.bytes.length, depth + 1) };
    }
    if (it.wire === 2) {
      const printable = it.bytes.every(b => b >= 9 && b < 127);
      return { field: it.field, wire: it.wire, len: it.bytes.length, [printable ? 'str' : 'hex']: printable ? it.bytes.toString('utf8') : it.bytes.toString('hex') };
    }
    if (it.wire === 0) return { field: it.field, wire: it.wire, value: it.value <= 0xffffffffn ? Number(it.value) : it.value.toString() };
    return { field: it.field, wire: it.wire, hex: it.raw.toString('hex') };
  });
}

// ---- Écriture ----
function writeVarint(n) {
  let v = BigInt(n), bytes = [];
  do { let b = Number(v & 0x7fn); v >>= 7n; if (v > 0n) b |= 0x80; bytes.push(b); } while (v > 0n);
  return Buffer.from(bytes);
}
function tag(field, wire) { return writeVarint((field << 3) | wire); }
function fieldVarint(field, n) { return Buffer.concat([tag(field, 0), writeVarint(n)]); }
function fieldBytes(field, buf) { const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf); return Buffer.concat([tag(field, 2), writeVarint(b.length), b]); }
function fieldFixed64(field, buf) { return Buffer.concat([tag(field, 1), buf]); }

module.exports = { readVarint, decode, decodeNested, looksLikeMessage, writeVarint, tag, fieldVarint, fieldBytes, fieldFixed64 };

if (require.main === module) {
  const hex = process.argv[2];
  if (hex) {
    const buf = /^[0-9a-fA-F]+$/.test(hex) ? Buffer.from(hex, 'hex')
      : Buffer.from(hex.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    console.log(JSON.stringify(decodeNested(buf), null, 2));
  } else {
    console.log('usage: node vm/pb.js <hex|base64url>');
  }
}
