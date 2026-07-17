// MAIN world : posé dans chaque frame reCAPTCHA (document_start) pour hooker
// fetch/XHR AVANT que la lib reCAPTCHA n'émette le POST /reload.
// Rôle : lire le body exact du reload (protobuf) -> base64, la réponse (token),
// et optionnellement BLOQUER le reload navigateur pour rejeu manuel.
(function () {
  "use strict";
  if (window.__rcReloadHooked) return;
  window.__rcReloadHooked = true;

  const TARGET = "/recaptcha/enterprise/reload";
  const ANCHOR = "/recaptcha/enterprise/anchor";
  const GEC = "/epsf/gec/"; // token propriétaire Ticketmaster (le vrai levier)
  let BLOCK = false;

  // Le popup (via bridge ISOLATED) pousse l'état du blocage ici.
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.__rcSetBlock === undefined) return;
    BLOCK = !!e.data.__rcSetBlock;
    log(`blocage reload = ${BLOCK}`);
  });

  function log(msg, color = "#0a8") {
    try {
      console.log(`%c[rc-ext] ${msg}`, `color:${color};font-weight:bold`);
    } catch {}
  }

  function emit(payload) {
    window.postMessage({ __rcReload: true, payload }, "*");
  }

  function b64(u8) {
    let s = "";
    const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    }
    return btoa(s);
  }

  async function toB64(body) {
    if (body == null) return null;
    if (typeof body === "string") {
      return "str:" + b64(new TextEncoder().encode(body));
    }
    if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
      return "str:" + b64(new TextEncoder().encode(body.toString()));
    }
    if (body instanceof ArrayBuffer) return "bin:" + b64(new Uint8Array(body));
    if (ArrayBuffer.isView(body)) {
      return "bin:" + b64(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
    }
    if (typeof Blob !== "undefined" && body instanceof Blob) {
      return "bin:" + b64(new Uint8Array(await body.arrayBuffer()));
    }
    return null;
  }

  function kind(url) {
    if (url.indexOf(TARGET) !== -1) return "reload";
    if (url.indexOf(ANCHOR) !== -1) return "anchor";
    if (url.indexOf(GEC) !== -1) return "gec";
    return null;
  }

  // Stack trace au point d'appel : localise le script TM qui poste le token gec.
  function callStack() {
    try {
      const s = new Error().stack || "";
      // garder les URLs de scripts (hors extension)
      const urls = (s.match(/https?:\/\/[^\s):]+/g) || []).filter(
        (u) => u.indexOf("/recaptcha/") === -1,
      );
      return { stack: s.slice(0, 2000), scripts: [...new Set(urls)].slice(0, 12) };
    } catch {
      return null;
    }
  }

  // ---- fetch ----------------------------------------------------------------
  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    const k = kind(url);
    if (!k) return origFetch.apply(this, arguments);

    const body =
      (init && init.body) ||
      (typeof input === "object" && input && input.body) ||
      null;
    const reqBodyB64 = await toB64(body).catch(() => null);
    const base = { kind: k, url, method: (init && init.method) || "POST", reqBodyB64, ts: Date.now(), via: "fetch" };
    if (k === "gec") base.caller = callStack();

    if (k === "reload" && BLOCK) {
      emit({ ...base, blocked: true });
      log(`RELOAD BLOQUÉ (fetch) body=${reqBodyB64 ? reqBodyB64.length : 0} b64`, "#e33");
      return new Response("", { status: 200, statusText: "blocked-by-extension" });
    }

    const resp = await origFetch.apply(this, arguments);
    let respBody = null;
    try {
      respBody = await resp.clone().text();
    } catch {}
    emit({ ...base, respBody, respStatus: resp.status });
    log(`${k} capturé (fetch) req=${reqBodyB64 ? reqBodyB64.length : 0} resp=${respBody ? respBody.length : 0}`);
    return resp;
  };

  // ---- XHR ------------------------------------------------------------------
  const XO = XMLHttpRequest.prototype.open;
  const XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__rcUrl = url;
    this.__rcMethod = method;
    return XO.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    const url = this.__rcUrl || "";
    const k = kind(url);
    if (!k) return XS.apply(this, arguments);

    const self = this;
    const caller = k === "gec" ? callStack() : null;
    toB64(body)
      .then((reqBodyB64) => {
        const base = { kind: k, url, method: self.__rcMethod || "POST", reqBodyB64, ts: Date.now(), via: "xhr", caller };
        if (k === "reload" && BLOCK) {
          emit({ ...base, blocked: true });
          log(`RELOAD BLOQUÉ (xhr) body=${reqBodyB64 ? reqBodyB64.length : 0} b64`, "#e33");
          return;
        }
        self.addEventListener("load", () => {
          emit({ ...base, respBody: self.responseText, respStatus: self.status });
          log(`${k} capturé (xhr) req=${reqBodyB64 ? reqBodyB64.length : 0}`);
        });
      })
      .catch(() => {});

    if (k === "reload" && BLOCK) return; // ne pas émettre la vraie requête
    return XS.apply(this, arguments);
  };

  log("hook reload/anchor installé (" + location.href.slice(0, 60) + ")");
})();
