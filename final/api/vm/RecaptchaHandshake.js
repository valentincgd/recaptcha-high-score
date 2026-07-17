/**
 * Shim handshake reCAPTCHA (nk + MessageChannel) pour JSDOM / worker inline.
 * Aligné sur : postMessage(nk, [port2]); new Am(port1, …)
 */
import { serializePostMessageData } from "./postMessageSerialize.js";

function pickHandshakeReply(msg, window) {
  if (typeof msg === "string") {
    const t = msg.trim();
    if (t.startsWith("{") || t.startsWith("[")) {
      try {
        return JSON.parse(t);
      } catch {
        return msg;
      }
    }
    return msg;
  }
  if (msg != null && typeof msg === "object") {
    if (Array.isArray(msg)) return msg;
    if ("s" in msg || "e" in msg) return msg;
  }
  const nk = window?.__recaptchaNk;
  if (nk != null) return nk;
  return msg ?? {};
}

export function wireRecaptchaPort(port, { peer = null, window } = {}) {
  if (!port || port.__recaptchaWired) return port;
  port.__recaptchaWired = true;
  port._queue = port._queue ?? [];
  port._started = false;
  port._acked = false;

  const deliver = (msg, transfer = []) => {
    const data = serializePostMessageData(msg);
    const ev = { data, ports: transfer, source: peer ?? port };
    queueMicrotask(() => {
      if (typeof port.onmessage === "function") {
        try {
          port.onmessage(ev);
        } catch {
          /* ignore */
        }
      } else {
        port._queue.push(ev);
      }
      if (!port._acked && port._started) {
        port._acked = true;
        const reply = pickHandshakeReply(msg, window);
        queueMicrotask(() => {
          try {
            peer?.postMessage?.(serializePostMessageData(reply), []);
          } catch {
            /* ignore */
          }
        });
      }
    });
  };

  port.postMessage = (msg, transfer) => deliver(msg, transfer ?? []);
  port.start = () => {
    if (port._started) return;
    port._started = true;
    while (port._queue.length && typeof port.onmessage === "function") {
      port.onmessage(port._queue.shift());
    }
    queueMicrotask(() =>
      deliver(port.__bootMsg ?? window?.__recaptchaNk ?? "null"),
    );
  };
  port.close = () => {
    port._closed = true;
  };
  port.addEventListener = (type, fn) => {
    if (type === "message") port.onmessage = (ev) => fn(ev);
  };
  port.removeEventListener = () => {};

  let handler = null;
  Object.defineProperty(port, "onmessage", {
    get: () => handler,
    set: (fn) => {
      handler = fn;
      while (port._started && port._queue.length && typeof fn === "function") {
        fn(port._queue.shift());
      }
    },
    configurable: true,
  });

  return port;
}

export function installRecaptchaHandshake(window) {
  if (window.__recaptchaHandshakeInstalled) return;
  window.__recaptchaHandshakeInstalled = true;
  installMessageChannelHandshake(window);

  const orig = window.postMessage?.bind(window);
  if (!orig) return;

  window.postMessage = (message, targetOrigin, transfer) => {
    const ports = Array.isArray(transfer) ? transfer : [];
    const payload = serializePostMessageData(message);
    if (ports.length) {
      window.__recaptchaNk = payload;
      for (const p of ports) {
        wireRecaptchaPort(p, { window });
        p.__bootMsg = payload;
        try {
          p.start?.();
        } catch {
          /* ignore */
        }
      }
      queueMicrotask(() => dispatchWindowMessage(window, payload, ports));
    }
    try {
      return orig(message, targetOrigin, transfer);
    } catch {
      /* ignore */
    }
  };
}

export function dispatchWindowMessage(window, data, ports, { origin, source } = {}) {
  const Ev = window.MessageEvent || window.Event;
  const msgOrigin =
    origin ??
    (typeof data === "string" && data.startsWith("https://")
      ? data
      : window.location?.origin ?? "https://www.google.com");
  const ev = new Ev("message", {
    data,
    ports,
    origin: msgOrigin,
    source: source ?? window.parent ?? window,
  });
  if (typeof window.onmessage === "function") {
    try {
      window.onmessage(ev);
    } catch {
      /* ignore */
    }
  }
  const list = window._evtMap?.get("message") ?? [];
  for (const fn of list) {
    try {
      fn.call(window, ev);
    } catch {
      /* ignore */
    }
  }
}

/** Simule la réponse parent après Main.init (sinon Main.execute reste absent). */
export function completeAnchorHandshake(window, anchor) {
  const label = anchor?.initPayload?.[0] ?? "ainput";
  const handshake = JSON.stringify([label, null]);
  window.__recaptchaNk = handshake;

  const deliver = (msg) => {
    queueMicrotask(() => dispatchWindowMessage(window, msg, []));
  };

  const MC = window.MessageChannel;
  if (MC) {
    try {
      const mc = new MC();
      wireRecaptchaPort(mc.port1, { window, peer: mc.port2 });
      wireRecaptchaPort(mc.port2, { window, peer: mc.port1 });
      mc.port2.postMessage(handshake);
      mc.port1.start?.();
      mc.port2.start?.();
      queueMicrotask(() => {
        try {
          window.postMessage(handshake, "https://www.google.com", [mc.port2]);
        } catch {
          /* ignore */
        }
      });
    } catch {
      /* ignore */
    }
  }

  deliver(handshake);
}

/**
 * Enchaîne handshake + bgdata + recaptcha-setup (délais) pour exposer Main.execute.
 */
export function runAnchorHandshakeSequence(window, anchor) {
  const init = anchor?.initPayload;
  if (!Array.isArray(init)) {
    completeAnchorHandshake(window, anchor);
    return Promise.resolve();
  }

  const parentOrigin =
    init.find((x) => typeof x === "string" && x.startsWith("https://")) ??
    "https://auth.ticketmaster.com";

  const delay = (ms) => new Promise((r) => globalThis.setTimeout(r, ms));

  return (async () => {
    completeAnchorHandshake(window, anchor);
    await delay(80);

    const label = init[0] ?? "ainput";
    dispatchWindowMessage(
      window,
      JSON.stringify([label, null]),
      [],
      { origin: parentOrigin },
    );
    await delay(80);

    for (let i = 1; i < init.length; i++) {
      const item = init[i];
      if (item == null) continue;
      let msg = null;
      if (typeof item === "string") {
        if (item.length < 2) continue;
        msg = item;
      } else if (Array.isArray(item)) {
        msg = JSON.stringify(item);
      } else if (typeof item === "number") {
        continue;
      }
      if (!msg) continue;
      dispatchWindowMessage(window, msg, [], { origin: parentOrigin });
      await delay(60);
    }

    await delay(80);
    dispatchWindowMessage(window, "recaptcha-setup", [], { origin: parentOrigin });
  })();
}

function installMessageChannelHandshake(window) {
  const Orig = window.MessageChannel;
  window.MessageChannel = class MessageChannel {
    constructor() {
      const a = { onmessage: null };
      const b = { onmessage: null };
      wireRecaptchaPort(a, { peer: b, window });
      wireRecaptchaPort(b, { peer: a, window });
      this.port1 = a;
      this.port2 = b;
    }
  };
  if (Orig) window.MessageChannelNative = Orig;
}
