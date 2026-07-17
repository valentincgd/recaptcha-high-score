import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ProtobufWire } from "./ProtobufWire.js";
import { HashUtil } from "./HashUtil.js";
import { ReloadGenerator } from "./level2/ReloadGenerator.js";

const ANCHOR_PREFIX_RE = /^03AFcWeA[A-Za-z0-9_-]+/;
const SITE_KEY_RE = /6L[A-Za-z0-9_-]{38}/;
const ACTION_TAG = Buffer.from([0x42, 0x05, 0x6c, 0x6f, 0x67, 0x69, 0x6e]); // field 8 "login"

export class ReloadBuilder {
  /** siteKey + action encodés dans un reload.bin capturé (pour aligner le body API). */
  static getEmbeddedCredentials(templatePath) {
    try {
      const fields = ProtobufWire.decodeMessage(readFileSync(templatePath));
      const f14 = fields.find((f) => f.fieldNumber === 14 && f.wireType === 2);
      const f8 = fields.find((f) => f.fieldNumber === 8 && f.wireType === 2);
      if (f14 || f8) {
        return {
          siteKey: f14?.value?.toString("utf8") ?? null,
          action: f8?.value?.toString("utf8") ?? null,
        };
      }
    } catch {
      /* fallback regex */
    }
    const buf = readFileSync(templatePath);
    const siteKey = buf.toString("latin1").match(SITE_KEY_RE)?.[0] ?? null;
    let action = null;
    if (buf.indexOf(ACTION_TAG) >= 0) action = "login";
    else if (buf.includes(Buffer.from("LoginPage", "utf8"))) action = "LoginPage";
    return { siteKey, action };
  }

  static templatePathForSiteKey(siteKey, mode = "enterprise") {
    const slug = siteKey?.slice(0, 8) ?? "unknown";
    const suffix = mode === "api2" ? "-api2" : "";
    return join(process.cwd(), "captures", `reload-${slug}${suffix}.bin`);
  }

  /** Mode de capture du template (reload.curl / reload.url à côté du .bin). */
  static getTemplateCaptureMode(templatePath) {
    const dir = join(templatePath, "..");
    const base = templatePath.replace(/\.bin$/i, "");
    for (const name of ["reload.curl", "reload.url", `${base}.curl`]) {
      const p = join(dir, name);
      if (!existsSync(p)) continue;
      try {
        const text = readFileSync(p, "utf8");
        if (text.includes("/recaptcha/api2/")) return "api2";
        if (text.includes("/recaptcha/enterprise/")) return "enterprise";
      } catch {
        /* ignore */
      }
    }
    return null;
  }

  /** Désactivé — flux API 100 % dynamique (pas de reload.bin). */
  static resolveTemplateForRequest(_opts) {
    return { path: null, patch: false, embedded: null };
  }

  static validateTemplateMatch(opts) {
    const templatePath = opts.reloadTemplate || opts.reloadTemplatePath;
    if (!templatePath) return { ok: true, opts };
    try {
      const embedded = ReloadBuilder.getEmbeddedCredentials(templatePath);
      if (!embedded.siteKey) return { ok: true, opts };

      const requested = { siteKey: opts.siteKey, action: opts.action };
      const siteKeyOk = !opts.siteKey || embedded.siteKey === opts.siteKey;
      const actionOk = !opts.action || embedded.action === opts.action;
      if (siteKeyOk && actionOk) return { ok: true, opts, embedded, requested };

      return {
        ok: false,
        opts,
        embedded,
        requested,
        mismatch: {
          siteKey: !siteKeyOk,
          action: !actionOk,
        },
      };
    } catch {
      return { ok: true, opts };
    }
  }

  /** Par défaut : refuse si reload.bin ≠ siteKey/action demandés (évite token Google OK mais TM invalide). */
  static alignOptionsWithTemplate(opts) {
    const check = ReloadBuilder.validateTemplateMatch(opts);
    if (check.ok) return check.opts;

    const align =
      opts.alignWithTemplate === true || opts.alignWithTemplate === "true";
    const block =
      opts.blockTemplateMismatch === true ||
      opts.blockTemplateMismatch === "true";
    const canPatch =
      check.requested.siteKey &&
      check.embedded.siteKey &&
      check.requested.siteKey.length === check.embedded.siteKey.length;

    if (!align && !block && canPatch) {
      return {
        ...check.opts,
        requestedSiteKey: check.requested.siteKey,
        requestedAction: check.requested.action,
        credentialsPatched: true,
        templatePatchFrom: check.embedded,
      };
    }

    if (!align && block) {
      return {
        ...check.opts,
        requestedSiteKey: check.requested.siteKey,
        requestedAction: check.requested.action,
        templateMismatch: {
          embedded: check.embedded,
          requested: check.requested,
          mismatch: check.mismatch,
        },
      };
    }

    const aligned = { ...check.opts };
    aligned.requestedSiteKey = check.requested.siteKey;
    aligned.requestedAction = check.requested.action;
    if (check.embedded.siteKey) aligned.siteKey = check.embedded.siteKey;
    if (check.embedded.action) aligned.action = check.embedded.action;
    aligned.templateAligned = true;
    aligned.templateAlignFrom = check.requested;
    aligned.templateAlignTo = {
      siteKey: aligned.siteKey,
      action: aligned.action,
    };
    aligned.templateMismatchWarning =
      "Token émis pour les credentials du template — invalide sur TM si la page utilise une autre clé/action.";
    return aligned;
  }

