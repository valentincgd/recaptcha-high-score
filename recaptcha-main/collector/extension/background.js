// Service worker : stocke les captures reload/anchor dans chrome.storage.local
// (les 100 dernières), consultables/exportables depuis le popup.
const KEY = "rcCaptures";
const MAX = 100;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;

  if (msg.type === "rcReload") {
    chrome.storage.local.get({ [KEY]: [] }, (o) => {
      const arr = o[KEY];
      arr.push({ ...msg.payload, frame: sender.url || null, tabId: sender.tab ? sender.tab.id : null });
      chrome.storage.local.set({ [KEY]: arr.slice(-MAX) }, () => {
        chrome.action.setBadgeText({ text: String(Math.min(arr.length, 99)) });
        chrome.action.setBadgeBackgroundColor({ color: "#0a8" });
      });
    });
    return;
  }

  if (msg.type === "rcClear") {
    chrome.storage.local.set({ [KEY]: [] }, () => {
      chrome.action.setBadgeText({ text: "" });
      if (sendResponse) sendResponse({ ok: true });
    });
    return true;
  }
});
