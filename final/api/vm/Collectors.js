import { HashUtil } from "../HashUtil.js";

/** Collecteurs DOM exécutés dans BrowserEnvironment (sans recaptcha__fr.js). */
export class Collectors {
  static runAll(env, ctx = {}) {
    const window = env?.window ?? env;
    const document = env?.document ?? window?.document;
    if (!window?.document && !document) return [];
    const origin = ctx.origin ?? env.origin ?? window?.location?.origin;
    const siteKey = ctx.siteKey ?? "";
    const referer = ctx.referer ?? env.referer;
    const t0 = window.performance.now();

    const out = [];

    const push = (plaintext, signalKey, start = t0) => {
      out.push({
        signalKey,
        plaintext: typeof plaintext === "string" ? plaintext : JSON.stringify(plaintext),
        elapsed: Math.round(window.performance.now() - start),
      });
    };

    push(
      ctx.userAgent ?? window.navigator.userAgent,
      417,
    );
    push(`"${referer}"`, 1641);
    push(`"${origin}/"`, 1641);
    push(Collectors.webglPayload(document ?? window.document), 1310);
    push(String(window.innerWidth), 352);
    push(String(window.innerHeight), 360);
    push(`"${origin}"`, 1628);
    push(HashUtil.hashString(document.title || "Ticketmaster"), 16);
    push(
      JSON.stringify(
        Array.from(document.querySelectorAll("input")).map((el) => el.id || el.name || el.type),
      ),
      34,
    );
    push(document.cookie || "", 31);
    push("false", 3553);
    push(String(window.devicePixelRatio ?? 1), 291);
    push(`"${siteKey ?? ""}6d"`, 4);
    push(String(window.localStorage?.length ?? 0), 5);
    push(document.referrer || '""', 32);
    push(String(window.scrollY ?? 0), 352);
    push(window.navigator.platform ?? "Win32", 291);
    push(JSON.stringify([window.navigator.language ?? "fr-FR"]), 1626);

    return out;
  }

  static webglPayload(document) {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl") ||
      canvas.getContext("webgl2");
    if (!gl) return JSON.stringify(["", "", 0]);

    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    const vendor = debug
      ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)
      : gl.getParameter(0x1f00);
    const renderer = debug
      ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(0x1f01);
    const extLen = (gl.getSupportedExtensions() || []).length;
    return JSON.stringify([vendor, renderer, extLen]);
  }
}
