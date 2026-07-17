import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RecaptchaVmHost } from "./RecaptchaVmHost.js";
import { VmAnalyzer } from "./VmAnalyzer.js";

export class VmDumper {
  static async dumpAndAnalyze({
    siteKey = "6LdoaXQrAAAAADQviABd-eByJu6kPL8awKDyc1zb",
    action = "login",
    outputDir = join(process.cwd(), "dumps"),
    ...hostOpts
  } = {}) {
    const http = await RecaptchaVmHost.bootstrapHttp({ siteKey, ...hostOpts });
    const dump = await RecaptchaVmHost.runInJsdom({
      bootstrap: http.bootstrap,
      anchor: http.anchor,
      anchorHtml: http.anchorHtml,
      headers: http.headers,
      siteKey,
      action,
      origin: hostOpts.origin ?? http.cfg.origin,
      referer: hostOpts.referer ?? http.cfg.referer,
      userAgent: hostOpts.userAgent ?? http.cfg.userAgent,
    });

    dump.meta = {
      siteKey,
      action,
      version: http.bootstrap.version,
      scriptUrl: http.bootstrap.scriptUrl,
      dumpedAt: new Date().toISOString(),
    };

    const report = VmAnalyzer.analyze(dump);
    dump.report = report;

    mkdirSync(outputDir, { recursive: true });
    const stamp = Date.now();
    const base = join(outputDir, `vm-${stamp}`);
    writeFileSync(`${base}.json`, JSON.stringify(dump, null, 2), "utf8");
    writeFileSync(`${base}-report.json`, JSON.stringify(report, null, 2), "utf8");

    if (dump.bytecode?.instructions?.length) {
      const lines = dump.bytecode.instructions
        .slice(0, 500)
        .map(
          (i) =>
            `0x${(i.offset ?? 0).toString(16).padStart(4, "0")}: ${i.op} ${JSON.stringify(i).slice(0, 120)}`,
        );
      writeFileSync(`${base}-disasm.txt`, lines.join("\n"), "utf8");
    }

    return { dump, report, paths: { json: `${base}.json`, report: `${base}-report.json` } };
  }
}
