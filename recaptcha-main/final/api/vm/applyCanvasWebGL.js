import { createCanvas } from "canvas";

const DEFAULT_WEBGL = {
  vendor: "Google Inc. (NVIDIA)",
  renderer:
    "ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)",
  extensions: [
    "WEBGL_debug_renderer_info",
    "WEBGL_compressed_texture_s3tc",
    "OES_texture_float",
    "EXT_texture_filter_anisotropic",
  ],
};

/** Canvas + WebGL crédibles pour la VM reCAPTCHA (collecteurs empreinte). */
export function applyCanvasWebGL(window, webgl = DEFAULT_WEBGL) {
  if (window.__canvasWebGLPatched) return;
  window.__canvasWebGLPatched = true;

  const { vendor, renderer, extensions } = webgl;
  const UNMASKED_VENDOR_WEBGL = 0x9245;
  const UNMASKED_RENDERER_WEBGL = 0x9246;
  const VENDOR = 0x1f00;
  const RENDERER = 0x1f01;

  const doc = window.document;
  if (!doc?.createElement) return;

  const origCreateElement = doc.createElement.bind(doc);
  doc.createElement = (tag, ...rest) => {
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
      if (!nodeGl) {
        return {
          getParameter: (p) => {
            if (p === UNMASKED_VENDOR_WEBGL || p === VENDOR) return vendor;
            if (p === UNMASKED_RENDERER_WEBGL || p === RENDERER) return renderer;
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
