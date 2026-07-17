import { TemplateProfile } from "../api/level2/TemplateProfile.js";
import { writeFileSync } from "node:fs";

const templatePath = process.argv[2];
if (!templatePath) {
  console.error("Usage: node tools/extract-tm-profile.mjs <fichier.bin>");
  process.exit(1);
}
const outPath = process.argv[3] || "fingerprint/tm-profile.json";

const profile = TemplateProfile.load(templatePath);
const json = {
  templatePath,
  anchorLength: profile.anchorLength,
  anchorPrefix: profile.anchorPrefix,
  secondaryTokenLength: profile.secondaryTokenLength,
  secondaryTokenPreview: `${profile.secondaryToken.slice(0, 48)}…`,
  challengeType: profile.challengeType,
  f5HashSample: profile.f5HashSample,
  action: profile.action,
  siteKey: profile.siteKey,
  encryptedBlobBytes: profile.encryptedBlob.length,
  segments: profile.segments,
};

writeFileSync(outPath, JSON.stringify(json, null, 2));
console.log("profil TM écrit →", outPath);
console.log(JSON.stringify(json, null, 2));
