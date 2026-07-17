export class ReloadResponseParser {
  static #TOKEN_RE = /0[3c]AFc[A-Za-z0-9_-]{80,}/;

  static parse(text) {
    const cleaned = text.replace(/^\)\]\}'\s*\n?/, "").trim();

    try {
      const json = JSON.parse(cleaned);
      if (Array.isArray(json)) {
        const token =
          typeof json[1] === "string" && ReloadResponseParser.#TOKEN_RE.test(json[1])
            ? json[1]
            : json.find(
                (x) =>
                  typeof x === "string" && ReloadResponseParser.#TOKEN_RE.test(x),
              ) ?? null;
        return { raw: json, token, success: !!token };
      }
    } catch {
      /* ignore */
    }

    const m = cleaned.match(ReloadResponseParser.#TOKEN_RE);
    return { raw: cleaned, token: m?.[0] ?? null, success: !!m };
  }
}