  static #writeField(parts, f) {
    if (f.wireType === 0) parts.push(ProtobufWire.writeInt32(f.fieldNumber, f.value));
    else if (f.wireType === 2) parts.push(ProtobufWire.writeBytes(f.fieldNumber, f.value));
  }
  static extractAnchorFromTemplate(templatePath) {
    const field2 = ReloadBuilder.#field2Utf8(templatePath);
    const match = field2.match(ANCHOR_PREFIX_RE);
    return match?.[0] ?? null;
  }

  static templateAnchorLength(templatePath) {
    return ReloadBuilder.extractAnchorFromTemplate(templatePath)?.length ?? 0;
  }

  static #field2Utf8(templatePath) {
    const fields = ProtobufWire.decodeMessage(readFileSync(templatePath));
    const f2 = fields.find((f) => f.fieldNumber === 2 && f.wireType === 2);
    if (!f2) throw new Error("reload template: champ 2 introuvable");
    return f2.value.toString("utf8");
  }

  static readTemplateRaw(templatePath) {
    return readFileSync(templatePath);
  }

  static fromTemplate(
    templatePath,
    anchorToken,
    { allowLengthMismatch = false, spliceOnly = false, siteKey, action } = {},
  ) {
    const templateAnchor = ReloadBuilder.extractAnchorFromTemplate(templatePath);
    if (
      !spliceOnly &&
      templateAnchor &&
      anchorToken.length !== templateAnchor.length &&
      !allowLengthMismatch
    ) {
      throw new Error(
        `anchor live ${anchorToken.length} chars ≠ template ${templateAnchor.length} — recapture anchor+reload ou RECAPTCHA_IDENTICAL=1`,
      );
    }
    const fields = ProtobufWire.decodeMessage(readFileSync(templatePath));
    const parts = [];
    for (const f of fields) {
      if (f.fieldNumber === 2 && f.wireType === 2) {
        const merged = ReloadBuilder.#spliceAnchorInField2(
          f.value.toString("utf8"),
          anchorToken,
        );
        parts.push(ProtobufWire.writeBytes(2, Buffer.from(merged, "utf8")));
      } else if (f.fieldNumber === 8 && f.wireType === 2 && action) {
        parts.push(ProtobufWire.writeString(8, action));
      } else if (f.fieldNumber === 14 && f.wireType === 2 && siteKey) {
        if (f.value.toString("utf8").length !== siteKey.length) {
          throw new Error(
            `siteKey template ${f.value.length} octets ≠ demandé ${siteKey.length} — recapture reload.bin`,
          );
        }
        parts.push(ProtobufWire.writeString(14, siteKey));
      } else {
        ReloadBuilder.#writeField(parts, f);
      }
    }
    return Buffer.concat(parts);
  }

  static #spliceAnchorInField2(field2Utf8, anchorToken) {
    const match = field2Utf8.match(ANCHOR_PREFIX_RE);
    if (!match) {
      throw new Error(
        "reload template: token anchor (03AFcWeA…) introuvable dans le champ 2",
      );
    }
    const suffix = field2Utf8.slice(match[0].length);
    return `${anchorToken}${suffix}`;
  }

  static buildMinimal({ version, anchorToken, siteKey, action }) {
    const hash = HashUtil.hashString(String(anchorToken.length)) | 0;
    return Buffer.concat([
      ProtobufWire.writeString(1, version),
      ProtobufWire.writeString(2, anchorToken),
      ProtobufWire.writeInt32(5, hash),
      ProtobufWire.writeString(6, "q"),
      ProtobufWire.writeString(8, action),
      ProtobufWire.writeString(14, siteKey),
    ]);
  }

  static buildGenerated(opts) {
    return ReloadGenerator.build(opts);
  }
}
