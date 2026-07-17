import { HttpClient } from "../HttpClient.js";
import { VmRuntimeCapture } from "./VmRuntimeCapture.js";

const googleRe = /^https:\/\/(www\.google\.com|www\.gstatic\.com)\//;

function mergeHeaders(base, extra) {
  const h = { ...base };
  if (extra && typeof extra === "object" && !(extra instanceof Headers)) {
    Object.assign(h, extra);
  }
  return h;
}

function recordReloadCapture(window, url, bodyBuf) {
  if (!window?.___vmDump || !url?.includes("/reload")) return;
  const tok = VmRuntimeCapture.extract05AL(bodyBuf);
  if (!tok) return;
  window.___vmDump.sends = window.___vmDump.sends ?? [];
  if (!window.___vmDump.sends.includes(tok)) window.___vmDump.sends.push(tok);
  window.___vmDump.last05AL = tok;
  window.___vmDump.lastReloadLen = bodyBuf?.length ?? 0;
}

async function googleRequest(url, { method = "GET", headers = {}, body }, jar, window = null) {
  let payload = body;
  if (payload != null && !(payload instanceof Buffer) && typeof payload !== "string") {
    if (payload instanceof ArrayBuffer) payload = Buffer.from(payload);
    else if (typeof payload?.arrayBuffer === "function") {
      payload = Buffer.from(await payload.arrayBuffer());
    }
  }
  if (typeof payload === "string") payload = Buffer.from(payload, "latin1");

  if (
    window &&
    method.toUpperCase() === "POST" &&
    url.includes("/reload") &&
    payload?.length
  ) {
    recordReloadCapture(window, url, payload);
  }

  const h = mergeHeaders(headers, {});
  try {
    if (method.toUpperCase() === "GET" || payload == null) {
      const text = await HttpClient.fetchText(url, h, jar);
      return { status: 200, body: Buffer.from(text, "utf8") };
    }
    const buf = await HttpClient.fetchBuffer(url, { method, headers: h, body: payload }, jar);
    return { status: 200, body: buf };
  } catch (err) {
    const m = String(err.message).match(/HTTP (\d{3})/);
    const status = m ? Number(m[1]) : 502;
    const slice = err.message.indexOf("\n");
    const text = slice >= 0 ? err.message.slice(slice + 1) : err.message;
    return { status, body: Buffer.from(text, "utf8") };
  }
}

function fireXhrDone(xhr, { status, body }, window) {
  const text = body.toString("utf8");
  try {
    Object.defineProperty(xhr, "status", { value: status, configurable: true });
    Object.defineProperty(xhr, "statusText", {
      value: status >= 200 && status < 300 ? "OK" : "Error",
      configurable: true,
    });
    Object.defineProperty(xhr, "responseText", { value: text, configurable: true });
    Object.defineProperty(xhr, "response", { value: text, configurable: true });
    Object.defineProperty(xhr, "readyState", { value: 4, configurable: true });
  } catch {
    xhr.status = status;
    xhr.statusText = status >= 200 && status < 300 ? "OK" : "Error";
    xhr.responseText = text;
    xhr.response = text;
    xhr.readyState = 4;
  }
  try {
    xhr.dispatchEvent?.(new window.Event("readystatechange"));
    xhr.dispatchEvent?.(new window.Event("load"));
    xhr.dispatchEvent?.(new window.Event("loadend"));
  } catch {
    /* ignore */
  }
  if (typeof xhr.onreadystatechange === "function") {
    try {
      xhr.onreadystatechange.call(xhr);
    } catch {
      /* ignore */
    }
  }
  if (typeof xhr.onload === "function") {
    try {
      xhr.onload.call(xhr);
    } catch {
      /* ignore */
    }
  }
  if (typeof xhr.onloadend === "function") {
    try {
      xhr.onloadend.call(xhr);
    } catch {
      /* ignore */
    }
  }
}

