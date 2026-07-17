import { existsSync } from "node:fs";
import { join } from "node:path";
import { JsdomBrowserReload } from "./JsdomBrowserReload.js";
import { ReloadBuilder } from "../ReloadBuilder.js";
import { ProtobufWire } from "../ProtobufWire.js";
import { FingerprintBlobBuilder } from "../vm/FingerprintBlobBuilder.js";
import { VmHttpSolver } from "../level2/VmHttpSolver.js";
import { Collectors } from "../vm/Collectors.js";
import { PureBrowserEnvironment } from "../vm/PureBrowserEnvironment.js";
import { F7Assembler } from "../level2/F7Assembler.js";
import { VmRuntimeCapture } from "../vm/VmRuntimeCapture.js";

/**
 * Reload byte-identique au navigateur :
 * 1) POST /reload capturé par la VM (JSDOM parent + Main.execute)
 * 2) OU reload.bin Chrome + rebind clé session (champs 7/16)
 * Pas de VmPureReloadBuilder / 05AL synthétique.
 */
export class IdenticalReload {
  static MIN_BYTES = Number(process.env.RECAPTCHA_JSDOM_MIN_RELOAD_BYTES) || 8000;

  static async buildAsync(opts) {
    const { cfg, bootstrap, anchor, onLog } = opts;
    const log = (sub, d = "") => onLog?.(sub, d);

    const templatePath = IdenticalReload.#resolveTemplatePath(cfg);
    if (templatePath) {
      log("Identique", `template ${templatePath}`);
      return IdenticalReload.#fromChromeTemplate({
        templatePath,
        cfg,
        bootstrap,
        anchor,
        onLog,
      });
    }

    log("Identique", "capture VM navigateur (parent iframe TM)");
    const prevJsd = process.env.RECAPTCHA_JSDOM_BROWSER;
    const prevParent = process.env.RECAPTCHA_ANCHOR_VM_PARENT;
    const prevGexec = process.env.RECAPTCHA_PARENT_GEXECUTE;
    process.env.RECAPTCHA_JSDOM_BROWSER = "1";
    if (prevParent === undefined) process.env.RECAPTCHA_ANCHOR_VM_PARENT = "1";
    if (prevGexec === undefined) process.env.RECAPTCHA_PARENT_GEXECUTE = "1";
    process.env.RECAPTCHA_ALLOW_FLAT_FALLBACK = "0";

    try {
      const vm = await JsdomBrowserReload.buildAsync(opts);
      if (vm.body?.length >= IdenticalReload.MIN_BYTES) {
        log("Identique OK", `${vm.body.length} octets capturés (réseau VM)`);
        return {
          ...vm,
          strategy: "identical-vm",
          secondarySource: vm.secondarySource ?? "network-capture",
        };
      }
      throw new Error(
        IdenticalReload.#failMessage(vm.body?.length ?? 0, vm.secondarySource),
      );
    } finally {
      if (prevJsd === undefined) delete process.env.RECAPTCHA_JSDOM_BROWSER;
      else process.env.RECAPTCHA_JSDOM_BROWSER = prevJsd;
      if (prevParent === undefined) delete process.env.RECAPTCHA_ANCHOR_VM_PARENT;
      else process.env.RECAPTCHA_ANCHOR_VM_PARENT = prevParent;
      if (prevGexec === undefined) delete process.env.RECAPTCHA_PARENT_GEXECUTE;
      else process.env.RECAPTCHA_PARENT_GEXECUTE = prevGexec;
    }
  }

  static #failMessage(partialLen, source) {
    return (
      `Reload non identique au navigateur — capture VM ${partialLen} octets (min ${IdenticalReload.MIN_BYTES}), source=${source ?? "?"}. ` +
      "Le rebuild JS pur (LCG + collecteurs) n'est PAS byte-à-byte le POST Chrome. Solutions : " +
      "(1) capturer reload.bin dans DevTools → RECAPTCHA_RELOAD_TEMPLATE=captures/reload.bin ; " +
      "(2) corriger la VM (npm run test:vm, RECAPTCHA_VM_DEBUG=1) jusqu'à POST ≥8ko."
    );
  }

  static #resolveTemplatePath(cfg) {
    const p =
      cfg.reloadTemplatePath ??
      cfg.reloadTemplate ??
      process.env.RECAPTCHA_RELOAD_TEMPLATE;
    if (p && existsSync(p)) return p;
    const auto = ReloadBuilder.templatePathForSiteKey(
      cfg.siteKey,
      cfg.mode === "api2" ? "api2" : "enterprise",
    );
    return existsSync(auto) ? auto : null;
  }

  static #fromChromeTemplate({ templatePath, cfg, bootstrap, anchor, onLog }) {
    const log = (sub, d = "") => onLog?.(sub, d);
    const templateKey = VmHttpSolver.loadTemplateSessionKey();
    const liveKey = Number(anchor.encryptionKey) | 0;

    let body = ReloadBuilder.fromTemplate(templatePath, anchor.anchorToken, {
      siteKey: cfg.siteKey,
      action: cfg.action,
      allowLengthMismatch: process.env.RECAPTCHA_TEMPLATE_ALLOW_LEN === "1",
    });

    const env = new PureBrowserEnvironment({
      origin: cfg.origin,
      referer: cfg.referer,
      userAgent: cfg.userAgent,
    });
    const signals = Collectors.runAll(env, {
      siteKey: cfg.siteKey,
      action: cfg.action,
      origin: cfg.origin,
      referer: cfg.referer,
      userAgent: cfg.userAgent,
    });
    env.close?.();

    const fields = ProtobufWire.decodeMessage(body);
    const f16 = fields.find((f) => f.fieldNumber === 16 && f.wireType === 2);
    const f7 = fields.find((f) => f.fieldNumber === 7 && f.wireType === 2);

    if (f16 && templateKey && liveKey && templateKey !== liveKey) {
      const reblob = FingerprintBlobBuilder.rebuild(f16.value, {
        encryptionKey: liveKey,
        signals,
        ctx: {
          siteKey: cfg.siteKey,
          action: cfg.action,
          referer: cfg.referer,
          userAgent: cfg.userAgent,
        },
      });
      body = IdenticalReload.#replaceField(body, 16, reblob);
      log("Rebind champ 16", `templateKey→liveKey | ${reblob.length} octets`);
    }

    if (f7 && templateKey && liveKey && templateKey !== liveKey) {
      const f7str = f7.value.toString("latin1");
      const m05 = f7str.match(/05AL[A-Za-z0-9_-]{200,1276}/);
      const secondary =
        m05?.[0] ??
        VmRuntimeCapture.extract05AL(f7str) ??
        f7str.slice(0, 1276);
      const innerMatch = f7str.slice(secondary.length);
      let innerBlob = Buffer.from(innerMatch, "latin1");
      const innerFields = ProtobufWire.decodeMessage(innerBlob);
      const f2088 = innerFields.find((x) => x.fieldNumber === 2088 && x.wireType === 2);
      if (f2088) {
        const reb = FingerprintBlobBuilder.rebuild(f2088.value, {
          encryptionKey: liveKey,
          signals,
          ctx: { siteKey: cfg.siteKey, action: cfg.action },
        });
        innerBlob = IdenticalReload.#replaceField(innerBlob, 2088, reb);
      }
      const f7new = F7Assembler.build({
        secondaryToken: secondary,
        action: cfg.action,
        siteKey: cfg.siteKey,
        encryptedBlob: innerBlob,
      });
      body = IdenticalReload.#replaceField(body, 7, f7new);
      log("Rebind champ 7", `05AL conservé | f7 ${f7new.length} o`);
    }

    log("Template replay", `${body.length} octets (structure Chrome)`);
    return {
      body,
      reloadBytes: body.length,
      strategy: "identical-template",
      secondarySource: "chrome-reload.bin",
      templatePath,
    };
  }

  static #replaceField(body, fieldNumber, newValue) {
    const buf = Buffer.isBuffer(newValue) ? newValue : Buffer.from(newValue);
    const fields = ProtobufWire.decodeMessage(body);
    const parts = [];
    for (const f of fields) {
      if (f.fieldNumber === fieldNumber && f.wireType === 2) {
        parts.push(ProtobufWire.writeBytes(fieldNumber, buf));
      } else if (f.wireType === 0) {
        parts.push(ProtobufWire.writeInt32(f.fieldNumber, f.value));
      } else if (f.wireType === 2) {
        parts.push(ProtobufWire.writeBytes(f.fieldNumber, f.value));
      }
    }
    return Buffer.concat(parts);
  }
}
