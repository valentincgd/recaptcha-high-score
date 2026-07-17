import { HashUtil } from "../HashUtil.js";

/**
 * Idx 22 — empreinte des clés d'objets navigateur (README, hashBrowserProtos.js).
 */
export class BrowserObjectsHasher {
  static #CHECKS = [
    ["SpeechSynthesisEvent", 1],
    ["NetworkInformation", 8],
    ["HTMLElement", 125],
    ["SpeechSynthesisUtterance", 0],
    ["SpeechSynthesisErrorEvent", 0],
    ["MediaMetadata", 3],
    ["HTMLMediaElement", 46],
    ["SpeechSynthesisUtterance", 10],
    ["RemotePlayback", 1],
    ["AuthenticatorAttestationResponse", 5],
    ["HTMLMediaElement", 45],
    ["PushManager", 0],
    ["PushSubscription", 2],
    ["SpeechSynthesisErrorEvent", 1],
    ["navigator", 38],
    ["HTMLMediaElement", 48],
    ["USBIsochronousOutTransferResult", 0],
  ];

  static collect(window) {
    const out = [];
    const ObjectCtor = window.Object;

    for (const [typeName, pickIndex] of BrowserObjectsHasher.#CHECKS) {
      try {
        const ctor = window[typeName];
        if (!ctor?.prototype) {
          out.push(0);
          continue;
        }
        const names = ObjectCtor.getOwnPropertyNames(ctor.prototype);
        const key = names[pickIndex];
        if (key == null) {
          out.push(0);
          continue;
        }
        out.push(HashUtil.hashString(String(key)));
      } catch {
        out.push(0);
      }
    }

    return out;
  }
}
