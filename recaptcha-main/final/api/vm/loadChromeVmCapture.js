import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const CAPTURE_PATH = join(process.cwd(), "captures", "vm-runtime.json");

/**
 * Charge un dump Chrome importé manuellement.
 * Désactivé par défaut — activer seulement si vous voulez réutiliser un vieux 05AL :
 *   RECAPTCHA_CHROME_CAPTURE=1
 */
export function loadChromeVmCapture({ enabled } = {}) {
  const on =
    enabled === true ||
    (enabled !== false && process.env.RECAPTCHA_CHROME_CAPTURE === "1");
  if (!on) return null;
  const alt = process.env.RECAPTCHA_VM_RUNTIME_PATH;
  const path = alt ? join(process.cwd(), alt) : CAPTURE_PATH;
  if (!existsSync(path)) return null;
  try {
    const j = JSON.parse(readFileSync(path, "utf8"));
    if (!j?.last05AL && !(j?.sends?.length) && !(j?.bytecodes?.length)) return null;
    return { ...j, _path: path };
  } catch {
    return null;
  }
}
