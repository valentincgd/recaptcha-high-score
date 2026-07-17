/** Clé Enterprise Ticketmaster (variante alternate — tous domaines TM via origin URL). */
export const TM_ALT_SITE_KEY = "6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV";

export const FINAL_DEFAULTS = {
  siteKey: TM_ALT_SITE_KEY,
  enterprise: true,
  mode: "enterprise",
  action: "LoginPage",
  hl: "fr",
  size: "invisible",
};

export const FINAL_PORT = Number(process.env.FINAL_API_PORT || 3848);
