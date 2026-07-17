'use strict';
/**
 * decode_stream.js — décode proprement le stream protobuf du fingerprint courant
 * (plaintext de cipher#1). But : obtenir le schéma exact pour reconstruire le stream en pur Node.
 */
const caps = require('../scripts/cipher_captures.json');

function readVarint(b, o) {
  let shift = 0, result = 0, byte;
  do { byte = b[o++]; result += (byte & 0x7f) * Math.pow(2, shift); shift += 7; } while (byte & 0x80);
  return [result, o];
}

// Décode un message protobuf -> liste de {field, wire, value}
function decodeMsg(b, start, end) {
  const fields = [];
  let o = start;
  while (o < end) {
    const [tag, o1] = readVarint(b, o); o = o1;
    const field = Math.floor(tag / 8), wire = tag & 7;
    if (wire === 0) { const [v, o2] = readVarint(b, o); o = o2; fields.push({ field, wire, value: v }); }
    else if (wire === 5) { const v = b.readUInt32LE(o); o += 4; fields.push({ field, wire, value: v }); }
    else if (wire === 1) { const v = b.readDoubleLE ? b.slice(o, o + 8) : null; o += 8; fields.push({ field, wire, value: '<f64>' }); }
    else if (wire === 2) { const [len, o2] = readVarint(b, o); o = o2; const sub = b.slice(o, o + len); o += len; fields.push({ field, wire, len, bytes: sub }); }
    else { fields.push({ field, wire, value: '<?>' }); break; }
  }
  return fields;
}

const buf = Buffer.from(caps[0].pt.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
console.log('taille stream:', buf.length, 'octets');
console.log('header (2o):', buf[0], buf[1], '\n');

// Top-level = repeated field3 (tag 0x1a). Décode chaque submessage.
const top = decodeMsg(buf, 2, buf.length);
console.log('messages top-level:', top.length);
const byField = {};
top.forEach(f => byField[f.field] = (byField[f.field] || 0) + 1);
console.log('champs top-level:', JSON.stringify(byField));

// Chaque field3 (wire2) = un signal. Décode l'intérieur et catégorise par "forme".
const shapes = {};
const signals = [];
for (const f of top) {
  if (f.wire !== 2) { signals.push({ raw: `top-f${f.field}=${f.value}` }); continue; }
  const inner = decodeMsg(f.bytes, 0, f.bytes.length);
  const shape = inner.map(x => `f${x.field}:w${x.wire}`).join(',');
  shapes[shape] = (shapes[shape] || 0) + 1;
  signals.push({ inner });
}
console.log('\n=== FORMES de signaux (field3 submessage) ===');
Object.entries(shapes).sort((a, b) => b[1] - a[1]).forEach(([s, n]) => console.log(`  ${String(n).padStart(4)}×  {${s}}`));

console.log('\n=== 40 premiers signaux décodés ===');
signals.slice(0, 40).forEach((s, i) => {
  if (s.raw) { console.log(`  [${i}] ${s.raw}`); return; }
  const parts = s.inner.map(x => {
    if (x.wire === 2) { const printable = x.bytes.length && x.bytes.every(c => c >= 32 && c < 127); return `f${x.field}=${printable ? '"' + x.bytes.toString() + '"' : 'bytes[' + [...x.bytes].join(',') + ']'}`; }
    return `f${x.field}=${x.value}`;
  });
  console.log(`  [${i}] {${parts.join(' ')}}`);
});
