'use strict';
/**
 * proxy_forward.js — proxy local SANS auth qui relaie tout vers le proxy résidentiel (avec auth).
 *
 * But : test d'attribution. Chrome/Brave ne prend pas user:pass dans --proxy-server ; ce forwarder
 * injecte le Proxy-Authorization. Tu lances ton VRAI navigateur à travers l'IP résidentielle et tu
 * lis le score reCAPTCHA — ça dit si le 0.1 vient de l'IP (flaggée) ou du fingerprint jsdom.
 *
 * Usage :
 *   RC_PROXY=host:port:user:pass node tools/proxy_forward.js
 * puis (Windows) :
 *   "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe" ^
 *      --proxy-server=127.0.0.1:8888 --user-data-dir="%TEMP%\rc-test"
 * et visite https://antcpt.com/score_detector/ — compare le score.
 */
const net = require('net');
const http = require('http');
const { URL } = require('url');

function parseProxy(raw) {
  if (!raw) { console.error('✖ RC_PROXY manquant. Ex: RC_PROXY=host:port:user:pass node tools/proxy_forward.js'); process.exit(1); }
  raw = String(raw).trim();
  if (/^[a-z0-9]+:\/\//i.test(raw)) { const u = new URL(raw); return { host: u.hostname, port: +u.port, auth: u.username ? Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString('base64') : null }; }
  const p = raw.split(':');
  if (p.length === 4) return { host: p[0], port: +p[1], auth: Buffer.from(`${p[2]}:${p[3]}`).toString('base64') };
  if (p.length === 2) return { host: p[0], port: +p[1], auth: null };
  console.error('✖ format RC_PROXY invalide'); process.exit(1);
}

const UP = parseProxy(process.env.RC_PROXY);
const PORT = +process.env.RC_FWD_PORT || 8888;

function dialUpstream(targetHostPort, onReady, onFail) {
  const up = net.connect(UP.port, UP.host);
  let established = false, buf = Buffer.alloc(0);
  up.on('connect', () => {
    const auth = UP.auth ? `Proxy-Authorization: Basic ${UP.auth}\r\n` : '';
    up.write(`CONNECT ${targetHostPort} HTTP/1.1\r\nHost: ${targetHostPort}\r\n${auth}\r\n`);
  });
  up.on('data', d => {
    if (established) return;
    buf = Buffer.concat([buf, d]);
    const idx = buf.indexOf('\r\n\r\n');
    if (idx < 0) return;
    const header = buf.slice(0, idx).toString();
    if (/^HTTP\/1\.[01] 200/.test(header)) { established = true; onReady(up, buf.slice(idx + 4)); }
    else { onFail(header.split('\r\n')[0]); up.destroy(); }
  });
  up.on('error', e => { if (!established) onFail(e.message); });
  return up;
}

const server = http.createServer((req, res) => {
  // requêtes HTTP en clair : rare pour un test https, mais on relaie via CONNECT sur le host:80
  const u = (() => { try { return new URL(req.url); } catch (_) { return null; } })();
  if (!u) { res.writeHead(400); return res.end(); }
  const target = `${u.hostname}:${u.port || 80}`;
  const up = dialUpstream(target, (sock, rest) => {
    const path = u.pathname + u.search;
    let head = `${req.method} ${path} HTTP/1.1\r\n`;
    for (let i = 0; i < req.rawHeaders.length; i += 2) { if (!/^proxy-/i.test(req.rawHeaders[i])) head += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`; }
    head += '\r\n';
    sock.write(head);
    if (rest && rest.length) res.socket.write(rest);
    req.pipe(sock); sock.pipe(res.socket);
  }, (why) => { try { res.writeHead(502); res.end(why); } catch (_) {} });
});

// HTTPS : Chrome envoie CONNECT host:443 → on relaie le tunnel vers le proxy résidentiel
server.on('connect', (req, clientSocket, head) => {
  const up = dialUpstream(req.url, (sock, rest) => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\nProxy-agent: rc-forward\r\n\r\n');
    if (rest && rest.length) clientSocket.write(rest);
    if (head && head.length) sock.write(head);
    clientSocket.pipe(sock); sock.pipe(clientSocket);
  }, (why) => { try { clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n'); clientSocket.destroy(); } catch (_) {} });
  clientSocket.on('error', () => { try { up.destroy(); } catch (_) {} });
});

server.on('clientError', (e, sock) => { try { sock.destroy(); } catch (_) {} });
server.listen(PORT, '127.0.0.1', () => {
  console.log(`▶ Forwarder local prêt : 127.0.0.1:${PORT}  →  ${UP.host}:${UP.port} (auth ${UP.auth ? 'injectée' : 'aucune'})`);
  console.log('  Lance ton navigateur à travers ce proxy, ex. (Windows) :');
  console.log(`    "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe" --proxy-server=127.0.0.1:${PORT} --user-data-dir="%TEMP%\\rc-test"`);
  console.log('  Puis visite https://antcpt.com/score_detector/ et compare le score.  (Ctrl+C pour arrêter)');
});
