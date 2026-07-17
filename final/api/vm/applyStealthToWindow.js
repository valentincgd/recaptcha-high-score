/** Patches anti-automation pour JSDOM. */
export function applyStealthToWindow(window) {
  if (!window || window.__recaptchaStealth) return;
  window.__recaptchaStealth = true;

  const nav = window.navigator;
  const desc = (obj, key, value) => {
    try {
      Object.defineProperty(obj, key, { get: () => value, configurable: true });
    } catch {
      /* ignore */
    }
  };

  desc(nav, "webdriver", undefined);
  try {
    delete Object.getPrototypeOf(nav).webdriver;
  } catch {
    /* ignore */
  }

  if (!window.chrome) {
    window.chrome = { runtime: {}, app: { isInstalled: false } };
  }

  desc(nav, "languages", ["fr-FR", "fr", "en-US", "en"]);
  desc(nav, "plugins", { length: 5, 0: {}, 1: {}, 2: {}, 3: {}, 4: {} });
  desc(nav, "hardwareConcurrency", 8);
  desc(nav, "deviceMemory", 8);
  desc(nav, "maxTouchPoints", 0);

  const originalQuery = nav.permissions?.query?.bind(nav.permissions);
  if (originalQuery) {
    nav.permissions.query = (parameters) =>
      parameters?.name === "notifications"
        ? Promise.resolve({ state: window.Notification?.permission ?? "default" })
        : originalQuery(parameters);
  }
}
