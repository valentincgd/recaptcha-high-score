/** Proxy HTTP(S) pour une requête solve (réinitialisé après chaque appel). */
let activeProxyUrl = null;

export function setRequestProxy(proxy) {
  const p = String(proxy ?? "").trim();
  activeProxyUrl = p || null;
}

export function getRequestProxy() {
  return activeProxyUrl;
}

export function clearRequestProxy() {
  activeProxyUrl = null;
}
