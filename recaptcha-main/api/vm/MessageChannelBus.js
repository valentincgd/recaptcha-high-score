/**
 * Bus MessageChannel / postMessage pour le handshake reCAPTCHA (nk + ports).
 */
import {
  installRecaptchaHandshake,
  wireRecaptchaPort,
} from "./RecaptchaHandshake.js";

export function installMessageChannelBus(window) {
  installRecaptchaHandshake(window);
}

export { wireRecaptchaPort };
