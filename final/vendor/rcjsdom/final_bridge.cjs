'use strict';
/**
 * final_bridge.cjs — Pont entre `final/` (ESM) et le générateur RÉEL de champ 16 (jsdom).
 *
 * Exécute le VRAI recaptcha__fr.js dans jsdom (field16_jsdom.js → run()) : Google construit
 * lui-même deriveSignalCode + le cipher + le champ 16 (impossible à réimplémenter à la main,
 * cf. result.md §9/§10). Le /reload est accepté (HTTP 200) → vrai token v3 scoré.
 *
 * Entrées (env) : RC_SITEKEY RC_ACTION RC_ORIGIN [RC_PAGE_URL RC_PROXY RC_HL RC_MODE
 *                 RC_EXECUTE_TIMES RC_TIMEOUT].
 * Sortie (stdout) : une ligne  __FINAL_JSON__{...}__END__  avec token + client-hints cohérents.
 *
 * ⚠️ RECHERCHE / ÉDUCATIF.
 */
const { run } = require('./field16_jsdom');
const xbv = require('./tools/xbv');

(async () => {
  const opts = {
    siteKey: process.env.RC_SITEKEY || undefined,
    action: process.env.RC_ACTION || undefined,
    origin: process.env.RC_ORIGIN || undefined,
    pageUrl: process.env.RC_PAGE_URL || undefined,
    proxy: process.env.RC_PROXY || undefined,
    hl: process.env.RC_HL || undefined,
    mode: process.env.RC_MODE || undefined,
    executeTimes: Number(process.env.RC_EXECUTE_TIMES) || undefined,
    timeout: Number(process.env.RC_TIMEOUT) || undefined,
    quiet: true,
  };

  const r = await run(opts);
  const platform = (r.identity && r.identity.platform) || 'windows';
  const id = xbv.browserIdentity({ platform });
  const hl = opts.hl || 'fr';

  const out = {
    token: r.token || null,
    accepted: !!r.accepted,
    reloadStatus: r.reloadStatus,
    field16Len: r.field16 ? r.field16.length : 0,
    clientHints: {
      user_agent: id.userAgent,
      accept_lang: `${hl}-${hl.toUpperCase()},${hl};q=0.9,en-US;q=0.8,en;q=0.7`,
      sec_ch_ua: id.secChUa,
      sec_ch_ua_mobile: id.secChUaMobile,
      sec_ch_ua_platform: id.secChUaPlatform,
    },
  };

  process.stdout.write('\n__FINAL_JSON__' + JSON.stringify(out) + '__END__\n');
  // jsdom laisse des handles ouverts → sortie explicite.
  process.exit(r.token ? 0 : 2);
})().catch((e) => {
  process.stderr.write('BRIDGE_FATAL ' + (e && e.message ? e.message : String(e)) + '\n');
  process.exit(1);
});
