/** Intercepte fetch/XHR pour capturer POST /reload depuis JSDOM. */
export function installNetworkCapture(window) {
  const cap = {
    reload: null,
    reloads: [],
  };
  window.__reloadCapture = cap;

  if (window.fetch) {
    const origFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const url = String(input?.url ?? input ?? "");
      const method = (init.method ?? "GET").toUpperCase();
      if (method === "POST" && url.includes("/reload?")) {
        const body = init.body;
        const buf =
          body instanceof ArrayBuffer
            ? Buffer.from(body)
            : typeof body === "string"
              ? Buffer.from(body, "latin1")
              : Buffer.isBuffer(body)
                ? body
                : null;
        try {
          const res = await origFetch(input, init);
          const text = await res.clone().text();
          const hit = {
            url,
            body: buf,
            bodyLen: buf?.length ?? 0,
            response: text,
            status: res.status,
            at: Date.now(),
          };
          cap.reloads.push(hit);
          if (!cap.reload || hit.bodyLen > (cap.reload.bodyLen ?? 0)) {
            cap.reload = hit;
          }
          return res;
        } catch (err) {
          cap.reloads.push({ url, body: buf, error: err.message, at: Date.now() });
          throw err;
        }
      }
      return origFetch(input, init);
    };
  }

  const OrigXHR = window.XMLHttpRequest;
  if (!OrigXHR) return cap;

  function CapturingXHR() {
    const xhr = new OrigXHR();
    let _url = "";
    let _method = "GET";
    const origOpen = xhr.open;
    const origSend = xhr.send;

    xhr.open = function (method, url, ...rest) {
      _method = method;
      _url = String(url);
      return origOpen.call(xhr, method, url, ...rest);
    };

    xhr.send = function (body) {
      if (_method.toUpperCase() === "POST" && _url.includes("/reload?")) {
        const buf =
          typeof body === "string"
            ? Buffer.from(body, "latin1")
            : body instanceof ArrayBuffer
              ? Buffer.from(body)
              : null;
        xhr.addEventListener("load", () => {
          const hit = {
            url: _url,
            body: buf,
            bodyLen: buf?.length ?? 0,
            response: xhr.responseText ?? "",
            status: xhr.status,
            at: Date.now(),
          };
          cap.reloads.push(hit);
          if (!cap.reload || hit.bodyLen > (cap.reload.bodyLen ?? 0)) {
            cap.reload = hit;
          }
        });
      }
      return origSend.call(xhr, body);
    };
    return xhr;
  }
  CapturingXHR.prototype = OrigXHR.prototype;
  window.XMLHttpRequest = CapturingXHR;

  return cap;
}
