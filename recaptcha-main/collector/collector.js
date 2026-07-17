/*
 * reCAPTCHA fingerprint collector (post-BotGuard, retiré le 04/01/2026).
 *
 * But : reproduire la collecte de signaux de reCAPTCHA dans un vrai navigateur
 * pour capturer un fingerprint COMPLET — incluant la biométrie réelle (souris,
 * scroll, clavier) qui détermine désormais le score — puis l'exporter en JSON
 * afin de le rejouer côté serveur (API Go) sans navigateur à chaque token.
 *
 * Utilisation :
 *   1. Ouvrir la page cible (ex: page event Ticketmaster) dans un vrai Chrome.
 *   2. Coller ce script dans la console DevTools (ou via bookmarklet/extension).
 *   3. Bouger la souris / scroller / cliquer ~5s (interaction humaine réelle).
 *   4. Le collector finalise et : (a) log le JSON, (b) window.__rcFingerprint,
 *      (c) télécharge un fichier, (d) POST optionnel vers HARVEST_URL.
 *
 * Les clés VM/biométrie (417, 352, 959, 549, 659, 1092, 291, 1310, 1994, ...)
 * sont FIXES et documentées ; les signaux collecteurs (idx 29-71) portent leur
 * clé dérivée de la valeur (deriveSignalCode/deriveKey, approximé ici, à
 * calibrer via les paires connues des captures).
 */
