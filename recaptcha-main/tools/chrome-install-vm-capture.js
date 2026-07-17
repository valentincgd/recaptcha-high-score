/**
 * À coller dans la console de l’iframe Google anchor (PAS la page TM).
 *
 * Installe window.___vmDump + hooks (btoa, fetch, XHR) comme en JSDOM.
 * Ensuite : cliquer « Se connecter » sur TM → __vmCapture.export()
 *
 * Ticketmaster siteKey attendu : 6LdoaXQrAAAAADQviABd-eByJu6kPL8awKDyc1zb
 */

(function installVmCapture() {
  const TM_KEY = "6LdoaXQrAAAAADQviABd-eByJu6kPL8awKDyc1zb";
  const STATIC_DECODED = 78464;

  const curKey = (location.href.match(/[?&]k=([^&]+)/) || [])[1];
  if (curKey && curKey !== TM_KEY) {
    console.warn(
      `%c[vmCapture] Mauvaise iframe`,
      "color:#c5221f;font-weight:bold",
      "\nClé actuelle:",
      curKey.slice(0, 20) + "…",
      "\nClé Ticketmaster:",
      TM_KEY.slice(0, 20) + "…",
      "\n→ Console → menu top → choisir l’iframe avec k=6LdoaXQr",
    );
  }

  function ensureDump() {
    const d = window.___vmDump ?? {
      sends: [],
      bytecodes: [],
      errors: [],
      logs: [],
      installedAt: new Date().toISOString(),
    };
    window.___vmDump = d;
    return d;
  }

  function decodedLen(b64) {
    try {
      return atob(String(b64).replace(/\s/g, "")).length;
    } catch {
      return 0;
    }
  }

  function record(text, tag) {
    if (typeof text !== "string" || text.length < 300) return;
    const dump = ensureDump();
    const re05 = /05AL[A-Za-z0-9_-]{200,}/g;
    let m;
    while ((m = re05.exec(text)) !== null) {
      const tok = m[0].slice(0, 1276);
      if (!dump.sends.includes(tok)) dump.sends.push(tok);
      dump.last05AL = tok;
    }
    if (text.length >= 800 && /^[A-Za-z0-9+/_=.-]{400,}$/.test(text.slice(0, 500))) {
      if (!dump.bytecodes.includes(text)) {
        dump.bytecodes.push(text);
        dump.logs.push({ at: Date.now(), tag, len: text.length, decoded: decodedLen(text) });
        if (dump.bytecodes.length > 12) dump.bytecodes.shift();
      }
    }
  }

  if (!window.__vmCaptureInstalled) {
    window.__vmCaptureInstalled = true;
    const ob = window.btoa?.bind(window);
    if (ob) {
      window.btoa = function (...a) {
        const r = ob.apply(this, a);
        record(r, "btoa");
        return r;
      };
    }

    const of = window.fetch?.bind(window);
    if (of) {
      window.fetch = async function (input, init) {
        const res = await of(input, init);
        try {
          const url = typeof input === "string" ? input : input?.url;
          if (url?.includes("/reload")) {
            const clone = res.clone();
            const buf = await clone.arrayBuffer();
            const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
            dumpReloadBody(buf.byteLength, b64.slice(0, 200));
          }
        } catch (e) {
          ensureDump().errors.push(String(e.message || e).slice(0, 120));
        }
        return res;
      };
    }

    const oa = window.atob?.bind(window);
    if (oa) {
      window.atob = function (s) {
        const r = oa(s);
        record(r, "atob");
        return r;
      };
    }

    window.addEventListener(
      "message",
      (ev) => {
        const d = ev.data;
        if (typeof d === "string") record(d, "window-message");
        else if (d && typeof d === "object") {
          try {
            record(JSON.stringify(d), "window-message-json");
          } catch {
            /* ignore */
          }
        }
      },
      true,
    );

    const OW = window.Worker;
    if (OW) {
      window.Worker = function (url, opts) {
        const w = new OW(url, opts);
        w.addEventListener("message", (ev) => {
          const d = ev.data;
          if (typeof d === "string") record(d, "worker");
          else if (d != null) {
            try {
              record(JSON.stringify(d), "worker-json");
            } catch {
              /* ignore */
            }
          }
        });
        ensureDump().logs.push({ at: Date.now(), tag: "Worker-new", url: String(url).slice(0, 80) });
        return w;
      };
    }

    const XO = XMLHttpRequest;
    window.XMLHttpRequest = function () {
      const xhr = new XO();
      let _url = "";
      const os = xhr.open;
      xhr.open = function (m, u, ...rest) {
        _url = u;
        return os.call(xhr, m, u, ...rest);
      };
      xhr.addEventListener("load", function () {
        if (!_url?.includes("/reload") || xhr.response == null) return;
        try {
          const body = xhr.response;
          let len = 0;
          if (body instanceof ArrayBuffer) {
            len = body.byteLength;
            const bytes = new Uint8Array(body);
            let bin = "";
            const step = 0x8000;
            for (let i = 0; i < bytes.length; i += step) {
              bin += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
            }
            record(btoa(bin), "xhr-reload-b64");
          } else if (typeof body === "string") {
            len = body.length;
            record(body, "xhr-reload");
          }
          const d = ensureDump();
          d.lastReloadLen = len;
          d.lastReloadUrl = _url.slice(0, 120);
        } catch (e) {
          ensureDump().errors.push("xhr:" + (e.message || e));
        }
      });
      return xhr;
    };

    console.log(
      "%c[vmCapture] Hooks installés",
      "color:#0d652d;font-weight:bold",
      "(btoa, atob, Worker, message, fetch, XHR /reload)",
    );
  } else {
    console.log("[vmCapture] Déjà installé");
  }

  function dumpReloadBody(len, preview) {
    const d = ensureDump();
    d.lastReloadLen = len;
    d.lastReloadPreview = preview;
  }

  function status() {
    const d = ensureDump();
    const sized = (d.bytecodes ?? []).map((b, i) => ({
      i,
      b64Len: b.length,
      decodedLen: decodedLen(b),
      static: decodedLen(b) === STATIC_DECODED,
    }));
    sized.sort((a, b) => b.decodedLen - a.decodedLen);
    return {
      siteKey: curKey,
      isTmKey: curKey === TM_KEY,
      anchor: !!window.recaptcha?.anchor,
      execute: typeof window.recaptcha?.anchor?.Main?.execute,
      errorMain: !!window.recaptcha?.anchor?.ErrorMain,
      bytecodes: sized.length,
      sends: (d.sends ?? []).length,
      last05AL: d.last05AL ? d.last05AL.length : 0,
      lastReloadLen: d.lastReloadLen ?? 0,
      best: sized[0] ?? null,
      sized,
    };
  }

  function nextSteps() {
    const s = status();
    if (s.errorMain && s.execute !== "function") {
      console.warn(
        "%c[vmCapture] ErrorMain actif — hooks peut‑être trop tard",
        "color:#c5221f;font-weight:bold",
        "\n→ F5 sur la page Ticketmaster (pas seulement la console)\n" +
          "→ Re-sélectionner contexte (anchor) 6LdoaXQr\n" +
          "→ Re-coller CE script immédiatement\n" +
          "→ Cliquer « Se connecter » une fois",
      );
    } else if (s.execute !== "function") {
      console.log(
        "[vmCapture] Hooks OK. Allez sur la page TM → « Se connecter » → puis __vmCapture.status()",
      );
    }
    return s;
  }

  window.__vmCapture = {
    status,
    nextSteps,
    watch(ms = 2000, max = 30) {
      let n = 0;
      const t = setInterval(() => {
        const s = status();
        console.log("[vmCapture watch]", ++n, "bytecodes=", s.bytecodes, "reload=", s.lastReloadLen, "05AL=", s.last05AL);
        if (s.bytecodes > 0 || s.lastReloadLen >= 2000 || s.last05AL > 0 || n >= max) {
          clearInterval(t);
          if (s.bytecodes > 0 || s.last05AL > 0) console.log("%c[vmCapture] Prêt → export()", "color:#0d652d;font-weight:bold");
        }
      }, ms);
      console.log("[vmCapture] Surveillance… Cliquez « Se connecter » sur TM");
      return t;
    },
    export() {
      const d = ensureDump();
      const s = status();
      if (!d.bytecodes?.length && !d.sends?.length && !d.last05AL && (s.lastReloadLen ?? 0) < 2000) {
        nextSteps();
        console.warn("[vmCapture] Rien capturé — lancer __vmCapture.watch() puis login TM");
        return null;
      }
      if (!d.bytecodes?.length && (s.lastReloadLen ?? 0) >= 2000) {
        console.log(
          "[vmCapture] POST /reload capturé (" +
            s.lastReloadLen +
            " o) — taille normale pour enterprise TM (~4–5 ko).",
        );
        if (!d.last05AL && !d.sends?.length) {
          console.warn("  05AL absent du dump — vérifier export() après login.");
        }
      }
      if (s.best?.static) {
        console.warn("[vmCapture] Blob ~78464 o = asset statique, pas runtime.");
      }
      const json = JSON.stringify(d, null, 2);
      if (typeof copy === "function") copy(json);
      else console.log(json);
      console.log("[vmCapture] Copié", json.length, "chars", s);
      return d;
    },
    help() {
      console.log(
        "Ordre:\n" +
          "  1. Iframe k=6LdoaXQr (pas 6LcvL3Ur)\n" +
          "  2. Coller ce script AVANT le login\n" +
          "  3. Login TM → __vmCapture.status()\n" +
          "  4. __vmCapture.export() → dumps/chrome-vm.json\n" +
          "  5. npm run import:vm-dump -- dumps/chrome-vm.json",
      );
    },
  };

  function whereAmI() {
    const href = location.href;
    const key = (href.match(/[?&]k=([^&]+)/) || [])[1];
    const ctx =
      /google\.com.*recaptcha/i.test(href) && /anchor/i.test(href)
        ? "anchor-OK"
        : /google\.com/i.test(location.hostname) && !/recaptcha/i.test(href)
          ? "google-autre"
          : href === "about:blank" || !href
            ? "about:blank — mauvais contexte"
            : "autre";
    console.log("[vmCapture] whereAmI:", ctx, "\nhref:", href.slice(0, 100), "\nk=", key);
    return { ctx, href, siteKey: key, isTmKey: key === TM_KEY };
  }

  window.__vmCapture.whereAmI = whereAmI;
  console.table([status()]);
  whereAmI();
  console.log(
    "%c[vmCapture] Menu console DevTools",
    "font-weight:bold",
    "\n  1) a-XXXXX (anchor) + www.google.com  ← priorité\n" +
      "  2) webworker.js + www.google.com        ← si anchor vide après login\n" +
      "  ✗ about:blank, cosmetic_filters, extensions Captcha Solver",
  );
  nextSteps();
  console.log(
    "%c[vmCapture]",
    "font-weight:bold",
    " .watch() | .status() | .export() | .nextSteps() | .help()",
  );
  return window.__vmCapture;
})();
