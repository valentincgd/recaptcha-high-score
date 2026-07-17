/**
 * Force le répertoire de travail sur final/ (captures, recaptcha-vm-main, cache).
 */
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const FINAL_ROOT = dirname(fileURLToPath(import.meta.url));
process.chdir(FINAL_ROOT);

export { FINAL_ROOT };
