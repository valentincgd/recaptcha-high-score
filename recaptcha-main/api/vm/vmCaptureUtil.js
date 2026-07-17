/** Enregistre 05AL / gros blobs base64 dans window.___vmDump (partagé polyfills + capture). */
export function ensureVmDump(window) {
  const dump = window.___vmDump ?? {
    sends: [],
    bytecodes: [],
    errors: [],
    logs: [],
  };
  window.___vmDump = dump;
  return dump;
}

export function recordVmCaptureText(window, text) {
  if (typeof text !== "string" || text.length < 300) return;
  const dump = ensureVmDump(window);

  const re05 = /05AL[A-Za-z0-9_-]{200,}/g;
  let m;
  while ((m = re05.exec(text)) !== null) {
    const tok = m[0].slice(0, 1276);
    if (!dump.sends.includes(tok)) dump.sends.push(tok);
    dump.last05AL = tok;
  }

  if (text.length >= 800 && /^[A-Za-z0-9+/_=.-]{400,}$/.test(text.slice(0, 500))) {
    if (!dump.bytecodes.includes(text)) {
      dump.bytecodes.push(text);
      if (dump.bytecodes.length > 8) dump.bytecodes.shift();
    }
  }
}