(function () {
  "use strict";

  const CONFIG = {
    captureMs: 5000, // fenêtre d'interaction humaine
    harvestUrl: null, // ex: "http://127.0.0.1:3848/api/fingerprint/harvest"
    harvestKey: "dispurgendispurticketdispurcaptcha",
    autoDownload: true,
    siteKey: findSiteKey(),
    action: "Event",
  };

  // ---- Interception reCAPTCHA (action réelle + requête reload) -------------
  // Objectif : capturer la vraie `action` passée à grecaptcha.execute et le
  // corps du POST /recaptcha/.../reload du navigateur qui passe, pour valider
  // notre format de blob côté serveur. Doit être installé le plus tôt possible.

  const net = { executes: [], anchors: [], reloads: [], other: [] };
  window.__rcNetwork = net;

  async function bodyToB64(body) {
    if (body == null) return null;
    if (typeof body === "string") return "str:" + b64(strBytes(body));
    if (body instanceof URLSearchParams) return "str:" + b64(strBytes(body.toString()));
    let buf;
    if (body instanceof ArrayBuffer) buf = new Uint8Array(body);
    else if (ArrayBuffer.isView(body)) buf = new Uint8Array(body.buffer);
    else if (typeof Blob !== "undefined" && body instanceof Blob)
      buf = new Uint8Array(await body.arrayBuffer());
    else return null;
    return "bin:" + b64(buf);
  }
  function strBytes(s) {
    return new TextEncoder().encode(s);
  }
  function b64(bytes) {
    let s = "";
    for (const x of bytes) s += String.fromCharCode(x);
    return btoa(s);
  }
  function classify(url) {
    if (/reload/.test(url)) return "reloads";
    if (/anchor/.test(url)) return "anchors";
    return "other";
  }

  function wrapExecute(obj, label) {
    if (!obj || typeof obj.execute !== "function" || obj.__rcHooked) return;
    const orig = obj.execute.bind(obj);
    obj.execute = function (a, b) {
      try {
        let sk = null,
          action = null;
        if (typeof a === "string") {
          sk = a;
          action = b && b.action;
        } else if (a && typeof a === "object") {
          sk = a.sitekey || a.siteKey || null;
          action = a.action;
        }
        net.executes.push({ label, siteKey: sk, action: action || null, ts: Date.now() });
        console.log(
          `%c[collector] grecaptcha.execute (${label}) action=${action} siteKey=${sk}`,
          "color:#a0f;font-weight:bold",
        );
      } catch {}
      return orig(a, b);
    };
    obj.__rcHooked = true;
  }
  function hookGrecaptcha() {
    if (window.grecaptcha) {
      wrapExecute(window.grecaptcha, "grecaptcha");
      if (window.grecaptcha.enterprise) wrapExecute(window.grecaptcha.enterprise, "enterprise");
    }
  }
  function installGrecaptchaHook() {
    hookGrecaptcha();
    let n = 0;
    const iv = setInterval(() => {
      hookGrecaptcha();
      if (++n > 150) clearInterval(iv);
    }, 200);
  }

  function recordNet(kind, url, method, reqBodyB64, respText) {
    const bucket = classify(url);
    net[bucket].push({
      kind,
      url,
      method,
      reqBodyB64,
      respPreview: respText ? respText.slice(0, 240) : null,
      respLen: respText ? respText.length : 0,
      ts: Date.now(),
    });
    console.log(
      `%c[collector] ${bucket} ${method} ${url} (body ${reqBodyB64 ? reqBodyB64.length : 0})`,
      "color:#0a8",
    );
  }

  function installFetchHook() {
    if (!window.fetch || window.fetch.__rcHooked) return;
    const orig = window.fetch;
    const wrapped = async function (input, init) {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      const isRc = /\/recaptcha\//.test(url);
      let reqBodyB64 = null;
      if (isRc) {
        const body = (init && init.body) || (input && input.body) || null;
        try {
          reqBodyB64 = await bodyToB64(body);
        } catch {}
      }
      const resp = await orig.apply(this, arguments);
      if (isRc) {
        let txt = null;
        try {
          txt = await resp.clone().text();
        } catch {}
        recordNet("fetch", url, (init && init.method) || "GET", reqBodyB64, txt);
      }
      return resp;
    };
    wrapped.__rcHooked = true;
    window.fetch = wrapped;
  }

  function installXHRHook() {
    const P = XMLHttpRequest.prototype;
    if (P.__rcHooked) return;
    const open = P.open;
    const send = P.send;
    P.open = function (method, url) {
      this.__rcUrl = url;
      this.__rcMethod = method;
      return open.apply(this, arguments);
    };
    P.send = function (body) {
      const url = this.__rcUrl || "";
      if (/\/recaptcha\//.test(url)) {
        bodyToB64(body)
          .then((b64v) => {
            this.addEventListener("load", () => {
              recordNet("xhr", url, this.__rcMethod || "GET", b64v, this.responseText || "");
            });
          })
          .catch(() => {});
      }
      return send.apply(this, arguments);
    };
    P.__rcHooked = true;
  }

  installGrecaptchaHook();
  installFetchHook();
  installXHRHook();

  window.__rcDumpNetwork = function () {
    const json = JSON.stringify(net, null, 2);
    console.log("[collector] réseau reCAPTCHA capturé:", net);
    try {
      const blob = new Blob([json], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `rc-network-${Date.now()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch {}
    return net;
  };

  // ---- Hash utilitaires (identiques aux samples reCAPTCHA) -----------------

  function toSigned32(n) {
    n = n >>> 0;
    if (n >= 0x80000000) n -= 0x100000000;
    return n;
  }

  function hashString(data, seed = 0) {
    data = String(data);
    let h = seed;
    for (let i = 0; i < data.length; i++) {
      h = toSigned32(((h << 5) - h + data.charCodeAt(i)) >>> 0);
    }
    return h;
  }

  async function sha256Trunc(str, len = 10) {
    const buf = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(str),
    );
    let hex = "";
    for (const b of new Uint8Array(buf)) hex += b.toString(16).padStart(2, "0");
    return hex.slice(0, len);
  }

  // BitHash 240 bits (idx 16 — HEAD elements).
  class BitHash {
    constructor(totalBits, rounds, maxChanges) {
      this.capacity = totalBits;
      this.segs = Math.floor(totalBits / 6);
      this.iter = rounds;
      this.left = maxChanges;
      this.grid = Array.from({ length: this.segs }, () => [0, 0, 0, 0, 0, 0]);
    }
    add(src) {
      if (this.left <= 0) return false;
      let changed = false;
      for (let c = 0; c < this.iter; c++) {
        const h = hashString(src);
        const idx = ((h % this.capacity) + this.capacity) % this.capacity;
        const r = Math.floor(idx / 6);
        const col = idx % 6;
        if (this.grid[r][col] === 0) {
          this.grid[r][col] = 1;
          changed = true;
        }
        src = String(h);
      }
      if (changed) this.left--;
      return true;
    }
    toString() {
      const A =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
      let out = "";
      for (let r = 0; r < this.segs; r++) {
        let v = 0;
        for (let b = this.grid[r].length - 1; b >= 0; b--) {
          v = v * 2 + this.grid[r][b];
        }
        out += A[v];
      }
      return out;
    }
  }

  // BinaryGridHasher 60 bits (idx 31 cookies, idx 34 inputs, idx 61 mutations).
  class GridHasher {
    constructor(rounds = 2, bits = 60, maxEntries = 20) {
      this.left = maxEntries;
      this.rounds = rounds;
      this.bits = bits;
      this.rows = Math.floor(bits / 6);
      this.grid = Array.from({ length: this.rows }, () => [0, 0, 0, 0, 0, 0]);
    }
    add(input) {
      if (this.left <= 0) return false;
      let changed = false;
      for (let r = 0; r < this.rounds; r++) {
        const h = hashString(input, 0);
        const idx = ((h % this.bits) + this.bits) % this.bits;
        const row = Math.floor(idx / 6);
        const col = idx % 6;
        if (this.grid[row][col] === 0) {
          this.grid[row][col] = 1;
          changed = true;
        }
        input = String(h);
      }
      if (changed) this.left--;
      return true;
    }
    toString() {
      const A =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
      let out = "";
      for (let r = 0; r < this.rows; r++) {
        const bits = [...this.grid[r]].reverse().join("");
        const i = parseInt(bits, 2);
        if (i < A.length) out += A[i];
      }
      return out;
    }
  }

  // ---- Dérivation de clé par-signal (approx, calibrée sur paires connues) ---

  const KNOWN_CODE = { "BUTTON,195a81c9": "wg", wgia1z9pwq: "21" };
  const KNOWN_KEY = { wg: 3792, "21": 1599 };
  const CHARSET =
    "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_";

  function deriveSignalCode(value) {
    const s = String(value ?? "");
    if (KNOWN_CODE[s]) return KNOWN_CODE[s];
    const h = hashString(s) >>> 0;
    return CHARSET[(h >> 0) % 64] + CHARSET[(h >> 8) % 64];
  }

  function deriveKey(code) {
    if (KNOWN_KEY[code] != null) return KNOWN_KEY[code];
    let h = hashString(code);
    h = ((h % 4000) + 4000) % 4000;
    return 1500 + (h % 2500);
  }

  // ---- Collecteurs statiques ------------------------------------------------

  function findSiteKey() {
    const el =
      document.querySelector("[data-sitekey]") ||
      document.querySelector(".g-recaptcha[data-sitekey]");
    if (el) return el.getAttribute("data-sitekey");
    const m = /[?&]k=([\w-]{40})/.exec(document.documentElement.innerHTML);
    if (m) return m[1];
    const m2 = /render=([\w-]{40})/.exec(document.documentElement.innerHTML);
    return m2 ? m2[1] : "";
  }

  function webglSignal() {
    try {
      const c = document.createElement("canvas");
      const gl =
        c.getContext("webgl") ||
        c.getContext("experimental-webgl") ||
        c.getContext("webgl2");
      if (!gl) return ["", "", 0];
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      const vendor = dbg
        ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)
        : gl.getParameter(gl.VENDOR);
      const renderer = dbg
        ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER);
      const ext = (gl.getSupportedExtensions() || []).length;
      return [vendor, renderer, ext];
    } catch {
      return ["", "", 0];
    }
  }

  function hashBrowserProtos() {
    const checks = [
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
    const out = [];
    for (const [name, pick] of checks) {
      try {
        const proto = window[name] && window[name].prototype;
        if (!proto) {
          out.push(0);
          continue;
        }
        const names = Object.getOwnPropertyNames(proto);
        const picked = names[pick];
        out.push(picked == null ? 0 : hashString(String(picked)));
      } catch {
        out.push(0);
      }
    }
    return out;
  }

  function hashHead() {
    const head = document.head;
    if (!head) return "";
    const bh = new BitHash(240, 7, 25);
    for (const node of head.children) {
      const parts = [node.tagName];
      for (const a of node.attributes || []) parts.push(a.name + ":" + a.value);
      bh.add(String(hashString(parts.join("|"))));
    }
    return bh.toString();
  }

  function hashCookies() {
    const gh = new GridHasher();
    for (const kv of (document.cookie || "").split("; ")) {
      const name = kv.split("=")[0];
      if (name) gh.add(name);
    }
    return gh.toString();
  }

  function hashInputs() {
    const gh = new GridHasher();
    for (const el of document.querySelectorAll("input")) {
      gh.add(el.getAttribute("name") || el.getAttribute("id") || el.type || "");
    }
    return gh.toString();
  }

  function scriptIndex() {
    const re = /https:\/\/www\.gstatic\.com\/recaptcha\/releases\/[^/]+\/.*/;
    const s = document.scripts;
    for (let i = 0; i < s.length; i++) if (re.test(s[i].src)) return String(i);
    return "0";
  }

  function scriptLinks() {
    const hosts = new Set();
    for (const s of document.scripts) {
      try {
        if (s.src) hosts.add(new URL(s.src).host);
      } catch {}
    }
    return [...hosts].join(",");
  }

  function screenDims() {
    return [
      screen.width,
      screen.height,
      screen.availHeight,
      window.innerWidth,
      window.innerHeight,
      window.outerHeight,
    ];
  }

  // ---- Capture comportementale (biométrie — le vrai déterminant du score) --

  const bio = {
    t0: performance.now(),
    mouse: [], // [ts, dur, x, y, [l,t,w,h], tagType, ptrType, pressure, travel, area]
    scroll: [], // [scrollX, scrollY, ts]
    keys: [], // [code, ts]
    pressed: [], // [hashedElem, tagType, type, autoComplete]
    visibility: [[document.visibilityState === "visible" ? 1 : 0, 0]],
    counts: {
      pointermove: 0,
      pointerdown: 0,
      pointerup: 0,
      keydown: 0,
      keyup: 0,
      focusin: 0,
    },
    lastX: 0,
    lastY: 0,
    travel: 0,
  };

  const EVENT_HASH = {
    pointermove: 5006,
    pointerdown: 64607,
    pointerup: 45464,
    keydown: 31617,
    keyup: 37178,
    focusin: 35837,
  };

  function tagType(el) {
    if (!el || !el.tagName) return 0;
    return hashString(el.tagName) & 0xff;
  }

  function onMove(e) {
    bio.counts.pointermove++;
    const dx = e.clientX - bio.lastX;
    const dy = e.clientY - bio.lastY;
    bio.travel += Math.sqrt(dx * dx + dy * dy);
    bio.lastX = e.clientX;
    bio.lastY = e.clientY;
    const t = e.target;
    const r = t && t.getBoundingClientRect ? t.getBoundingClientRect() : null;
    if (bio.mouse.length < 60) {
      bio.mouse.push([
        Math.round(performance.now() - bio.t0),
        0,
        e.clientX,
        e.clientY,
        r ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] : [0, 0, 0, 0],
        tagType(t),
        e.pointerType === "mouse" ? 1 : e.pointerType === "touch" ? 2 : 0,
        Math.round((e.pressure || 0) * 50),
        Math.round(bio.travel),
        0,
      ]);
    }
  }

  function onDown(e) {
    bio.counts.pointerdown++;
    const t = e.target;
    bio.pressed.push([
      hashString((t && t.tagName ? t.tagName : "") + "," + (t && t.id ? t.id : "")),
      tagType(t),
      t && t.type ? hashString(t.type) & 0xff : 0,
      t && t.autocomplete ? 1 : 0,
    ]);
  }

  function onUp() {
    bio.counts.pointerup++;
  }
  function onKeyDown(e) {
    bio.counts.keydown++;
    bio.keys.push([hashString(e.code || "") & 0xffff, Math.round(performance.now() - bio.t0)]);
  }
  function onKeyUp() {
    bio.counts.keyup++;
  }
  function onFocusIn() {
    bio.counts.focusin++;
  }
  function onScroll() {
    if (bio.scroll.length < 40) {
      bio.scroll.push([window.scrollX | 0, window.scrollY | 0, Math.round(performance.now() - bio.t0)]);
    }
  }
  function onVisibility() {
    bio.visibility.push([
      document.visibilityState === "visible" ? 1 : 0,
      Math.round(performance.now() - bio.t0),
    ]);
  }

  function attach() {
    addEventListener("pointermove", onMove, { passive: true, capture: true });
    addEventListener("pointerdown", onDown, { passive: true, capture: true });
    addEventListener("pointerup", onUp, { passive: true, capture: true });
    addEventListener("keydown", onKeyDown, { capture: true });
    addEventListener("keyup", onKeyUp, { capture: true });
    addEventListener("focusin", onFocusIn, { capture: true });
    addEventListener("scroll", onScroll, { passive: true, capture: true });
    addEventListener("visibilitychange", onVisibility);
  }
  function detach() {
    removeEventListener("pointermove", onMove, { capture: true });
    removeEventListener("pointerdown", onDown, { capture: true });
    removeEventListener("pointerup", onUp, { capture: true });
    removeEventListener("keydown", onKeyDown, { capture: true });
    removeEventListener("keyup", onKeyUp, { capture: true });
    removeEventListener("focusin", onFocusIn, { capture: true });
    removeEventListener("scroll", onScroll, { capture: true });
    removeEventListener("visibilitychange", onVisibility);
  }

  // ---- Signal comportemental idx73/key352 (biométrie souris) ---------------

  function buildMouseSignal() {
    const pts = bio.mouse.length;
    const checksum = hashString(JSON.stringify(bio.mouse)) & 0xff;
    return [
      bio.counts.pointermove,
      bio.mouse,
      [pts, Math.round(bio.travel), 0],
      [pts, bio.counts.pointerdown, Math.round(bio.travel), pts],
      0,
      0,
      checksum,
    ];
  }

  function buildScrollSignal() {
    return [bio.scroll, bio.scroll.length, hashString(JSON.stringify(bio.scroll)) & 0xff];
  }

  function buildPressedSignal() {
    const ts = bio.pressed.map((_, i) => [i, Math.round(performance.now() - bio.t0)]);
    return [ts, bio.pressed, bio.pressed.length, hashString(JSON.stringify(bio.pressed)) & 0xff];
  }

  function buildKeyboardSignal() {
    if (!bio.keys.length) return [0, null, null, null, null, null, null];
    return [bio.keys.length, bio.keys, null, null, null, null, null];
  }

  function eventCounts() {
    const out = [];
    for (const [name, hash] of Object.entries(EVENT_HASH)) {
      if (bio.counts[name] > 0) out.push([hash, bio.counts[name]]);
    }
    return out;
  }

  // ---- VM signals (idx 73) : clés FIXES documentées ------------------------

  async function batteryInfo() {
    try {
      if (navigator.getBattery) {
        const b = await navigator.getBattery();
        return [b.level, b.charging ? 1 : 0, b.chargingTime, b.dischargingTime];
      }
    } catch {}
    return [1, 0, 0, Infinity];
  }

  async function storageQuota() {
    try {
      const est = await navigator.storage.estimate();
      return est.quota || 0;
    } catch {
      return 0;
    }
  }

  // ---- Finalisation ---------------------------------------------------------

  async function finalize() {
    detach();
    const wg = webglSignal();
    const [battery, quota] = await Promise.all([batteryInfo(), storageQuota()]);

    const sk = CONFIG.siteKey || "";
    const idx4 = sk ? await sha256Trunc(sk + "6d", 10) : "";

    const staticSignals = [];
    const push = (value, elapsed = 0) => {
      const code = deriveSignalCode(value);
      staticSignals.push({ value: String(value), key: deriveKey(code), elapsed });
    };

    // Signaux collecteurs (idx 29-71) — valeurs réelles de CETTE page.
    push(JSON.stringify(location.origin + "/")); // 27-ish origin
    push("false"); // 28 in-frame
    push(JSON.stringify(hashCookies())); // 31
    push(document.referrer || '""'); // 32
    push(JSON.stringify(hashInputs())); // 34
    push(scriptIndex()); // 30
    push(String(window.history.length)); // 45
    push(String(window.length)); // 47
    push(String(window.scrollY | 0)); // 40
    push(JSON.stringify(screenDims())); // 67
    push(JSON.stringify([new Date().getTimezoneOffset(), null, Date.now()])); // 68
    push(JSON.stringify([
      performance.memory ? performance.memory.jsHeapSizeLimit : 0,
      performance.memory ? performance.memory.usedJSHeapSize : 0,
      performance.memory ? performance.memory.totalJSHeapSize : 0,
    ])); // 71
    push(JSON.stringify(scriptLinks())); // 57
    push(document.title || ""); // 62

    const vmSignals = [
      { key: 417, value: navigator.userAgent, ce: 3, ee: 0 },
      { key: 545, value: String(!!navigator.webdriver), ce: 0, ee: 0 },
      { key: 370, value: String(navigator.maxTouchPoints || 0), ce: 0, ee: 0 },
      { key: 659, value: JSON.stringify(buildPressedSignal()), ce: 1, ee: 1 },
      { key: 959, value: JSON.stringify(buildScrollSignal()), ce: 1, ee: 1 },
      { key: 895, value: JSON.stringify([bio.visibility]), ce: 1, ee: 1 },
      { key: 549, value: JSON.stringify(buildKeyboardSignal()), ce: 1, ee: 3 },
      { key: 352, value: JSON.stringify(buildMouseSignal()), ce: 5, ee: 9 }, // BIOMÉTRIE
      { key: 1278, value: String(Math.trunc(performance.now()) / 10), ce: 0, ee: 0 },
      { key: 1313, value: JSON.stringify([typeof window.android, Object.keys(window.chrome || {}).length]), ce: 1, ee: 0 },
      { key: 1994, value: JSON.stringify([navigator.hardwareConcurrency || 0, navigator.deviceMemory || 0, quota]), ce: 1, ee: 6 },
      { key: 614, value: JSON.stringify(battery), ce: 1, ee: 0 },
      { key: 1310, value: JSON.stringify(wg), ce: 12, ee: 0 },
      { key: 291, value: JSON.stringify(hashBrowserProtos()), ce: 28, ee: 2 },
    ];

    const uaData = navigator.userAgentData || null;
    const brands = uaData
      ? uaData.brands.map((b) => [b.brand, b.version])
      : [];

    // Action réelle interceptée sur grecaptcha.execute (fallback = CONFIG).
    const detectedActions = net.executes.map((e) => e.action).filter(Boolean);
    const realAction = detectedActions.length
      ? detectedActions[detectedActions.length - 1]
      : CONFIG.action;
    if (detectedActions.length) {
      console.log(
        `%c[collector] action réelle détectée: ${realAction} (toutes: ${JSON.stringify([...new Set(detectedActions)])})`,
        "color:#a0f;font-weight:bold",
      );
    } else {
      console.warn(
        "[collector] aucune action grecaptcha interceptée — le hook a été posé trop tard, ou la page n'a pas ré-exécuté reCAPTCHA. Recharge la page AVEC le collector déjà collé, puis attends/clique.",
      );
    }

    const fp = {
      capturedAt: new Date().toISOString(),
      url: location.href,
      origin: location.origin,
      referer: location.href,
      siteKey: sk,
      action: realAction,
      userAgent: navigator.userAgent,
      acceptLang: navigator.languages ? navigator.languages.join(",") : navigator.language,
      language: navigator.language,
      secChUa: uaData ? brands.map((b) => `"${b[0]}";v="${b[1]}"`).join(", ") : "",
      secChUaMobile: uaData && uaData.mobile ? "?1" : "?0",
      secChUaPlatform: `"${(uaData && uaData.platform) || "Windows"}"`,
      platform: navigator.platform || "Win32",
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
      webgl: { vendor: wg[0], renderer: wg[1], extensionCount: wg[2] },
      localStorageLength: (window.localStorage && window.localStorage.length) || 0,
      title: document.title || "",
      scrollY: window.scrollY | 0,
      positional: {
        4: idx4,
        5: ((window.localStorage && window.localStorage.length) || 0) * 2,
        16: [hashHead()],
        27: location.origin,
        28: false,
        72: uaData ? [brands, uaData.mobile ? 1 : 0, uaData.platform || "Windows"] : null,
      },
      signals: staticSignals,
      vmSignals,
      events: eventCounts(),
      biometrics: {
        mousePoints: bio.mouse.length,
        scrollPoints: bio.scroll.length,
        keyEvents: bio.keys.length,
        totalTravel: Math.round(bio.travel),
        counts: bio.counts,
      },
      detectedActions: [...new Set(detectedActions)],
      network: {
        executes: net.executes,
        anchors: net.anchors,
        reloads: net.reloads,
        other: net.other,
      },
    };

    window.__rcFingerprint = fp;
    console.log("%c[collector] Fingerprint capturé", "color:#0a0;font-weight:bold");
    console.log(fp);
    console.log(
      `[collector] biométrie: ${fp.biometrics.mousePoints} pts souris, ` +
        `${fp.biometrics.scrollPoints} scroll, ${fp.biometrics.keyEvents} touches, ` +
        `${fp.biometrics.totalTravel}px parcourus`,
    );

    const json = JSON.stringify(fp, null, 2);
    if (CONFIG.autoDownload) download(json);
    if (CONFIG.harvestUrl) await harvest(json);
    return fp;
  }

  function download(json) {
    try {
      const blob = new Blob([json], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `fingerprint-${Date.now()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) {
      console.warn("[collector] download impossible:", e);
    }
  }

  async function harvest(json) {
    try {
      const r = await fetch(CONFIG.harvestUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Valou-Key": CONFIG.harvestKey },
        body: json,
      });
      console.log("[collector] harvest:", r.status);
    } catch (e) {
      console.warn("[collector] harvest échoué:", e);
    }
  }

  // ---- Démarrage ------------------------------------------------------------

  attach();
  console.log(
    `%c[collector] Capture démarrée (${CONFIG.captureMs}ms). ` +
      `Bougez la souris / scrollez / cliquez maintenant.`,
    "color:#08f;font-weight:bold",
  );
  console.log(`[collector] siteKey détecté: ${CONFIG.siteKey || "(aucun)"}`);

  // Finalise après la fenêtre, ou immédiatement via window.__rcFinalize().
  const timer = setTimeout(finalize, CONFIG.captureMs);
  window.__rcFinalize = () => {
    clearTimeout(timer);
    return finalize();
  };
})();
