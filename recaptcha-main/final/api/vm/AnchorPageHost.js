import { JSDOM, VirtualConsole } from "jsdom";
import { applyBrowserPolyfills } from "./BrowserPolyfills.js";
import { installNetworkCapture } from "./NetworkCapture.js";

/**
 * Charge la page anchor Google telle quelle (HTML live) — uniquement endpoints Google.
 */
export class AnchorPageHost {
  static async run({ anchorHtml, anchorUrl, userAgent, waitMs = 20_000 }) {
    const virtualConsole = new VirtualConsole();
    virtualConsole.on("error", () => {});
    virtualConsole.on("warn", () => {});

    const dom = new JSDOM(anchorHtml, {
      url: anchorUrl,
      referrer: anchorUrl,
      pretendToBeVisual: true,
      runScripts: "dangerously",
      resources: "usable",
      userAgent,
      virtualConsole,
      beforeParse(w) {
        applyBrowserPolyfills(w);
        installNetworkCapture(w);
      },
    });

    const { window } = dom;
    applyBrowserPolyfills(window);
    installNetworkCapture(window);

    await new Promise((r) => setTimeout(r, waitMs));

    const result = {
      recaptcha: !!window.recaptcha,
      anchorInit: !!window.recaptcha?.anchor,
      vmDump: window.___vmDump ?? null,
      reloadCapture: window.__reloadCapture?.reload ?? null,
      reloadCount: window.__reloadCapture?.reloads?.length ?? 0,
      errors: [],
    };

    dom.window.close();
    return result;
  }
}
