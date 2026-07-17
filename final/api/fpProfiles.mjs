/**
 * fpProfiles.mjs — Profils d'empreinte navigateur (Chrome/Windows réalistes, variés).
 * Chaque profil → variables RC_* consommées par tools/shims.js + xbv.js au boot d'une fenêtre.
 * Sert à faire tourner un POOL de fenêtres chaudes avec des empreintes DIFFÉRENTES.
 */
export const FP_PROFILES = [
  {
    id: "win-intel-uhd630", chromeVersion: "150.0.0.0", platform: "windows",
    webglVendor: "Google Inc. (Intel)",
    webglRenderer: "ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E9B) Direct3D11 vs_5_0 ps_5_0, D3D11)",
    screenW: 1920, screenH: 1080, hwConcurrency: 8, deviceMemory: 8,
  },
  {
    id: "win-nvidia-rtx3060", chromeVersion: "150.0.0.0", platform: "windows",
    webglVendor: "Google Inc. (NVIDIA)",
    webglRenderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002503) Direct3D11 vs_5_0 ps_5_0, D3D11)",
    screenW: 2560, screenH: 1440, hwConcurrency: 16, deviceMemory: 16,
  },
  {
    id: "win-amd-radeon", chromeVersion: "149.0.0.0", platform: "windows",
    webglVendor: "Google Inc. (AMD)",
    webglRenderer: "ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)",
    screenW: 1920, screenH: 1080, hwConcurrency: 12, deviceMemory: 16,
  },
  {
    id: "win-intel-irisxe", chromeVersion: "150.0.0.0", platform: "windows",
    webglVendor: "Google Inc. (Intel)",
    webglRenderer: "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)",
    screenW: 1536, screenH: 864, hwConcurrency: 8, deviceMemory: 8,
  },
  {
    id: "win-nvidia-gtx1660", chromeVersion: "148.0.0.0", platform: "windows",
    webglVendor: "Google Inc. (NVIDIA)",
    webglRenderer: "ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 (0x00002184) Direct3D11 vs_5_0 ps_5_0, D3D11)",
    screenW: 1920, screenH: 1080, hwConcurrency: 6, deviceMemory: 16,
  },
  {
    id: "win-nvidia-rtx4070", chromeVersion: "150.0.0.0", platform: "windows",
    webglVendor: "Google Inc. (NVIDIA)",
    webglRenderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 (0x00002786) Direct3D11 vs_5_0 ps_5_0, D3D11)",
    screenW: 2560, screenH: 1440, hwConcurrency: 20, deviceMemory: 32,
  },
];

/** Variables d'environnement RC_* pour un profil (à passer au spawn de la fenêtre). */
export function profileEnv(p) {
  return {
    RC_CHROME_VERSION: p.chromeVersion,
    RC_PLATFORM: p.platform,
    RC_WEBGL_VENDOR: p.webglVendor,
    RC_WEBGL_RENDERER: p.webglRenderer,
    RC_SCREEN_W: String(p.screenW),
    RC_SCREEN_H: String(p.screenH),
    RC_AVAIL_H: String(p.screenH - 48),
    RC_HW_CONCURRENCY: String(p.hwConcurrency),
    RC_DEVICE_MEMORY: String(p.deviceMemory),
  };
}
