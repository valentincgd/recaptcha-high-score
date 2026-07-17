/**
 * popup.js — v2.1 Multi-Session Fix
 *
 * DESIGN RULES:
 *  • The popup NEVER contacts the server directly.
 *  • The popup reads state from background.js via get_state once:
 *      - on DOMContentLoaded
 *      - when the user clicks Refresh
 *  • NO setInterval, NO polling loop of any kind.
 *  • Background.js caches server health with a 10 s TTL.
 *  • Request ID display shows the correlation ID for the latest token.
 */

const $ = (id) => document.getElementById(id);

function render(state) {
  // state: { state, siteKey, action, serverOk, serverVersion }
  const s = state.state; // "idle" | "solving" | "solved" | "failed"

  // ── Server pill ────────────────────────────────────────────────────────────
  const pill = $("srvPill");
  if (state.serverOk) {
    pill.className = "srv-pill ok";
    pill.textContent = "Online";
    $("version").textContent = "v" + (state.serverVersion || "?");
  } else {
    pill.className = "srv-pill err";
    pill.textContent = "Offline";
  }

  // ── Status dot + text ──────────────────────────────────────────────────────
  const dot   = $("dot");
  const title = $("stateTitle");
  const sub   = $("stateSub");

  dot.className = "dot dot-" + (
    s === "idle"    ? "idle"    :
    s === "solving" ? "solving" :
    s === "solved"  ? "solved"  : "failed"
  );

  if (s === "idle") {
    title.textContent = "Not detected";
    sub.textContent   = "No reCAPTCHA found on this page";
  } else if (s === "solving") {
    title.textContent = "Solving…";
    sub.textContent   = "Token request sent to server";
  } else if (s === "solved") {
    title.textContent = "Solved ✓";
    sub.textContent   = "Token obtained and delivered to the page";
  } else {
    title.textContent = "Failed";
    sub.textContent   = state.serverOk
      ? "Server returned no token — check server logs"
      : "Server is offline — check that python server.py is running";
  }

  // ── Detail values ──────────────────────────────────────────────────────────
  $("valSiteKey").textContent = state.siteKey || "—";
  $("valAction").textContent  = state.action  || "—";

  const sv = $("valServer");
  sv.textContent  = state.serverOk ? "Online"  : "Offline";
  sv.className    = "value " + (state.serverOk ? "ok" : "err");

  // ── Banner ─────────────────────────────────────────────────────────────────
  $("banner").classList.toggle("hidden", s !== "solved");
}

function loadState() {
  // Ask background for the active tab, then get its state
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0] ? tabs[0].id : null;
    if (!tabId) {
      render({ state: "idle", siteKey: null, action: null, serverOk: false });
      return;
    }
    chrome.runtime.sendMessage({ type: "get_state", tabId }, (st) => {
      if (chrome.runtime.lastError || !st) {
        render({ state: "idle", siteKey: null, action: null, serverOk: false });
        return;
      }
      render(st);
    });
  });
}

function forceRefresh() {
  // Show a brief "checking…" state while we wait
  $("srvPill").textContent = "Checking…";
  chrome.runtime.sendMessage({ type: "force_ping" }, () => loadState());
}

document.addEventListener("DOMContentLoaded", loadState);
$("refreshBtn").addEventListener("click", forceRefresh);
