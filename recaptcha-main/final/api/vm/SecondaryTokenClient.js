import { HttpClient } from "../HttpClient.js";

/**
 * Tente d'obtenir le token secondaire (préfixe 05AL…) via endpoints Google.
 * Fallback : bftSignature de l'anchor ou segment template rebindé.
 */
export class SecondaryTokenClient {
  static async fetch({ apiBase, siteKey, anchorToken, encryptionKey, headers, jar, anchorUrl }) {
    const endpoints = [
      `${apiBase}userverify?k=${siteKey}`,
      `${apiBase}bcn?k=${siteKey}`,
    ];

    for (const url of endpoints) {
      try {
        const body = JSON.stringify({
          v: anchorToken,
          c: anchorToken,
          response: anchorToken,
          t: encryptionKey,
        });
        const text = await HttpClient.fetchText(
          url,
          {
            method: "POST",
            headers: {
              ...headers,
              "content-type": "application/json",
              origin: "https://www.google.com",
              referer: anchorUrl,
            },
            body,
          },
          jar,
        );
        const token = SecondaryTokenClient.#extract05AL(text);
        if (token) return { token, source: url };
      } catch {
        /* endpoint absent ou refusé */
      }
    }
    return null;
  }

  static #extract05AL(text) {
    const m = text.match(/05AL[A-Za-z0-9_-]{200,}/);
    return m?.[0] ?? null;
  }

  static resolve({ anchorConfig, templateSecondary, anchorToken }) {
    if (anchorConfig?.bftSignature?.startsWith("05AL")) {
      return { token: anchorConfig.bftSignature, source: "anchor-bft" };
    }
    if (templateSecondary?.startsWith("05AL")) {
      return { token: templateSecondary, source: "template-fallback" };
    }
    return null;
  }
}
