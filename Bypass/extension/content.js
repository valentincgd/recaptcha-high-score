const PREFIX = "__rc_bypass__";

// ── Detect context ───────────────────────────────────────────────────────────
const isRecaptchaIframe =
  window.location.hostname === "www.google.com" &&
  (window.location.pathname.includes("/recaptcha/api2/anchor") ||
   window.location.pathname.includes("/recaptcha/enterprise/anchor"));

if (isRecaptchaIframe) {
  // Inject iframe script into the iframe's main world
  (function injectIframeScript() {
    const s = document.createElement("script");
    s.src = chrome.runtime.getURL("inject-iframe.js");
    (document.head || document.documentElement).appendChild(s);
    s.onload = () => s.remove();
  })();
} else {
  // ── Main frame logic ──

  // Inject the page-world script
  (function injectScript() {
    const s = document.createElement("script");
    s.src = chrome.runtime.getURL("inject.js");
    (document.head || document.documentElement).appendChild(s);
    s.onload = () => s.remove();
  })();

  // ── State (v2.1 fix: scope tokens by sitekey+action, not globally) ──
  let solveDispatched = false;

  // Token cache keyed by "sitekey:action" — prevents cross-contamination
  // when a page has multiple recaptchas with different configurations.
  const tokenCache = new Map();  // key → { token, requestId, timestamp }
  const CACHE_TTL_MS = 110_000;  // tokens valid for ~110s (Google's TTL is ~120s)

  // Pending callers waiting for an in-flight request
  const pendingQueues = new Map();  // key → [{id, resolve}]

  /**
   * Build a cache key from sitekey and action.
   * Different sitekeys/actions get different tokens.
   */
  function _cacheKey(sitekey, action) {
    return `${sitekey || "?"}:${action || "submit"}`;
  }

  /**
   * Get a cached token if it's still fresh.
   */
  function _getCachedToken(key) {
    const entry = tokenCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      tokenCache.delete(key);
      return null;
    }
    return entry;
  }

  function deliver(token, id) {
    window.postMessage({ type: PREFIX + "result", token, id }, "*");
  }

  function forwardToIframes(token) {
    var iframes = document.querySelectorAll('iframe[src*="recaptcha/api2/anchor"], iframe[src*="recaptcha/enterprise/anchor"]');
    iframes.forEach(function (iframe) {
      try {
        if (iframe.contentWindow) {
          iframe.contentWindow.postMessage({ type: PREFIX + "_token", token: token }, "*");
        }
      } catch (e) {}
    });
  }

  /**
   * Dispatch a solve request to the background script.
   * v2.1: Tokens are scoped by (sitekey, action) to prevent
   * the "right token goes to wrong session" bug.
   */
  function dispatchSolve(sitekey, action, origin, id) {
    const cacheKey = _cacheKey(sitekey, action);

    // Check cache first — return cached token if fresh
    const cached = _getCachedToken(cacheKey);
    if (cached) {
      console.log(`[content] Cache hit for ${cacheKey}, request ${id}`);
      if (id !== -1) deliver(cached.token, id);
      forwardToIframes(cached.token);
      return;
    }

    // If a request is already in flight for this (sitekey, action),
    // queue this caller to receive the same result.
    if (solveDispatched && pendingQueues.has(cacheKey)) {
      console.log(`[content] Request ${id} queued for in-flight ${cacheKey}`);
      if (id !== -1) {
        const queue = pendingQueues.get(cacheKey);
        queue.push({ id });
      }
      return;
    }

    solveDispatched = true;

    // Create a pending queue for this (sitekey, action) combination
    const newQueue = id !== -1 ? [{ id }] : [];
    pendingQueues.set(cacheKey, newQueue);

    console.log(`[content] Dispatching solve for ${cacheKey}, request ${id}`);

    chrome.runtime.sendMessage(
      {
        type: "solve",
        data: {
          site_key: sitekey,
          origin:   origin || location.origin,
          action:   action || "submit",
          hl:       document.documentElement.lang || "en",
        },
      },
      function (resp) {
        // v2.1: resp now includes { token, requestId, cached?, error? }
        const token = (resp && resp.token) || null;
        const requestId = (resp && resp.requestId) || "unknown";

        if (token) {
          // Cache the token scoped by (sitekey, action)
          tokenCache.set(cacheKey, {
            token,
            requestId,
            timestamp: Date.now(),
          });

          // Deliver to the original requester
          deliver(token, id);

          // Deliver to all queued pending requests for this same (sitekey, action)
          const queue = pendingQueues.get(cacheKey) || [];
          while (queue.length) {
            const pending = queue.shift();
            if (pending && pending.id !== undefined && pending.id !== id) {
              deliver(token, pending.id);
            }
          }

          forwardToIframes(token);
        } else {
          // No token — deliver null so the page falls back to real grecaptcha
          deliver(null, id);
          const queue = pendingQueues.get(cacheKey) || [];
          while (queue.length) {
            const pending = queue.shift();
            if (pending && pending.id !== undefined && pending.id !== id) {
              deliver(null, pending.id);
            }
          }
        }

        // Clean up the pending queue
        pendingQueues.delete(cacheKey);

        // If no more pending queues, allow fresh dispatch
        if (pendingQueues.size === 0) {
          solveDispatched = false;
        }
      }
    );
  }

  function tryProactiveSolve() {
    if (solveDispatched) return;
    const el = document.querySelector(
      ".g-recaptcha[data-sitekey], div[data-sitekey]"
    );
    if (!el) return;
    const sitekey = el.getAttribute("data-sitekey");
    if (!sitekey) return;
    dispatchSolve(sitekey, "submit", location.origin, -1);
  }

  window.addEventListener("message", function (e) {
    if (e.source !== window || !e.data || typeof e.data.type !== "string") return;

    if (e.data.type === PREFIX + "solve") {
      // v2.1: inject.js now sends sitekey AND action for proper scoping
      dispatchSolve(e.data.sitekey, e.data.action, e.data.origin, e.data.id);
      return;
    }

    if (e.data.type === PREFIX + "detected") {
      tryProactiveSolve();
    }
  });

  window.addEventListener("DOMContentLoaded", tryProactiveSolve);
  setTimeout(tryProactiveSolve, 2000);
  setTimeout(tryProactiveSolve, 5000);
}
