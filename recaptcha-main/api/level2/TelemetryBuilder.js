/**
 * Champ 20 / segment tbMy… — télémétrie encodée (préfixe W1 + base64 JSON).
 * Format documenté dans README.md (Idx 20).
 */
export class TelemetryBuilder {
  static build({
    version,
    collectionElapsedMs = 900,
    browserObjectsLength = 900,
  } = {}) {
    const payload = [
      [
        [3, 0, 829],
        [1, 42, 863],
      ],
      [
        [2, 727, 1341.3],
      ],
      [
        null,
        null,
        null,
        [7, 6.37, 0.00057, 26],
        [771, 0.157, 0.0156, 4],
        0,
        0,
        0,
      ],
      [
        "auth.ticketmaster.com",
        "aa.s.tmol.io",
        "www.googletagmanager.com",
        "www.google.com",
        "www.gstatic.com",
        "cdn.cookielaw.org",
        "s1.s.tmol.io",
      ],
      [collectionElapsedMs, browserObjectsLength],
    ];

    if (version) {
      payload[0].push([1, 12, 573]);
      payload[1].push([2, 427, 902]);
    }

    const json = JSON.stringify(payload);
    const b64 = Buffer.from(json, "utf8").toString("base64");
    const inner = b64.startsWith("W1tb") ? b64.slice(4) : b64.startsWith("W1") ? b64.slice(2) : b64;
    return `tbMy${inner}`;
  }
}
