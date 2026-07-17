import { ProtobufWire } from "../ProtobufWire.js";

const TB_MY_RE = /tbMy[A-Za-z0-9+/=_-]+/;
const W1TB_RE = /W1tb[A-Za-z0-9+/=_-]+/;

/** Patch binaire sûr des segments tbMy / W1tb dans le blob f2088. */
export class InnerBlobPatcher {
  static patch(blob, { telemetry, events, siteKey, action } = {}) {
    let buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob, "latin1");

    if (siteKey) {
      buf = InnerBlobPatcher.#patchEmbeddedString(buf, 14, siteKey);
    }

    if (action) {
      buf = InnerBlobPatcher.#patchEmbeddedString(buf, 8, action);
    }

    if (telemetry) {
      buf = InnerBlobPatcher.#replacePattern(buf, TB_MY_RE, telemetry);
    }

    if (events) {
      buf = InnerBlobPatcher.#replacePattern(buf, W1TB_RE, events);
    }

    return buf;
  }

  static extractSegments(blob) {
    const s = blob.toString("latin1");
    return {
      telemetry: s.match(TB_MY_RE)?.[0] ?? null,
      events: s.match(W1TB_RE)?.[0] ?? null,
    };
  }

  static #replacePattern(buf, re, replacement) {
    const s = buf.toString("latin1");
    if (!re.test(s)) return buf;
    return Buffer.from(s.replace(re, replacement), "latin1");
  }

  static #patchEmbeddedString(buf, fieldNumber, value) {
    const tag = (fieldNumber << 3) | 2;
    const val = Buffer.from(value, "utf8");
    const needle = Buffer.from([tag, val.length, ...val]);
    try {
      const fields = ProtobufWire.decodeMessage(buf);
      const f = fields.find((x) => x.fieldNumber === fieldNumber && x.wireType === 2);
      if (!f || f.value.length !== val.length) return buf;
      const old = Buffer.concat([Buffer.from([tag, f.value.length]), f.value]);
      return InnerBlobPatcher.#replaceAll(buf, old, needle);
    } catch {
      return buf;
    }
  }

  static #replaceAll(buf, needle, repl) {
    const out = [];
    let i = 0;
    while (i < buf.length) {
      const idx = buf.indexOf(needle, i);
      if (idx < 0) {
        out.push(buf.subarray(i));
        break;
      }
      out.push(buf.subarray(i, idx), repl);
      i = idx + needle.length;
    }
    return Buffer.concat(out);
  }
}
