import { ensureVmDump, recordVmCaptureText } from "./vmCaptureUtil.js";

/** Hooks légers (btoa) — postMessage est géré par BrowserPolyfills + sérialisation JSON. */
export function installVmBytecodeCapture(window) {
  if (window.__vmCaptureInstalled) return;
  window.__vmCaptureInstalled = true;
  ensureVmDump(window);

  const origBtoa = window.btoa?.bind(window);
  if (typeof origBtoa === "function") {
    window.btoa = function (...args) {
      const r = origBtoa.apply(this, args);
      recordVmCaptureText(window, r);
      return r;
    };
  }
}
