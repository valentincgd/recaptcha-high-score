/** reCAPTCHA attend des chaînes JSON sur MessageChannel / postMessage, pas des objets. */
export function serializePostMessageData(msg) {
  if (typeof msg === "string") return msg;
  if (msg == null) return "null";
  try {
    return JSON.stringify(msg);
  } catch {
    return "{}";
  }
}
