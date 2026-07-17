import { createContext, runInContext } from "node:vm";
import { JSDOM } from "jsdom";
import { createCanvas } from "canvas";
import { webcrypto } from "node:crypto";
import { applyBrowserPolyfills } from "./BrowserPolyfills.js";

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

const DEFAULT_WEBGL = {
  vendor: "Google Inc. (NVIDIA)",
  renderer:
    "ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)",
  extensions: [
    "ANGLE_instanced_arrays",
    "EXT_blend_minmax",
    "EXT_color_buffer_half_float",
    "EXT_disjoint_timer_query",
    "EXT_float_blend",
    "EXT_frag_depth",
    "EXT_shader_texture_lod",
    "EXT_texture_compression_bptc",
    "EXT_texture_compression_rgtc",
    "EXT_texture_filter_anisotropic",
    "WEBKIT_EXT_texture_filter_anisotropic",
    "EXT_sRGB",
    "KHR_parallel_shader_compile",
    "OES_element_index_uint",
    "OES_fbo_render_mipmap",
    "OES_standard_derivatives",
    "OES_texture_float",
    "OES_texture_float_linear",
    "OES_texture_half_float",
    "OES_texture_half_float_linear",
    "OES_vertex_array_object",
    "WEBGL_color_buffer_float",
    "WEBGL_compressed_texture_s3tc",
    "WEBKIT_WEBGL_compressed_texture_s3tc",
    "WEBGL_compressed_texture_s3tc_srgb",
    "WEBGL_debug_renderer_info",
    "WEBGL_debug_shaders",
    "WEBGL_depth_texture",
    "WEBKIT_WEBGL_depth_texture",
    "WEBGL_draw_buffers",
    "WEBGL_lose_context",
    "WEBKIT_WEBGL_lose_context",
  ],
};

/**
 * JSDOM + empreinte navigateur (UA, WebGL via node-canvas, performance, screen).
 */
export class BrowserEnvironment {
  constructor({
    origin = "https://auth.ticketmaster.com",
    referer = "https://auth.ticketmaster.com/",
    userAgent = DEFAULT_UA,
    webgl = DEFAULT_WEBGL,
    width = 1366,
    height = 768,
    html = "<!DOCTYPE html><html><head></head><body></body></html>",
  } = {}) {
    this.origin = origin;
    this.referer = referer;
    this.userAgent = userAgent;
    this.webgl = { ...DEFAULT_WEBGL, ...webgl };

    this.dom = new JSDOM(html, {
      url: `${origin}/`,
      referrer: referer,
      pretendToBeVisual: true,
      runScripts: "dangerously",
      resources: "usable",
      userAgent,
    });

    this.window = this.dom.window;
    this.document = this.window.document;
    applyBrowserPolyfills(this.window);
    this._patchIframePolyfills();
    this._patchJsdomInternals();
    this._patchNavigator();
    this._patchScreen(width, height);
    this._patchPerformance();
    this._patchCanvasWebGL();
    this._patchCrypto();
    this._patchMessageChannel();
    this._patchRequestAnimationFrame();
    this._patchPostMessage();
  }

  get global() {
    return this.window;
  }

  _patchIframePolyfills() {
    const doc = this.document;
    const origCreate = doc.createElement.bind(doc);
    doc.createElement = (name, options) => {
      const el = origCreate(name, options);
      if (String(name).toLowerCase() === "iframe") {
        const patchChild = () => {
          try {
            const w = el.contentWindow;
            if (w && !w.__recaptchaPolyfilled) {
              applyBrowserPolyfills(w);
              w.__recaptchaPolyfilled = true;
            }
          } catch {
            /* ignore */
          }
        };
        el.addEventListener("load", patchChild);
        setTimeout(patchChild, 0);
      }
      return el;
    };
  }

  _patchJsdomInternals() {
    const w = this.window;
    try {
      if (w.document && !w.document.defaultView) {
        Object.defineProperty(w.document, "defaultView", { get: () => w });
      }
      const loc = w.location;
      if (loc && !loc.href) {
        try {
          loc.href = `${this.origin}/`;
        } catch {
          /* ignore */
        }
      }
      w.close = () => {};
      w.open = () => w;
    } catch {
      /* ignore */
    }

  }

  _patchNavigator() {
    const nav = this.window.navigator;
    Object.defineProperty(nav, "userAgent", { get: () => this.userAgent, configurable: true });
    Object.defineProperty(nav, "platform", { get: () => "Win32", configurable: true });
    Object.defineProperty(nav, "language", { get: () => "fr-FR", configurable: true });
    Object.defineProperty(nav, "languages", {
      get: () => ["fr-FR", "fr", "en-US", "en"],
      configurable: true,
    });
    Object.defineProperty(nav, "hardwareConcurrency", { get: () => 8, configurable: true });
    Object.defineProperty(nav, "deviceMemory", { get: () => 8, configurable: true });
    Object.defineProperty(nav, "maxTouchPoints", { get: () => 0, configurable: true });
    Object.defineProperty(nav, "webdriver", { get: () => false, configurable: true });
    Object.defineProperty(nav, "vendor", { get: () => "Google Inc.", configurable: true });
  }

  _patchScreen(w, h) {
    const screen = {
      width: w,
      height: h,
      availWidth: w,
      availHeight: h - 40,
      colorDepth: 24,
      pixelDepth: 24,
    };
    Object.defineProperty(this.window, "screen", { value: screen, configurable: true });
    Object.defineProperty(this.window, "innerWidth", { get: () => w, configurable: true });
    Object.defineProperty(this.window, "innerHeight", { get: () => h, configurable: true });
    Object.defineProperty(this.window, "outerWidth", { get: () => w, configurable: true });
    Object.defineProperty(this.window, "outerHeight", { get: () => h, configurable: true });
    Object.defineProperty(this.window, "devicePixelRatio", { get: () => 1, configurable: true });
  }

