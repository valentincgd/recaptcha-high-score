/**
 * Champ 20 (format plat TM) — télémétrie base64 (README Idx 20).
 * Valeur stockée = base64(JSON).slice(1) ; décoder avec préfixe « W ».
 */
export class FlatTelemetryBuilder {
  static build({
    env,
    referer,
    collectionElapsedMs = null,
    browserObjectsLength = null,
  } = {}) {
    const perf = env?.window?.performance;
    const now = perf?.now?.() ?? Date.now() % 100000;
    const elapsed =
      collectionElapsedMs ?? Math.max(400, Math.min(1200, Math.round(now % 900) + 400));
    const objLen =
      browserObjectsLength ?? Math.max(500, Math.min(950, Math.round(elapsed * 0.9)));

    const originHost = FlatTelemetryBuilder.#hostFromReferer(referer);
    const scripts = FlatTelemetryBuilder.#scriptHosts(originHost);

    const longTask = [
      6,
      Number((5 + (now % 1000) / 10000).toFixed(14)),
      Number((0.01 + (now % 100) / 10000).toFixed(17)),
      11,
    ];
    const vmDelta = [
      26,
      Number((0.1 + (now % 50) / 1000).toFixed(14)),
      Number((0.001 + (now % 10) / 10000).toFixed(16)),
      1,
    ];

    const payload = [
      null,
      null,
      null,
      null,
      longTask,
      vmDelta,
      0,
      0,
      0,
      scripts,
      [1, objLen],
    ];

    const b64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
    return b64.startsWith("W") ? b64.slice(1) : b64;
  }

  static #hostFromReferer(referer) {
    try {
      return new URL(referer ?? "https://auth.ticketmaster.com/").hostname;
    } catch {
      return "auth.ticketmaster.com";
    }
  }

  static #scriptHosts(originHost) {
    const hosts = new Set([
      originHost,
      "aa.s.tmol.io",
      "www.googletagmanager.com",
      "www.google.com",
      "www.gstatic.com",
      "cdn.cookielaw.org",
    ]);
    if (originHost.includes("ticketmaster")) {
      hosts.add("s1.s.tmol.io");
    }
    return [...hosts];
  }
}
