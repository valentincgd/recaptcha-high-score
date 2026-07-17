/** Template Chrome / capture stricte (RECAPTCHA_IDENTICAL=1 ou chemin template). */
export function shouldUseIdenticalReload(cfg) {
  return (
    process.env.RECAPTCHA_IDENTICAL === "1" ||
    !!(cfg.reloadTemplatePath && String(cfg.reloadTemplatePath).trim())
  );
}

/**
 * JSDOM anchor VM : enterprise (tous sites) par défaut.
 * RECAPTCHA_JSDOM_BROWSER=0 → JS pur ; =1 → force JSDOM même en api2.
 */
export function shouldUseJsdomReload(cfg) {
  if (process.env.RECAPTCHA_JSDOM_BROWSER === "0") return false;
  if (process.env.RECAPTCHA_JSDOM_BROWSER === "1") return true;
  return cfg.mode === "enterprise";
}

export function describeReloadPipeline(cfg) {
  if (shouldUseIdenticalReload(cfg)) {
    return "identique (template / RECAPTCHA_IDENTICAL)";
  }
  if (shouldUseJsdomReload(cfg)) {
    return "JSDOM VM → repli JS pur si capture incomplète";
  }
  return "JS pur (profil frais + VM config)";
}