  _patchPerformance() {
    const t0 = Date.now() - 1200;
    const perf = this.window.performance;
    const origNow = perf.now.bind(perf);
    let offset = 800 + Math.random() * 200;
    perf.now = () => origNow() + offset;
    perf.timing = {
      navigationStart: t0,
      domLoading: t0 + 200,
      domInteractive: t0 + 600,
      domContentLoadedEventStart: t0 + 700,
      domContentLoadedEventEnd: t0 + 720,
      loadEventStart: t0 + 900,
      loadEventEnd: t0 + 950,
    };
    perf.getEntriesByType = (type) => {
      if (type === "navigation") {
        return [
          {
            name: this.window.location.href,
            entryType: "navigation",
            startTime: 0,
            duration: 900,
            type: "navigate",
          },
        ];
      }
      return [];
    };
  }

  _patchCanvasWebGL() {
    const { vendor, renderer, extensions } = this.webgl;
    const UNMASKED_VENDOR_WEBGL = 0x9245;
    const UNMASKED_RENDERER_WEBGL = 0x9246;
    const VENDOR = 0x1f00;
    const RENDERER = 0x1f01;

    const origCreateElement = this.document.createElement.bind(this.document);
    this.document.createElement = (tag, ...rest) => {
      const el = origCreateElement(tag, ...rest);
      if (String(tag).toLowerCase() !== "canvas") return el;

      const nodeCanvas = createCanvas(256, 256);
      const nodeGl =
        nodeCanvas.getContext("webgl") ||
        nodeCanvas.getContext("webgl2") ||
        nodeCanvas.getContext("experimental-webgl");

      el.getContext = (type, ...args) => {
        const t = String(type).toLowerCase();
        if (!t.includes("webgl")) {
          return nodeCanvas.getContext(type, ...args);
        }

        if (!nodeGl) return this._mockWebGLContext({ vendor, renderer, extensions });

        const real = nodeGl;
        return {
          getParameter: (pname) => {
            if (pname === UNMASKED_VENDOR_WEBGL || pname === VENDOR) return vendor;
            if (pname === UNMASKED_RENDERER_WEBGL || pname === RENDERER) return renderer;
            try {
              return real.getParameter(pname);
            } catch {
              return null;
            }
          },
          getExtension: (name) => {
            if (name === "WEBGL_debug_renderer_info") {
              return { UNMASKED_VENDOR_WEBGL, UNMASKED_RENDERER_WEBGL };
            }
            return extensions.includes(name) ? {} : null;
          },
          getSupportedExtensions: () => [...extensions],
        };
      };

      return el;
    };
  }

  _mockWebGLContext({ vendor, renderer, extensions }) {
    const UNMASKED_VENDOR_WEBGL = 0x9245;
    const UNMASKED_RENDERER_WEBGL = 0x9246;
    return {
      getParameter: (p) => {
        if (p === UNMASKED_VENDOR_WEBGL) return vendor;
        if (p === UNMASKED_RENDERER_WEBGL) return renderer;
        return null;
      },
      getExtension: (name) =>
        name === "WEBGL_debug_renderer_info"
          ? { UNMASKED_VENDOR_WEBGL, UNMASKED_RENDERER_WEBGL }
          : extensions.includes(name)
            ? {}
            : null,
      getSupportedExtensions: () => [...extensions],
    };
  }

  _patchCrypto() {
    if (!this.window.crypto?.getRandomValues) {
      this.window.crypto = webcrypto;
    }
  }

  _patchMessageChannel() {
    if (this.window.MessageChannel) return;
    class MC {
      constructor() {
        const q = [];
        const mk = () => ({
          onmessage: null,
          postMessage: (data) => {
            const other = this.port1 === mk.port ? this.port2 : this.port1;
            if (other.onmessage) other.onmessage({ data });
            else q.push(data);
          },
          start: () => {},
        });
        this.port1 = mk();
        this.port2 = mk();
        this.port1.constructor = MC;
      }
    }
    this.window.MessageChannel = MC;
  }

  _patchRequestAnimationFrame() {
    if (!this.window.requestAnimationFrame) {
      this.window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
      this.window.cancelAnimationFrame = (id) => clearTimeout(id);
    }
  }

  _patchPostMessage() {
    const w = this.window;
    const orig = w.postMessage?.bind(w);
    w.postMessage = (message, targetOrigin, transfer) => {
      const origin =
        typeof targetOrigin === "string"
          ? targetOrigin
          : targetOrigin == null
            ? "*"
            : "*";
      try {
        if (orig) return orig(message, origin, transfer);
      } catch {
        /* iframe messaging non requis pour reload */
      }
    };
  }

  injectRecaptchaCfg({ siteKey, version, apiBase }) {
    this.window.___grecaptcha_cfg = {
      clients: {},
      render: [siteKey],
      enterprise: [],
      enterprise2fa: [],
      oid: {},
      version,
      apiBase,
    };
  }

  runScriptViaDom(source, filename = "recaptcha.js") {
    const script = this.document.createElement("script");
    script.textContent = source;
    script.setAttribute("data-filename", filename);
    this.document.head.appendChild(script);
  }

  runScript(source, filename = "recaptcha.js") {
    const ctx = createContext(this.window);
    try {
      runInContext(source, ctx, { filename, timeout: 120_000 });
    } catch (err) {
      throw new Error(`${filename}: ${err?.stack ?? err}`);
    }
  }

  async runScriptFile(path) {
    const { readFileSync } = await import("node:fs");
    this.runScript(readFileSync(path, "utf8"), path);
  }

  close() {
    this.dom.window.close();
  }
}
