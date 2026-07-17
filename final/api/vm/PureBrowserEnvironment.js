import { installVmBytecodeCapture } from "./installVmBytecodeCapture.js";

/**
 * Empreinte navigateur en JS pur (sans JSDOM / node-canvas).
 * Expose window/document/performance pour Collectors et BinaryPayloadBuilder.
 */
export class PureBrowserEnvironment {
  constructor({
    origin = "https://auth.ticketmaster.com",
    referer = "https://auth.ticketmaster.com/",
    userAgent = PureBrowserEnvironment.DEFAULT_UA,
    width = 1366,
    height = 768,
    devicePixelRatio = 1,
    platform = "Win32",
    language = "fr-FR",
    languages = ["fr-FR", "fr", "en-US", "en"],
    webgl = {},
    title = "Ticketmaster",
    cookie = "",
    documentReferrer = '""',
    scrollY = 0,
    localStorageLength = 0,
    inputIds = [],
    close = () => {},
  } = {}) {
    this.origin = origin.replace(/\/$/, "");
    this.referer = referer;
    this.userAgent = userAgent;
    this.close = close;

    const gl = {
      vendor: webgl.vendor ?? "Google Inc. (NVIDIA)",
      renderer:
        webgl.renderer ??
        "ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)",
      extensionCount: webgl.extensionCount ?? webgl.extensions?.length ?? 47,
    };

    const perfStart = Date.now() - 1200;
    let perfOffset = 800 + Math.random() * 200;

    const document = {
      title,
      cookie,
      referrer: documentReferrer,
      querySelectorAll: (sel) => {
        if (String(sel).includes("input")) {
          return inputIds.map((id) => ({ id, name: id, type: "text" }));
        }
        return [];
      },
      createElement: (tag) => {
        if (String(tag).toLowerCase() !== "canvas") {
          return { getContext: () => null };
        }
        return {
          getContext: (type) => {
            const t = String(type).toLowerCase();
            if (!t.includes("webgl")) return null;
            const UNMASKED_VENDOR_WEBGL = 0x9245;
            const UNMASKED_RENDERER_WEBGL = 0x9246;
            return {
              getParameter: (p) => {
                if (p === UNMASKED_VENDOR_WEBGL || p === 0x1f00) return gl.vendor;
                if (p === UNMASKED_RENDERER_WEBGL || p === 0x1f01) return gl.renderer;
                return null;
              },
              getExtension: (name) =>
                name === "WEBGL_debug_renderer_info"
                  ? { UNMASKED_VENDOR_WEBGL, UNMASKED_RENDERER_WEBGL }
                  : {},
              getSupportedExtensions: () =>
                Array.from({ length: gl.extensionCount }, (_, i) => `EXT_${i}`),
            };
          },
        };
      },
    };

    const mkProto = (n) => {
      const names = [];
      for (let i = 0; i < n; i++) names.push(`_${i}`);
      const p = Object.fromEntries(names.map((k, i) => [k, i]));
      return p;
    };

    const window = {
      document,
      location: { href: `${this.origin}/`, origin: this.origin },
      Object: globalThis.Object,
      Array: globalThis.Array,
      String: globalThis.String,
      Math: globalThis.Math,
      parseInt: globalThis.parseInt,
      parseFloat: globalThis.parseFloat,
      RegExp: globalThis.RegExp,
      btoa: (s) => Buffer.from(String(s), "binary").toString("base64"),
      atob: (s) => Buffer.from(String(s), "base64").toString("binary"),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id),
      navigator: {
        userAgent,
        platform,
        language,
        languages,
      },
      SpeechSynthesisEvent: { prototype: mkProto(2) },
      NetworkInformation: { prototype: mkProto(12) },
      HTMLElement: { prototype: mkProto(130) },
      SpeechSynthesisUtterance: { prototype: mkProto(12) },
      SpeechSynthesisErrorEvent: { prototype: mkProto(2) },
      MediaMetadata: { prototype: mkProto(4) },
      HTMLMediaElement: { prototype: mkProto(50) },
      RemotePlayback: { prototype: mkProto(2) },
      AuthenticatorAttestationResponse: { prototype: mkProto(6) },
      PushManager: { prototype: mkProto(1) },
      PushSubscription: { prototype: mkProto(3) },
      USBIsochronousOutTransferResult: { prototype: mkProto(1) },
      innerWidth: width,
      innerHeight: height,
      outerWidth: width,
      outerHeight: height,
      devicePixelRatio,
      scrollY,
      localStorage: { length: localStorageLength },
      performance: {
        now: () => perfOffset + (Date.now() - perfStart) * 0.02,
        timing: {
          navigationStart: perfStart,
          loadEventEnd: perfStart + 950,
        },
      },
    };

    installVmBytecodeCapture(window);
    this.window = window;
    this.document = document;
  }

  static DEFAULT_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

  /** Fusionne un objet fingerprint utilisateur (API / env). */
  static fromFingerprint(fp = {}) {
    return new PureBrowserEnvironment({
      origin: fp.origin,
      referer: fp.referer,
      userAgent: fp.userAgent,
      width: fp.width ?? fp.innerWidth,
      height: fp.height ?? fp.innerHeight,
      devicePixelRatio: fp.devicePixelRatio,
      platform: fp.platform,
      language: fp.language,
      languages: fp.languages,
      webgl: fp.webgl,
      title: fp.title,
      cookie: fp.cookie,
      documentReferrer: fp.documentReferrer ?? fp.referrer,
      scrollY: fp.scrollY,
      localStorageLength: fp.localStorageLength,
      inputIds: fp.inputIds,
    });
  }
}
