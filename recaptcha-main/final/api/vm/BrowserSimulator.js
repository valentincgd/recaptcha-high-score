import { PureBrowserEnvironment } from "./PureBrowserEnvironment.js";

/**
 * Profils navigateur pour générer des reload avec empreintes différentes (JS pur).
 */
export const FINGERPRINT_PROFILES = {
  chrome_win_nvidia: {
    id: "chrome_win_nvidia",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    platform: "Win32",
    language: "fr-FR",
    languages: ["fr-FR", "fr", "en-US", "en"],
    width: 1920,
    height: 1080,
    devicePixelRatio: 1,
    webgl: {
      vendor: "Google Inc. (NVIDIA)",
      renderer:
        "ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)",
      extensionCount: 47,
    },
    title: "Ticketmaster",
    scrollY: 0,
    localStorageLength: 2,
    inputIds: ["email", "password"],
  },
  chrome_win_intel: {
    id: "chrome_win_intel",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    platform: "Win32",
    language: "en-US",
    languages: ["en-US", "en"],
    width: 1536,
    height: 864,
    devicePixelRatio: 1.25,
    webgl: {
      vendor: "Google Inc. (Intel)",
      renderer:
        "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)",
      extensionCount: 42,
    },
    title: "Sign in - Ticketmaster",
    scrollY: 120,
    localStorageLength: 5,
    inputIds: ["username", "pwd"],
  },
  chrome_mac_amd: {
    id: "chrome_mac_amd",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    platform: "MacIntel",
    language: "fr-FR",
    languages: ["fr-FR", "fr"],
    width: 1440,
    height: 900,
    devicePixelRatio: 2,
    webgl: {
      vendor: "Google Inc. (AMD)",
      renderer:
        "ANGLE (AMD, AMD Radeon Pro 5500M OpenGL Engine, OpenGL 4.1)",
      extensionCount: 39,
    },
    title: "Ticketmaster",
    scrollY: 0,
    localStorageLength: 0,
    inputIds: [],
  },
};

export class BrowserSimulator {
  static resolveProfile(fingerprint) {
    if (!fingerprint) return FINGERPRINT_PROFILES.chrome_win_nvidia;
    if (typeof fingerprint === "string") {
      return (
        FINGERPRINT_PROFILES[fingerprint] ?? {
          ...FINGERPRINT_PROFILES.chrome_win_nvidia,
          id: fingerprint,
        }
      );
    }
    return {
      ...FINGERPRINT_PROFILES.chrome_win_nvidia,
      ...fingerprint,
      id: fingerprint.id ?? "custom",
    };
  }

  static createEnvironment({ origin, referer, fingerprint } = {}) {
    const profile = BrowserSimulator.resolveProfile(fingerprint);
    return {
      profile,
      env: PureBrowserEnvironment.fromFingerprint({
        ...profile,
        origin,
        referer,
      }),
    };
  }

  static listProfiles() {
    return Object.keys(FINGERPRINT_PROFILES);
  }
}