/** fetch + XHR Google via Node (JSDOM ne fait pas les POST /reload correctement). */
export function installGoogleNetwork(window, headers, jar) {
  if (window.__googleNetworkInstalled) return;
  window.__googleNetworkInstalled = true;

  const prevFetch = window.fetch?.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = String(input?.url ?? input ?? "");
    if (!googleRe.test(url)) {
      if (prevFetch) return prevFetch(input, init);
      throw new Error(`fetch blocked: ${url}`);
    }
    const method = (init.method ?? "GET").toUpperCase();
    if (process.env.RECAPTCHA_VM_DEBUG === "1" && method === "POST") {
      console.log("[google-fetch]", method, url.slice(0, 100));
    }
    const { status, body } = await googleRequest(
      url,
      {
        method,
        headers: mergeHeaders(headers, init.headers),
        body: init.body,
      },
      jar,
      window,
    );
    const text = body.toString("utf8");
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      clone: () => ({ text: async () => text }),
      text: async () => text,
      arrayBuffer: async () =>
        body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    };
  };

  const OrigXHR = window.XMLHttpRequest;
  if (!OrigXHR) return;

  function GoogleXHR() {
    const xhr = new OrigXHR();
    let _url = "";
    let _method = "GET";
    let _async = true;
    const reqHeaders = {};

    const origOpen = xhr.open.bind(xhr);
    const origSetHeader = xhr.setRequestHeader?.bind(xhr);
    const origSend = xhr.send.bind(xhr);

    xhr.open = function (method, url, async = true, ...rest) {
      _method = String(method).toUpperCase();
      _url = String(url);
      _async = async !== false;
      return origOpen(method, url, async, ...rest);
    };

    if (origSetHeader) {
      xhr.setRequestHeader = function (name, value) {
        reqHeaders[name] = value;
        return origSetHeader(name, value);
      };
    }

    xhr.send = function (body) {
      if (process.env.RECAPTCHA_VM_DEBUG === "1" && _method === "POST") {
        console.log("[google-xhr]", _method, _url.slice(0, 100), body?.length ?? 0);
      }
      if (!googleRe.test(_url)) {
        return origSend(body);
      }

      let buf = null;
      if (body != null) {
        buf =
          typeof body === "string"
            ? Buffer.from(body, "latin1")
            : body instanceof ArrayBuffer
              ? Buffer.from(body)
              : Buffer.isBuffer(body)
                ? body
                : null;
      }

      const run = async () => {
        try {
          for (let rs = 1; rs <= 3; rs++) {
            try {
              Object.defineProperty(xhr, "readyState", { value: rs, configurable: true });
            } catch {
              xhr.readyState = rs;
            }
            if (typeof xhr.onreadystatechange === "function") {
              try {
                xhr.onreadystatechange.call(xhr);
              } catch {
                /* ignore */
              }
            }
          }
          const { status, body: resBody } = await googleRequest(
            _url,
            {
              method: _method,
              headers: mergeHeaders(headers, reqHeaders),
              body: buf,
            },
            jar,
            window,
          );
          fireXhrDone(xhr, { status, body: resBody }, window);
        } catch (err) {
          try {
            Object.defineProperty(xhr, "status", { value: 0, configurable: true });
            Object.defineProperty(xhr, "readyState", { value: 4, configurable: true });
          } catch {
            xhr.status = 0;
            xhr.readyState = 4;
          }
          if (typeof xhr.onerror === "function") {
            try {
              xhr.onerror.call(xhr);
            } catch {
              /* ignore */
            }
          }
          if (process.env.RECAPTCHA_VM_DEBUG === "1") {
            console.error("[google-xhr]", _method, _url.slice(0, 80), err.message);
          }
        }
      };

      if (_async) {
        queueMicrotask(() => void run());
        return;
      }
      return origSend(body);
    };

    return xhr;
  }
  GoogleXHR.prototype = OrigXHR.prototype;
  window.XMLHttpRequest = GoogleXHR;
}
