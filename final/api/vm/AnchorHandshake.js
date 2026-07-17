import {
  completeAnchorHandshake,
  dispatchWindowMessage,
  runAnchorHandshakeSequence,
} from "./RecaptchaHandshake.js";

export { runAnchorHandshakeSequence };

const delay = (ms) => new Promise((r) => globalThis.setTimeout(r, ms));

/**
 * Rejoue la séquence parent attendue après chargement des scripts anchor.
 * Main.init doit avoir été appelé avec initString (comme dans le HTML).
 */
export async function runFullAnchorHandshake(window, anchor) {
  completeAnchorHandshake(window, anchor);
  const init = anchor?.initPayload;
  if (!Array.isArray(init)) return;

  const parentOrigin =
    init.find((x) => typeof x === "string" && x.startsWith("https://")) ??
    "https://auth.ticketmaster.com";

  const label = init[0] ?? "ainput";
  await delay(80);
  dispatchWindowMessage(
    window,
    JSON.stringify([label, null]),
    [],
    { origin: parentOrigin },
  );

  for (let i = 1; i < init.length; i++) {
    const item = init[i];
    if (item == null) continue;
    let msg;
    if (typeof item === "string") {
      if (item.length < 2) continue;
      msg = item;
    } else if (Array.isArray(item)) {
      msg = JSON.stringify(item);
    } else if (typeof item === "number") {
      continue;
    } else {
      continue;
    }
    dispatchWindowMessage(window, msg, [], { origin: parentOrigin });
    await delay(60);
  }

  await delay(80);
  dispatchWindowMessage(window, "recaptcha-setup", [], { origin: parentOrigin });
}

export function probeAnchorRuntime(window) {
  const a = window.recaptcha?.anchor;
  const main = a?.Main;
  return {
    anchorKeys: a ? Object.keys(a) : [],
    mainKeys: main ? Object.keys(main) : [],
    executeType: typeof main?.execute,
    workerMsg: window.__workerLastMsg ? "set" : null,
    workerBootError: window.__workerBootError ?? null,
  };
}

export async function waitForMainExecute(window, ms = 12_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (typeof window.recaptcha?.anchor?.Main?.execute === "function") {
      return true;
    }
    await delay(80);
  }
  return false;
}
