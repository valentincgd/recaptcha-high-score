import https from "node:https";
import http from "node:http";
import tls from "node:tls";
import { CookieJar } from "./CookieJar.js";

function tlsInsecureEnabled() {
  return (
    process.env.RECAPTCHA_TLS_INSECURE === "1" ||
    process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0"
  );
}

/**
 * Agent HTTPS via un proxy HTTP (tunnel CONNECT). Zéro dépendance (node:http + node:tls).
 * Supporte l'auth basic dans l'URL : http://user:pass@host:port
 */
class HttpsProxyAgent extends https.Agent {
  constructor(proxyUrl, options = {}) {
    super({ keepAlive: false, ...options });
    this.proxy = new URL(proxyUrl);
  }
  createConnection(opts, cb) {
    const headers = {};
    if (this.proxy.username) {
      const auth = `${decodeURIComponent(this.proxy.username)}:${decodeURIComponent(this.proxy.password)}`;
      headers["Proxy-Authorization"] = "Basic " + Buffer.from(auth).toString("base64");
    }
    const port = opts.port || 443;
    const req = http.request({
      host: this.proxy.hostname,
      port: Number(this.proxy.port) || 80,
      method: "CONNECT",
      path: `${opts.host}:${port}`,
      headers,
      timeout: 30000,
    });
    req.once("connect", (res, socket) => {
      if (res.statusCode !== 200) {
        cb(new Error(`proxy CONNECT a répondu ${res.statusCode}`));
        socket.destroy();
        return;
      }
      const tlsSocket = tls.connect(
        { socket, servername: opts.host, rejectUnauthorized: !tlsInsecureEnabled() },
        () => cb(null, tlsSocket),
      );
      tlsSocket.once("error", cb);
    });
    req.once("error", cb);
    req.end();
  }
}

const _agentCache = new Map();
function proxyAgent(proxyUrl) {
  if (!proxyUrl) return null;
  if (!_agentCache.has(proxyUrl)) _agentCache.set(proxyUrl, new HttpsProxyAgent(proxyUrl));
  return _agentCache.get(proxyUrl);
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

function nodeRequest(url, { method = "GET", headers = {}, body, proxy }, jar) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const agent = u.protocol === "https:" ? proxyAgent(proxy) : null;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        method,
        headers: withCookies(headers, jar),
        rejectUnauthorized: !tlsInsecureEnabled(),
        ...(agent ? { agent } : {}),
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
  // Un proxy (ou le mode TLS insecure) force la voie node:https (fetch global ne gère pas
  // proprement un agent proxy par requête).
  if (tlsInsecureEnabled() || init.proxy) {
    return nodeRequest(
      url,
      {
        method: init.method ?? "GET",
        headers: init.headers ?? {},
        body: init.body,
        proxy: init.proxy,
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
  static async fetchText(url, headers, jar, proxy = null) {
    const res = await httpFetch(url, { headers: withCookies(headers, jar), proxy }, jar);
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${url}\n${text.slice(0, 300)}`);
    }
    return text;
  }

  static async fetchBuffer(url, init, jar, proxy = null) {
    const res = await httpFetch(
      url,
      {
        ...init,
        headers: withCookies(init?.headers ?? {}, jar),
        proxy: proxy ?? init?.proxy ?? null,
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

  /** Comme fetchBuffer mais NE throw PAS sur non-2xx : renvoie { status, ok, text }. Pour /json/sign-in
   *  (200 succès, 200+body-400, 403 bloqué) où on veut le corps quel que soit le status. jar+proxy gérés. */
  static async fetchRaw(url, init, jar, proxy = null) {
    const res = await httpFetch(
      url,
      { ...init, headers: withCookies(init?.headers ?? {}, jar), proxy: proxy ?? init?.proxy ?? null },
      jar,
    );
    return { status: res.status, ok: res.ok, text: await res.text() };
  }
}
