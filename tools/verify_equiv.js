'use strict';
/** Charge un script recaptcha dans jsdom+shims et rapporte les globals grecaptcha définis + erreurs.
 *  Sert à prouver l'équivalence comportementale entre recaptcha_pretty.js et recaptcha_readable.js. */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const { installShims } = require('./shims');

async function probe(file) {
  const src = fs.readFileSync(file, 'utf8');
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String(e.message || e).slice(0, 100)));
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'https://www.google.com/recaptcha/api2/anchor?k=6LcR_okUAAAAAPYrPe-HK_0RULO1aZM15ENyM-Mf',
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
  });
  const window = dom.window;
  try { installShims(window, { origin: 'https://www.google.com', logger: () => {} }); } catch (_) {}
  let thrown = null;
  try {
    const s = window.document.createElement('script');
    s.textContent = src;
    window.document.head.appendChild(s);
  } catch (e) { thrown = e.message; }
  await new Promise(r => setTimeout(r, 1500));
  const cfg = window.___grecaptcha_cfg;
  const out = {
    file: require('path').basename(file),
    grecaptcha: typeof window.grecaptcha,
    ___grecaptcha_cfg: typeof cfg,
    cfgClients: cfg && cfg.clients ? Object.keys(cfg.clients).length : 0,
    cfgFns: cfg && cfg.fns ? cfg.fns.length : 0,
    globalKeys: Object.keys(window).filter(k => /recaptcha|grecaptcha|botguard|___/i.test(k)).slice(0, 12),
    setupErrors: errors.slice(0, 5),
    thrown,
  };
  try { window.close(); } catch (_) {}
  return out;
}

(async () => {
  for (const f of process.argv.slice(2)) {
    const r = await probe(f);
    console.log(JSON.stringify(r, null, 2));
  }
})();
