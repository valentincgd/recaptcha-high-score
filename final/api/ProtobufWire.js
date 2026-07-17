export class ProtobufWire {
  static #encodeVarint(value) {
    let n = value;
    if (n < 0) n = (n >>> 0) + 0x100000000;
    const out = [];
    while (n > 0x7f) {
      out.push((n & 0x7f) | 0x80);
      n >>>= 7;
    }
    out.push(n & 0x7f);
    return Buffer.from(out);
  }

  static #encodeSignedVarint(value) {
    if (value >= 0) return ProtobufWire.#encodeVarint(value);
    let v = BigInt(value);
    const out = [];
    while (true) {
      let b = Number(v & 0x7fn);
      v >>= 7n;
      if (
        (v === -1n && (b & 0x40) !== 0) ||
        (v === 0n && (b & 0x40) === 0)
      ) {
        out.push(b);
        break;
      }
      b |= 0x80;
      out.push(b);
    }
    return Buffer.from(out);
  }

  static #writeTag(fieldNumber, wireType) {
    return ProtobufWire.#encodeVarint((fieldNumber << 3) | wireType);
  }

  static writeBytes(fieldNumber, data) {
    const body = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
    return Buffer.concat([
      ProtobufWire.#writeTag(fieldNumber, 2),
      ProtobufWire.#encodeVarint(body.length),
      body,
    ]);
  }

  static writeString(fieldNumber, str) {
    return ProtobufWire.writeBytes(fieldNumber, str);
  }

  static writeInt32(fieldNumber, value) {
    return Buffer.concat([
      ProtobufWire.#writeTag(fieldNumber, 0),
      ProtobufWire.#encodeSignedVarint(value),
    ]);
  }

  static decodeMessage(buf) {
    const fields = [];
    let offset = 0;
    while (offset < buf.length) {
      let shift = 0;
      let tagVal = 0;
      let b;
      do {
        b = buf[offset++];
        tagVal |= (b & 0x7f) << shift;
        shift += 7;
      } while (b & 0x80);
      const fieldNumber = tagVal >>> 3;
      const wireType = tagVal & 7;

      if (wireType === 0) {
        shift = 0;
        let v = 0;
        do {
          b = buf[offset++];
          v |= (b & 0x7f) << shift;
          shift += 7;
        } while (b & 0x80);
        fields.push({ fieldNumber, wireType, value: v });
      } else if (wireType === 2) {
        shift = 0;
        let len = 0;
        do {
          b = buf[offset++];
          len |= (b & 0x7f) << shift;
          shift += 7;
        } while (b & 0x80);
        fields.push({
          fieldNumber,
          wireType,
          value: buf.subarray(offset, offset + len),
        });
        offset += len;
      } else break;
    }
    return fields;
  }

  static replaceBytesField(buf, fieldNumber, newData) {
    const fields = ProtobufWire.decodeMessage(buf);
    const parts = [];
    let found = false;
    for (const f of fields) {
      if (f.fieldNumber === fieldNumber && f.wireType === 2) {
        parts.push(ProtobufWire.writeBytes(fieldNumber, newData));
        found = true;
      } else if (f.wireType === 0) {
        parts.push(ProtobufWire.writeInt32(f.fieldNumber, f.value));
      } else if (f.wireType === 2) {
        parts.push(ProtobufWire.writeBytes(f.fieldNumber, f.value));
      }
    }
    if (!found) parts.unshift(ProtobufWire.writeBytes(fieldNumber, newData));
    return Buffer.concat(parts);
  }
}
