(function () {
  if (window.__rcBypassLoaded) return;
  window.__rcBypassLoaded = true;

  const PREFIX = "__rc_bypass__";
  let seq = 0;
  var cachedToken = null;

  // ── Track in-flight requests to prevent response mixing ──
  const inFlightRequests = new Map();  // id → { done, resolve, timer }

  /**
   * Generate a unique request ID for each execute call.
   * This ensures responses are always matched to the correct request,
   * preventing the "right token goes to wrong session" bug.
   */
  function _makeRequestId() {
    return ++seq;
  }

  // ── Wrap a single execute function ─────────────────────────────────────────
  function wrapExecute(orig, ctx) {
    return function (sitekey, opts) {
      const id = _makeRequestId();
      const action = (opts && opts.action) || "submit";

      return new Promise(function (resolve) {
        let done = false;

        function finish(token) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          window.removeEventListener("message", onResult);
          inFlightRequests.delete(id);
          resolve(token);
        }

        function onResult(e) {
          if (
            !e.data ||
            e.data.type !== PREFIX + "result" ||
            // CRITICAL: only accept responses matching our request ID
            e.data.id !== id
          )
            return;
          if (e.data.token) {
            finish(e.data.token);
          } else {
            // Fallback to real grecaptcha if bypass returned no token
            orig.call(ctx, sitekey, opts).then(finish);
          }
        }

        window.addEventListener("message", onResult);

        // Store in-flight request for cleanup
        const timer = setTimeout(function () {
          window.removeEventListener("message", onResult);
          inFlightRequests.delete(id);
          if (!done) {
            // Timeout — fall back to real grecaptcha
            orig.call(ctx, sitekey, opts).then(finish);
          }
        }, 12000);

        inFlightRequests.set(id, { done: false, timer });

        // Send the solve request to content script
        window.postMessage(
          { type: PREFIX + "solve", sitekey, action, origin: location.origin, id },
          "*"
        );
      });
    };
  }

  // ── Apply wrapper ──────────────────────────────────────────────────────────
  function wrap(obj) {
    if (!obj || obj.__rcWrapped) return;
    obj.__rcWrapped = true;

    if (typeof obj.execute === "function") {
      const orig = obj.execute.bind(obj);
      obj.execute = wrapExecute(orig, obj);
    }
    if (typeof obj.getResponse === "function") {
      const orig = obj.getResponse.bind(obj);
      obj.getResponse = function (opt_widget_id) {
        var real = orig(opt_widget_id);
        if (real) return real;
        var id = opt_widget_id;
        if (id === undefined) id = 0;
        var ta = document.getElementById(
          'g-recaptcha-response' + (id ? '-' + id : '')
        );
        return ta ? ta.value : null;
      };
    }
    if (obj.enterprise && typeof obj.enterprise.execute === "function") {
      const orig = obj.enterprise.execute.bind(obj.enterprise);
      obj.enterprise.execute = wrapExecute(orig, obj.enterprise);
    }
  }

  let _g;
  Object.defineProperty(window, "grecaptcha", {
    get() { return _g; },
    set(v) { _g = v; if (v && typeof v === "object") wrap(v); },
    configurable: true,
    enumerable: true,
  });

  if (window.grecaptcha) wrap(window.grecaptcha);

  let n = 0;
  const poll = setInterval(function () {
    if (window.grecaptcha && !window.grecaptcha.__rcWrapped) wrap(window.grecaptcha);
    if (++n >= 100) clearInterval(poll);
  }, 200);

  // ── Detect implicit render ─────────────────────────────────────────────
  const obs = new MutationObserver(function () {
    const el = document.querySelector(
      'iframe[src*="recaptcha"], .g-recaptcha[data-sitekey], div[data-sitekey]'
    );
    if (el) {
      window.postMessage({ type: PREFIX + "detected" }, "*");
      obs.disconnect();
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });

  if (
    document.querySelector(
      '.g-recaptcha[data-sitekey], div[data-sitekey]'
    )
  ) {
    window.postMessage({ type: PREFIX + "detected" }, "*");
  }

  // ── Forward token to recaptcha iframes ─────────────────────────────────
  function forwardTokenToIframes(token) {
    var iframes = document.querySelectorAll(
      'iframe[src*="recaptcha/api2/anchor"], iframe[src*="recaptcha/enterprise/anchor"]'
    );
    var clients = window.___grecaptcha_cfg && window.___grecaptcha_cfg.clients;
    iframes.forEach(function (iframe) {
      try {
        if (!iframe.contentWindow) return;
        var widgetId = 0;
        if (clients) {
          for (var key in clients) {
            var c = clients[key];
            var container =
              (c && (c.element || c.container || c.Z
                || (typeof c.J === 'object' && c.J && c.J.tagName ? c.J : null)));
            if (container) {
              if (container === iframe || container.contains(iframe)) {
                widgetId = c.id;
                break;
              }
            }
          }
        }
        iframe.contentWindow.postMessage({
          type: PREFIX + "_token", token: token, widgetId: widgetId
        }, "*");
      } catch (e) {}
    });
  }

  // ── Re-render approach ─────────────────────────────────────────────────
  function rerenderWidgets(token) {
    var containers = document.querySelectorAll('.g-recaptcha');
    if (!containers.length) return;
    var clients = window.___grecaptcha_cfg && window.___grecaptcha_cfg.clients;
    containers.forEach(function (el) {
      try {
        var sitekey = el.getAttribute('data-sitekey');
        if (!sitekey) return;

        var params = { sitekey: sitekey };
        var theme = el.getAttribute('data-theme');
        if (theme) params.theme = theme;
        var size = el.getAttribute('data-size');
        if (size) params.size = size;
        var cbName = el.getAttribute('data-callback');
        if (cbName && typeof window[cbName] === 'function') {
          params.callback = window[cbName];
        }

        if (clients) {
          for (var key in clients) {
            var c = clients[key];
            if (c && (c.container === el || (c.element && c.element === el))) {
              try { grecaptcha.reset(c.id); } catch (e) {}
              break;
            }
          }
        }

        el.innerHTML = '';
        var newId = grecaptcha.render(el, params);
        grecaptcha.execute(newId);
      } catch (e) {}
    });
  }

  // ── Inject tokens into rendered widgets ─────────────────────────────────
  var _injected = false;
  var _injectRetries = 0;
  var _maxRetries = 8;

  function injectIntoWidget(token) {
    if (_injected) return;
    cachedToken = token;

    forwardTokenToIframes(token);

    if (tryClientsCallback(token)) { _injected = true; return; }
    if (tryTextareaAndCallback(token)) { _injected = true; return; }

    if (_injectRetries < _maxRetries) {
      _injectRetries++;
      setTimeout(function () { injectIntoWidget(token); }, 1000);
    } else {
      rerenderWidgets(token);
    }
  }

  function tryClientsCallback(token) {
    try {
      var clients = window.___grecaptcha_cfg && window.___grecaptcha_cfg.clients;
      if (!clients) return false;
      var ok = false;
      for (var key in clients) {
        var c = clients[key];
        if (c && typeof c.callback === 'function') {
          c.callback(token);
          ok = true;
        } else if (c && c.data && typeof c.data.callback === 'function') {
          c.data.callback(token);
          ok = true;
        }
      }
      return ok;
    } catch (e) { return false; }
  }

  function tryTextareaAndCallback(token) {
    var tas = document.querySelectorAll('textarea[id^="g-recaptcha-response"]');
    var ok = false;
    if (tas.length) {
      for (var i = 0; i < tas.length; i++) {
        if (!tas[i].value) { tas[i].value = token; ok = true; }
      }
      if (ok) {
        var els = document.querySelectorAll('.g-recaptcha[data-callback]');
        for (var i = 0; i < els.length; i++) {
          var fn = window[els[i].getAttribute('data-callback')];
          if (typeof fn === 'function') fn(token);
        }
        return true;
      }
    }
    return false;
  }

  window.addEventListener("message", function (e) {
    if (!e.data || e.data.type !== PREFIX + "result") return;
    if (e.data.token) injectIntoWidget(e.data.token);
  });
})();
