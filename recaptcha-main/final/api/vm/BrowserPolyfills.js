import { installMessageChannelBus } from "./MessageChannelBus.js";
import { applyCanvasWebGL } from "./applyCanvasWebGL.js";
import { installVmBytecodeCapture } from "./installVmBytecodeCapture.js";
import { serializePostMessageData } from "./postMessageSerialize.js";
import { recordVmCaptureText } from "./vmCaptureUtil.js";

/** Polyfills navigateur pour exécuter recaptcha__fr.js dans JSDOM. */
export function applyBrowserPolyfills(window) {
  installMessageChannelBus(window);
  installVmBytecodeCapture(window);
  try {
    applyCanvasWebGL(window);
  } catch {
    /* node-canvas optionnel */
  }
  for (const key of ["Response", "Request", "Headers", "FormData", "AbortController"]) {
    if (!window[key] && globalThis[key]) {
      window[key] = globalThis[key];
    }
  }

  const origSetTimeout = window.setTimeout.bind(window);
  window.setTimeout = (fn, ms = 0, ...args) => {
    let delay = ms;
    // Ne pas ralentir les timers courts (VM, iframe, handshake) — seulement les watchdogs reCAPTCHA (~20–30 s).
    if (typeof ms === "number" && ms >= 15_000 && ms < 40_000) {
      delay = 60_000;
    }
    return origSetTimeout(fn, delay, ...args);
  };
  const doc = window.document;
  const noop = () => {};
  const noopTrue = () => true;

  const listenerMixin = {
    addEventListener(type, fn, opts) {
      this._evtMap = this._evtMap || new Map();
      const list = this._evtMap.get(type) || [];
      list.push(fn);
      this._evtMap.set(type, list);
    },
    removeEventListener(type, fn) {
      const list = this._evtMap?.get(type);
      if (!list) return;
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    dispatchEvent(ev) {
      const list = this._evtMap?.get(ev?.type) || [];
      for (const fn of list) {
        try {
          fn.call(this, ev);
        } catch {
          /* ignore */
        }
      }
      return true;
    },
    attachEvent(name, fn) {
      const type = String(name).replace(/^on/, "");
      this.addEventListener(type, fn);
    },
    detachEvent(name, fn) {
      const type = String(name).replace(/^on/, "");
      this.removeEventListener(type, fn);
    },
  };

  for (const C of [window.EventTarget, window.Node, window.Element, window.HTMLElement]) {
    if (!C?.prototype) continue;
    for (const [k, v] of Object.entries(listenerMixin)) {
      if (typeof C.prototype[k] !== "function") {
        C.prototype[k] = v;
      }
    }
  }

  // reCAPTCHA utilise parfois Array ou objets nus comme bus d'événements.
  for (const proto of [Array.prototype, Object.prototype]) {
    for (const [k, v] of Object.entries(listenerMixin)) {
      if (typeof proto[k] !== "function") {
        proto[k] = v;
      }
    }
  }

  if (window.Array && window.Array.prototype !== Array.prototype) {
    Object.assign(window.Array.prototype, listenerMixin);
  }

  for (const [k, v] of Object.entries(listenerMixin)) {
    if (typeof window[k] !== "function") window[k] = v;
    if (typeof doc[k] !== "function") doc[k] = v;
  }

  if (!window.chrome) {
    window.chrome = {
      runtime: {},
      app: { isInstalled: false },
      csi: () => ({}),
      loadTimes: () => ({}),
    };
  }

  if (!window.visualViewport) {
    window.visualViewport = {
      width: window.innerWidth,
      height: window.innerHeight,
      scale: 1,
      offsetLeft: 0,
      offsetTop: 0,
      addEventListener: listenerMixin.addEventListener,
      removeEventListener: listenerMixin.removeEventListener,
    };
  }

  try {
    if (!window.localStorage) {
      const store = new Map();
      window.localStorage = {
        getItem: (k) => store.get(k) ?? null,
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear(),
        key: (i) => [...store.keys()][i] ?? null,
        get length() {
          return store.size;
        },
      };
    }
    if (!window.sessionStorage) {
      const store = new Map();
      window.sessionStorage = {
        getItem: (k) => store.get(k) ?? null,
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear(),
        key: (i) => [...store.keys()][i] ?? null,
        get length() {
          return store.size;
        },
      };
    }
  } catch {
    /* ignore */
  }

  if (!window.matchMedia) {
    window.matchMedia = () => ({
      matches: false,
      media: "",
      addListener: noop,
      removeListener: noop,
      addEventListener: noop,
      removeEventListener: noop,
      dispatchEvent: noopTrue,
    });
  }

  if (!window.MutationObserver) {
    window.MutationObserver = class {
      constructor() {}
      observe() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    };
  }

  if (!window.IntersectionObserver) {
    window.IntersectionObserver = class {
      constructor() {}
      observe() {}
      disconnect() {}
      unobserve() {}
    };
  }

  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      constructor() {}
      observe() {}
      disconnect() {}
      unobserve() {}
    };
  }

  const blobStore = (window.__blobStore = window.__blobStore || new Map());
  const stashBlob = (id, blob) => {
    const entry = { blob, scriptText: null };
    if (typeof blob === "string") entry.scriptText = blob;
    else if (blob?._buffer) entry.scriptText = blob._buffer.toString("utf8");
    else if (typeof blob?.text === "function") {
      Promise.resolve(blob.text())
        .then((t) => {
          entry.scriptText = t;
        })
        .catch(() => {});
    }
    blobStore.set(id, entry);
  };
  if (!window.URL?.createObjectURL) {
    window.URL = window.URL || {};
    window.URL.createObjectURL = (blob) => {
      const id = `blob:jsdom-${Math.random().toString(36).slice(2)}`;
      stashBlob(id, blob);
      return id;
    };
    window.URL.revokeObjectURL = (id) => blobStore.delete(id);
  } else {
    const origCreate = window.URL.createObjectURL.bind(window.URL);
    const origRevoke = window.URL.revokeObjectURL.bind(window.URL);
    window.URL.createObjectURL = (blob) => {
      const id = origCreate(blob);
      stashBlob(id, blob);
      return id;
    };
    window.URL.revokeObjectURL = (id) => {
      blobStore.delete(id);
      return origRevoke(id);
    };
  }

  if (!window.Worker) {
    window.Worker = class Worker {
      constructor(scriptUrl) {
        this.onmessage = null;
        this.onerror = null;
        this._terminated = false;
        this._url = String(scriptUrl);
        this._inbound = [];
        queueMicrotask(() => this.#bootstrap());
      }
      async #bootstrap() {
        if (this._terminated) return;
        try {
          const src = await Worker.#resolveScript(this._url, window);
          if (!src) return;
          const fn = new Function(
            "self",
            "postMessage",
            "onmessage",
            `${src}\n//# sourceURL=${this._url}`,
          );
          const post = (data, transfer) => {
            if (this._terminated) return;
            window.__workerLastMsg = data;
            const ports = Array.isArray(transfer) ? transfer : [];
            queueMicrotask(() => {
              try {
                window.postMessage(data, "*", ports);
              } catch {
                /* ignore */
              }
            });
          };
          const fakeSelf = {
            postMessage: post,
            onmessage: null,
          };
          fn(fakeSelf, post, null);
          while (this._inbound.length) {
            const msg = this._inbound.shift();
            if (typeof fakeSelf.onmessage === "function") {
              fakeSelf.onmessage({ data: msg });
            }
          }
        } catch (err) {
          window.__workerBootError = err?.message ?? String(err);
          if (process.env.RECAPTCHA_VM_DEBUG === "1") {
            console.warn("[Worker]", window.__workerBootError?.slice(0, 200));
          }
          if (typeof this.onerror === "function") {
            this.onerror({ message: err.message });
          }
        }
      }
      postMessage(data) {
        if (this._terminated) return;
        this._inbound.push(data);
        queueMicrotask(() => this.#bootstrap());
      }
      terminate() {
        this._terminated = true;
      }
      addEventListener(type, fn) {
        if (type === "message") this.onmessage = (ev) => fn(ev);
        if (type === "error") this.onerror = (ev) => fn(ev);
      }
      removeEventListener() {}
      static async #resolveScript(url, win) {
        if (!url.startsWith("blob:")) return null;
        const entry = win.__blobStore?.get(url);
        if (!entry) return null;
        if (typeof entry === "string") return entry;
        if (entry.scriptText) return entry.scriptText;
        const blob = entry.blob ?? entry;
        if (typeof blob === "string") return blob;
        if (blob?._buffer) return blob._buffer.toString("utf8");
        if (typeof blob?.text === "function") {
          try {
            entry.scriptText = await blob.text();
            return entry.scriptText;
          } catch {
            /* retry below */
          }
        }
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 25));
          if (entry.scriptText) return entry.scriptText;
        }
        return null;
      }
    };
  }

  if (!window.SharedWorker) {
    window.SharedWorker = class SharedWorker {
      constructor() {
        this.port = {
          onmessage: null,
          postMessage: noop,
          start: noop,
          addEventListener(type, fn) {
            if (type === "message") this.onmessage = (ev) => fn(ev);
          },
          removeEventListener: noop,
        };
      }
    };
  }

  if (!window.BroadcastChannel) {
    window.BroadcastChannel = class BroadcastChannel {
      constructor() {
        this.onmessage = null;
      }
      postMessage() {}
      close() {}
      addEventListener(type, fn) {
        if (type === "message") this.onmessage = (ev) => fn(ev);
      }
      removeEventListener() {}
    };
  }

  const w = window;
  const origPost = w.postMessage?.bind(w);
  w.postMessage = (message, targetOrigin, transfer) => {
    const ports = Array.isArray(transfer) ? transfer : [];
    const payload = serializePostMessageData(message);
    recordVmCaptureText(w, payload);
    const origin =
      typeof targetOrigin === "string"
        ? targetOrigin
        : targetOrigin == null || targetOrigin === w
          ? "*"
          : "*";
    queueMicrotask(() => {
      const Ev = w.MessageEvent || w.Event;
      const ev = new Ev("message", { data: payload, ports, origin });
      if (typeof w.onmessage === "function") {
        try {
          w.onmessage(ev);
        } catch {
          /* ignore */
        }
      }
      const list = w._evtMap?.get("message") ?? [];
      for (const fn of list) {
        try {
          fn.call(w, ev);
        } catch {
          /* ignore */
        }
      }
      for (const port of ports) {
        if (port && typeof port.onmessage !== "function" && port._queue) {
          port._queue.push({ data: payload, ports: [], source: port });
        }
      }
    });
    try {
      if (origPost) return origPost(message, origin, transfer);
    } catch {
      /* ignore */
    }
  };

  window.___vmDump = window.___vmDump || {
    sends: [],
    errors: [],
    logs: [],
  };

  if (!window.__recaptchaMsgHook) {
    window.__recaptchaMsgHook = true;
    window.addEventListener("message", (ev) => {
      const ports = ev.ports;
      if (!ports?.length) return;
      for (const port of ports) {
        if (!port || typeof port.postMessage !== "function") continue;
        queueMicrotask(() => {
          try {
            const payload = serializePostMessageData(ev.data);
            port.postMessage(payload, []);
          } catch {
            /* ignore */
          }
        });
      }
    });
  }
}
