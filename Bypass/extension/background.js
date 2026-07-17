/**
 * background.js — service worker (v2.1 Multi-Session Fix)
 *
 * DESIGN:
 *  • This is the ONLY place that talks to the local server.
 *  • Per-tab state lives here. The popup reads it via get_state.
 *  • REQUEST ID SYSTEM: each solve request carries a unique UUID so
 *    responses are always matched to the correct caller — fixing the
 *    "right token goes to wrong tab" bug.
 *  • Per-tab request deduplication: each tab gets exactly ONE solve
 *    attempt in flight at a time. Additional requests queue and get
 *    the same result.
 *  • Server health is cached and re-checked only every 10 s.
 *  • Per-request state tracking ensures tokens never cross between tabs.
 */

const SERVER = "https://extension.mmpharma.dev";

// ── Server health cache ─────────────────────────────────────────────────────
let serverOk = false;
let serverVersion = "?";
let lastPingMs = 0;
const PING_TTL = 10_000; // re-ping at most every 10 s

async function ensurePing() {
  const now = Date.now();
  if (now - lastPingMs < PING_TTL) return;
  lastPingMs = now;
  try {
    const r = await fetch(`${SERVER}/ping`);
    const j = await r.json();
    serverOk = j.status === "ok";
    serverVersion = j.v || "?";
  } catch {
    serverOk = false;
  }
}

// ── Per-tab state ────────────────────────────────────────────────────────────
// State machine: "idle" | "solving" | "solved" | "failed"
// Each tab tracks its own requests independently.
const tabs = {};

function getTab(id) {
  if (!tabs[id]) {
    tabs[id] = {
      state: "idle",
      siteKey: null,
      action: null,
      token: null,
      // ── Request isolation (v2.1 fix) ──
      inFlightRequestId: null,  // track the active request
      pendingResolvers: [],     // queue of {requestId, resolve} for dedup
    };
  }
  return tabs[id];
}

/**
 * Generate a unique request ID.
 * Combines tab ID + timestamp + random suffix for uniqueness.
 */
function makeRequestId(tabId) {
  return `tab_${tabId}_t_${Date.now()}_r_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Solve ────────────────────────────────────────────────────────────────────
async function solve(tabId, { site_key, origin, action, hl }) {
  const tab = getTab(tabId);

  // If a request is already in flight for this tab, queue this caller
  // and give them the same result when it completes.
  if (tab.state === "solving") {
    console.log(`[bg] Tab ${tabId}: dedup — request already in flight, queueing`);
    return new Promise((resolve) => {
      tab.pendingResolvers.push({ resolve });
    });
  }

  // Mark as solving and generate a unique request ID
  tab.state = "solving";
  tab.siteKey = site_key;
  tab.action = action || "submit";
  tab.token = null;

  const requestId = makeRequestId(tabId);
  tab.inFlightRequestId = requestId;

  try {
    await ensurePing();
    if (!serverOk) {
      tab.state = "idle";
      _resolvePending(tab, null);
      return { token: null, requestId, error: "server_offline" };
    }

    console.log(`[bg] Tab ${tabId}: sending solve request ${requestId}`);

    const r = await fetch(`${SERVER}/solve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Request-ID": requestId,  // header for server-side tracing
      },
      body: JSON.stringify({
        site_key,
        origin,
        action: tab.action,
        hl,
        request_id: requestId,  // body field for response correlation
      }),
    });
    const j = await r.json();

    // ── CRITICAL FIX: verify response matches our request ──
    // If the server returns a different request_id, something went wrong.
    if (j && j.request_id && j.request_id !== requestId) {
      console.error(`[bg] Tab ${tabId}: REQUEST MISMATCH! sent=${requestId} got=${j.request_id}`);
      tab.state = "idle";
      _resolvePending(tab, null);
      return { token: null, requestId, error: "request_mismatch" };
    }

    if (j && j.token) {
      tab.state = "idle";
      tab.token = j.token;
      tab.lastRequestId = requestId;
      console.log(`[bg] Tab ${tabId}: got token for ${requestId}`);
      _resolvePending(tab, j.token);
      return { token: j.token, requestId, cached: false };
    } else {
      tab.state = "idle";
      console.warn(`[bg] Tab ${tabId}: no token in response for ${requestId}`);
      _resolvePending(tab, null);
      return { token: null, requestId, error: j.error || "no_token" };
    }
  } catch (err) {
    tab.state = "idle";
    console.error(`[bg] Tab ${tabId}: network error for ${requestId}:`, err);
    _resolvePending(tab, null);
    return { token: null, requestId, error: "network_error" };
  } finally {
    tab.inFlightRequestId = null;
  }
}

/**
 * Resolve all pending deduplication promises with the same result.
 */
function _resolvePending(tab, token) {
  while (tab.pendingResolvers.length) {
    const { resolve } = tab.pendingResolvers.shift();
    resolve(token ? { token, cached: false } : { token: null, error: "dedup_failed" });
  }
}

// ── Message router ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab ? sender.tab.id : msg.tabId;

  // Content script detected reCAPTCHA → solve it
  if (msg.type === "solve") {
    solve(tabId, msg.data).then((result) => {
      // result: { token, requestId, cached?, error? }
      sendResponse(result);
    });
    return true; // async
  }

  // Popup wants current state for a tab
  if (msg.type === "get_state") {
    ensurePing().then(() => {
      const tab = getTab(msg.tabId);
      sendResponse({
        state: tab.state,
        siteKey: tab.siteKey,
        action: tab.action,
        serverOk,
        serverVersion,
      });
    });
    return true;
  }

  // Popup refresh button → force a fresh ping
  if (msg.type === "force_ping") {
    lastPingMs = 0;
    ensurePing().then(() => sendResponse({ serverOk, serverVersion }));
    return true;
  }


});

// ── Cleanup ──────────────────────────────────────────────────────────────────
chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabs[tabId];
});

// Re-navigate on the same tab: reset state so a new solve can be attempted
chrome.webNavigation.onCommitted.addListener(({ tabId, frameId }) => {
  if (frameId !== 0) return; // main frame only
  console.log(`[bg] Tab ${tabId}: navigation committed, resetting state`);
  delete tabs[tabId];
});

// Track token delivery for analytics
chrome.webNavigation.onCompleted.addListener(({ tabId, frameId }) => {
  if (frameId !== 0) return;
  const tab = tabs[tabId];
  if (tab && tab.token) {
    console.log(`[bg] Tab ${tabId}: page load completed with active token`);
  }
});
