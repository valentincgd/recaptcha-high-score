/**
 * Dérive origin / referer depuis l’URL de la page TM fournie par l’appelant.
 */
export function parsePageUrl(url) {
  const raw = String(url ?? "").trim();
  if (!raw) {
    throw new Error("url requis (page Ticketmaster où la clé est affichée)");
  }
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("url invalide — attendu https://…");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error("url doit être http(s)");
  }

  const origin = u.origin;
  const referer = raw.includes("://") ? raw : `${origin}${raw.startsWith("/") ? raw : `/${raw}`}`;

  return {
    origin,
    referer: referer.endsWith("/") ? referer : referer,
    hostname: u.hostname,
    pathname: u.pathname,
  };
}

export function isTicketmasterHostname(hostname) {
  return /(^|\.)ticketmaster\.(com|co\.uk|ca|com\.mx|de|fr|nl|be|ch|at|ie|es|it|pl|se|no|dk|fi|pt|com\.br)$/i.test(
    hostname,
  );
}
