'use strict';
/**
 * tools/chrome_reload.js — Rejoue le POST /reload (body construit par jsdom) dans un VRAI Chrome
 * headless, pour que le handshake TLS/H2 vu par Google soit celui de Chrome (JA3/JA4/H2 authentiques)
 * au lieu de node-tls-client (détecté côté serveur). Le TLS de Chrome headless == headful.
 *
 * ⚠️ RECHERCHE / ÉDUCATIF.
 *
 * reloadViaChrome({ url, body:Buffer, headers, sitekey, hl, version, proxy, userAgent, chromePath })
 *   → { status, text, token }
 *
 * Idée : naviguer Chrome sur l'anchor google.com (même origine + bon Referer), puis fetch() le /reload
 * avec le body binaire → la requête scorée par Google part du vrai réseau Chrome.
 */
let puppeteer;
try { puppeteer = require('puppeteer-extra'); const S = require('puppeteer-extra-plugin-stealth'); puppeteer.use(S()); }
catch (_) { puppeteer = require('puppeteer'); }

function parseProxy(raw) {
  if (!raw) return null;
  let m = raw.match(/^(https?:\/\/)?(?:([^:@]+):([^@]+)@)?([^:\/]+):(\d+)/);
  if (!m) { const p = raw.split(':'); if (p.length >= 2) return { host: p[0], port: p[1], user: p[2], pass: p[3] }; return null; }
  return { host: m[4], port: m[5], user: m[2], pass: m[3] };
}

// Token = plus longue chaîne base64url plausible dans la réponse /reload.
function extractToken(text) {
  if (!text) return null;
  const matches = String(text).match(/[A-Za-z0-9_-]{120,}/g);
  if (!matches) return null;
  return matches.sort((a, b) => b.length - a.length)[0];
}

let _browser = null;
async function getBrowser({ proxy, chromePath }) {
  if (_browser && _browser.isConnected()) return _browser;
  const px = parseProxy(proxy);
  const args = [
    '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled', '--lang=fr-FR',
  ];
  if (px) args.push(`--proxy-server=${px.host}:${px.port}`);
  const opts = { headless: 'new', args, ignoreDefaultArgs: ['--enable-automation'] };
  if (chromePath || process.env.CHROME_PATH) opts.executablePath = chromePath || process.env.CHROME_PATH;
  else opts.channel = 'chrome';
  _browser = await puppeteer.launch(opts);
  _browser.__proxyAuth = px && px.user ? { username: px.user, password: px.pass } : null;
  return _browser;
}

async function reloadViaChrome(o) {
  const { url, body, headers = {}, sitekey, hl = 'fr', version, proxy, userAgent, chromePath, log = () => {} } = o;
  const seg = url.includes('/enterprise/') ? 'enterprise' : 'api2';
  const anchorUrl = `https://www.google.com/recaptcha/${seg}/anchor?ar=1&k=${sitekey}&co=aHR0cHM6Ly93d3cudGlja2V0bWFzdGVyLmNvbTo0NDM.&hl=${hl}&size=invisible&cb=rc${Date.now().toString(36)}` +
    (version ? `&v=${version}` : '');
  const browser = await getBrowser({ proxy, chromePath });
  const page = await browser.newPage();
  try {
    if (browser.__proxyAuth) await page.authenticate(browser.__proxyAuth);
    if (userAgent) await page.setUserAgent(userAgent);
    await page.setExtraHTTPHeaders({ 'Accept-Language': `${hl}-${hl.toUpperCase()},${hl};q=0.9,en;q=0.8` });
    // Naviguer sur l'anchor (même origine google.com → Referer correct, cookies google naturels)
    await page.goto(anchorUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(e => log('chrome-nav', e.message));

    const bodyB64 = Buffer.from(body).toString('base64');
    // headers utiles à rejouer (Content-Type surtout ; Chrome gère UA/Referer/Sec-* lui-même)
    const fwd = {};
    for (const [k, v] of Object.entries(headers)) {
      if (/^(content-type|x-browser-|x-goog-)/i.test(k)) fwd[k] = v;
    }
    if (!Object.keys(fwd).some(k => /content-type/i.test(k))) fwd['Content-Type'] = 'application/x-protobuffer';

    const result = await page.evaluate(async (u, b64, hdrs) => {
      const bin = atob(b64); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      try {
        const res = await fetch(u, { method: 'POST', headers: hdrs, body: arr, credentials: 'include', mode: 'cors' });
        const txt = await res.text();
        return { status: res.status, text: txt };
      } catch (e) { return { status: 0, text: '', err: String(e) }; }
    }, url, bodyB64, fwd);

    result.token = extractToken(result.text);
    log('chrome-reload', `HTTP ${result.status} (${(result.text || '').length}B) token=${result.token ? 'OK(' + result.token.length + ')' : 'NULL'}${result.err ? ' err=' + result.err : ''}`);
    return result;
  } finally {
    await page.close().catch(() => {});
  }
}

async function closeBrowser() { if (_browser) { await _browser.close().catch(() => {}); _browser = null; } }

module.exports = { reloadViaChrome, closeBrowser, extractToken, parseProxy };
