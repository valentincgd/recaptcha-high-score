import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const CACHE_DIR = join(process.cwd(), "cache", "recaptcha-scripts");

export class VmScriptLoader {
  static async fetchRecaptchaBundle({ scriptUrl, headers = {}, maxAgeMs = 86_400_000 }) {
    mkdirSync(CACHE_DIR, { recursive: true });
    const key = createHash("sha256").update(scriptUrl).digest("hex").slice(0, 16);
    const cachePath = join(CACHE_DIR, `${key}.js`);

    if (existsSync(cachePath)) {
      const stat = (await import("node:fs")).statSync(cachePath);
      if (Date.now() - stat.mtimeMs < maxAgeMs) {
        return { source: readFileSync(cachePath, "utf8"), cachePath, fromCache: true };
      }
    }

    const res = await fetch(scriptUrl, {
      headers: {
        accept: "*/*",
        "user-agent": headers["user-agent"] ?? headers.userAgent ?? VmScriptLoader.defaultUa(),
        referer: headers.referer ?? "https://www.google.com/",
        ...headers,
      },
    });
    if (!res.ok) throw new Error(`GET recaptcha script ${res.status}`);
    const source = await res.text();
    writeFileSync(cachePath, source, "utf8");
    return { source, cachePath, fromCache: false };
  }

  static defaultUa() {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";
  }
}
