import https from "node:https";
import http from "node:http";
import { CookieJar } from "./CookieJar.js";

function tlsInsecureEnabled() {
  return (
    process.env.RECAPTCHA_TLS_INSECURE === "1" ||
    process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0"
  );
}

function withCookies(headers, jar) {
  const h = { ...headers };
  const cookie = jar?.header();
  if (cookie) h.cookie = cookie;
  return h;
}

function formatFetchError(err, url) {
  const cause = err?.cause;
  const code = cause?.code ?? cause?.message;
  if (
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
    code === "SELF_SIGNED_CERT_IN_CHAIN" ||
    code === "CERT_HAS_EXPIRED"
  ) {
    return new Error(
      `TLS: impossible de vérifier le certificat Google (${code}). ` +
        `Souvent un proxy/antivirus (inspection HTTPS). ` +
        `Solutions: NODE_EXTRA_CA_CERTS=chemin/vers/ca.pem ou RECAPTCHA_TLS_INSECURE=1 (dev uniquement). URL: ${url}`,
    );
  }
  const detail = cause ? `${cause.code ?? ""}: ${cause.message ?? cause}`.trim() : "";
  return new Error(
    detail ? `${err.message} (${detail}) — ${url}` : `${err.message} — ${url}`,
  );
}

function nodeRequest(url, { method = "GET", headers = {}, body }, jar) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        method,
        headers: withCookies(headers, jar),
        rejectUnauthorized: !tlsInsecureEnabled(),
      },
      (res) => {
        jar?.storeFromNodeHeaders(res.headers);
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            text: async () => buf.toString("utf8"),
            arrayBuffer: async () =>
              buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
          });
        });
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function httpFetch(url, init = {}, jar) {
  if (tlsInsecureEnabled()) {
    return nodeRequest(
      url,
      {
        method: init.method ?? "GET",
        headers: init.headers ?? {},
        body: init.body,
      },
      jar,
    );
  }

  try {
    const res = await fetch(url, init);
    jar?.storeFromResponse(res);
    return res;
  } catch (err) {
    throw formatFetchError(err, url);
  }
}

export class HttpClient {
  static async fetchText(url, headers, jar) {
    const res = await httpFetch(url, { headers: withCookies(headers, jar) }, jar);
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${url}\n${text.slice(0, 300)}`);
    }
    return text;
  }

  static async fetchBuffer(url, init, jar) {
    const res = await httpFetch(
      url,
      {
        ...init,
        headers: withCookies(init?.headers ?? {}, jar),
      },
      jar,
    );
    const buf = Buffer.from(await res.arrayBuffer());
    if (!res.ok) {
      throw new Error(
        `HTTP ${res.status} ${url}\n${buf.toString("utf8").slice(0, 300)}`,
      );
    }
    return buf;
  }
}
