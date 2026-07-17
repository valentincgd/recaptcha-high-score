const KEY = "rcCaptures";
const $ = (id) => document.getElementById(id);

function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString() + "." + String(d.getMilliseconds()).padStart(3, "0");
}

function render(caps) {
  $("count").textContent = `${caps.length} capture(s)`;
  const list = $("list");
  list.innerHTML = "";
  // plus récent en haut
  caps
    .slice()
    .reverse()
    .forEach((c) => {
      const div = document.createElement("div");
      div.className = "cap";
      const bodyLen = c.reqBodyB64 ? c.reqBodyB64.length : 0;
      const respLen = c.respBody ? c.respBody.length : 0;
      div.innerHTML =
        `<div class="meta">` +
        `<b>${c.kind}</b> ${c.method} · ${c.via} · ${fmtTime(c.ts)} ` +
        (c.blocked ? `<span class="blk">[BLOQUÉ]</span>` : `resp ${c.respStatus ?? "?"} (${respLen})`) +
        `<br>req body: ${bodyLen} car b64</div>`;
      const ta = document.createElement("textarea");
      ta.value = c.reqBodyB64 || "";
      ta.readOnly = true;
      div.appendChild(ta);
      if (c.caller && c.caller.scripts && c.caller.scripts.length) {
        const cs = document.createElement("div");
        cs.className = "small";
        cs.style.color = "#dd9";
        cs.textContent = "script(s) appelant: " + c.caller.scripts.join("  |  ");
        div.appendChild(cs);
      }
      if (c.respBody) {
        const rt = document.createElement("textarea");
        rt.value = c.respBody.slice(0, 2000);
        rt.readOnly = true;
        div.appendChild(rt);
      }
      list.appendChild(div);
    });
}

function load() {
  chrome.storage.local.get({ [KEY]: [], blockReload: false }, (o) => {
    render(o[KEY]);
    const btn = $("block");
    btn.textContent = "Bloquer reload : " + (o.blockReload ? "ON" : "OFF");
    btn.classList.toggle("on", !!o.blockReload);
  });
}

$("block").addEventListener("click", () => {
  chrome.storage.local.get({ blockReload: false }, (o) => {
    chrome.storage.local.set({ blockReload: !o.blockReload }, load);
  });
});

$("refresh").addEventListener("click", load);

$("clear").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "rcClear" }, load);
});

$("dl").addEventListener("click", () => {
  chrome.storage.local.get({ [KEY]: [] }, (o) => {
    const blob = new Blob([JSON.stringify(o[KEY], null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rc-reload-captures-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
});

load();
