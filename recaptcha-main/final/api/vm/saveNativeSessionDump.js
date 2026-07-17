import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Sauvegarde chaque run natif/JSDOM (pas le vieux chrome-vm.json).
 * RECAPTCHA_AUTO_DUMP=0 pour désactiver.
 */
export function saveNativeSessionDump(payload, { autoDump } = {}) {
  if (autoDump === false || process.env.RECAPTCHA_AUTO_DUMP === "0") return null;

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(process.cwd(), "captures", "sessions");
  mkdirSync(dir, { recursive: true });

  const path = join(dir, `native-${ts}.json`);
  const doc = {
    savedAt: new Date().toISOString(),
    source: payload.source ?? "native-pure",
    ...payload,
  };
  writeFileSync(path, JSON.stringify(doc, null, 2), "utf8");

  const latest = join(process.cwd(), "captures", "vm-runtime-latest.json");
  writeFileSync(latest, JSON.stringify(doc, null, 2), "utf8");

  return path;
}
