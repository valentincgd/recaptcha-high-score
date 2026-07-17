// ISOLATED world : pont entre le hook MAIN world (inject.js) et le service
// worker. Reçoit les captures via postMessage et les relaie à chrome.runtime ;
// pousse l'état du blocage vers le MAIN world.
(function () {
  "use strict";

  function pushBlockState() {
    chrome.storage.local.get({ blockReload: false }, (o) => {
      window.postMessage({ __rcSetBlock: !!o.blockReload }, "*");
    });
  }

  // Capture -> background
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || !e.data.__rcReload) return;
    try {
      chrome.runtime.sendMessage({ type: "rcReload", payload: e.data.payload });
    } catch {}
  });

  // État du blocage initial + à chaque changement depuis le popup
  pushBlockState();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.blockReload) {
      window.postMessage({ __rcSetBlock: !!changes.blockReload.newValue }, "*");
    }
  });
})();
