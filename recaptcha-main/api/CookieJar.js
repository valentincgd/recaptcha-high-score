export class CookieJar {
  #cookies = new Map();

  #storeSetCookieLines(list) {
    for (const raw of list) {
      const part = raw.split(";")[0]?.trim();
      const eq = part?.indexOf("=");
      if (eq > 0) {
        this.#cookies.set(part.slice(0, eq), part.slice(eq + 1));
      }
    }
  }

  storeFromResponse(res) {
    const list =
      typeof res.headers?.getSetCookie === "function"
        ? res.headers.getSetCookie()
        : [];
    this.#storeSetCookieLines(list);
  }

  storeFromNodeHeaders(headers) {
    const raw = headers?.["set-cookie"];
    if (!raw) return;
    this.#storeSetCookieLines(Array.isArray(raw) ? raw : [raw]);
  }

  header() {
    if (this.#cookies.size === 0) return undefined;
    return [...this.#cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  /** @param {string} cookieHeader ex. "_GRECAPTCHA=abc; other=1" */
  seed(cookieHeader) {
    if (!cookieHeader) return;
    for (const part of cookieHeader.split(";")) {
      const trimmed = part.trim();
      const eq = trimmed.indexOf("=");
      if (eq > 0) {
        this.#cookies.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
      }
    }
  }
}
