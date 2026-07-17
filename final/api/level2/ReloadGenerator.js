import { existsSync } from "node:fs";
import { ReloadStructure } from "./ReloadStructure.js";
import { TemplateProfile } from "./TemplateProfile.js";
import { F7Assembler } from "./F7Assembler.js";
import { TelemetryBuilder } from "./TelemetryBuilder.js";
import { EventCounterBuilder } from "./EventCounterBuilder.js";
import { VmHttpSolver } from "./VmHttpSolver.js";
import { InnerBlobPatcher } from "./InnerBlobPatcher.js";

/**
 * Niveau 2 — génère un body reload complet :
 * anchor live + suffix empreinte reconstruit (hash, télémétrie, compteurs).
 *
 * Limite connue : le token secondaire 05AL… et le blob chiffré restent liés
 * à la session du template tant qu'on n'exécute pas recaptcha__fr.js
 * (stratégie `browser` pour contourner).
 */
export class ReloadGenerator {
  static build({
    templatePath,
    version,
    anchorToken,
    siteKey,
    action = "login",
    encryptionKey = null,
    secondaryToken = null,
    encryptedBlob = null,
    userAgent = null,
    referer = null,
  }) {
    if (!templatePath || !existsSync(templatePath)) {
      throw new Error("reload template désactivé — pipeline dynamique automatique");
    }

    const profile = TemplateProfile.load(templatePath);
    const telemetry = TelemetryBuilder.build({ version });
    const events = EventCounterBuilder.build();

    let blob = encryptedBlob ?? profile.encryptedBlob;
    const templateKey = VmHttpSolver.loadTemplateSessionKey();
    if (encryptionKey && templateKey) {
      blob = VmHttpSolver.rebindEncryptedBlob(blob, {
        templateKey,
        liveKey: encryptionKey,
        ctx: {
          userAgent,
          referer,
          siteKey: siteKey ?? profile.siteKey,
          action,
          telemetry,
          events,
        },
      });
    } else if (encryptionKey && !templateKey) {
      blob = InnerBlobPatcher.patch(blob, {
        telemetry,
        events,
        siteKey: siteKey ?? profile.siteKey,
        action,
      });
    }

    const f7 = F7Assembler.build({
      secondaryToken: secondaryToken ?? profile.secondaryToken,
      action,
      siteKey: siteKey ?? profile.siteKey,
      encryptedBlob: blob,
      telemetry,
      events,
    });

    const f5Hash = ReloadStructure.hashFingerprintSerialized(f7.toString("latin1"));
    const suffix = ReloadStructure.buildSuffix({
      f5Hash: String(f5Hash),
      challengeType: profile.challengeType,
      f7,
    });

    return ReloadStructure.buildTopLevel({
      version,
      anchorToken,
      suffix,
    });
  }
}
