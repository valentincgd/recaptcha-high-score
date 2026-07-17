import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));

/** Champ 22 capturé depuis Chrome (Charles) — hardcode acceptable pour TM Event. */
export function loadCapturedBDA() {
  const inline = process.env.RECAPTCHA_BDA_FIELD22?.trim();
  if (inline && inline.length > 200 && inline.startsWith("BDA")) {
    return inline;
  }
  const candidates = [
    process.env.RECAPTCHA_BDA_CAPTURE_PATH,
    join(__dir, "..", "..", "..", "tmpt_public", "captures", "chrome-bda-field22.txt"),
    join(__dir, "..", "..", "captures", "chrome-bda-field22.txt"),
    join(process.cwd(), "captures", "chrome-bda-field22.txt"),
  ].filter(Boolean);
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    const s = readFileSync(p, "utf8").trim();
    if (s.length > 200 && s.startsWith("BDA")) return s;
  }
  return null;
}
