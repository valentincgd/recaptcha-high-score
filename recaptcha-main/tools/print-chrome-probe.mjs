#!/usr/bin/env node
/** Affiche le script console à copier dans Chrome. */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const path = join(dirname(fileURLToPath(import.meta.url)), "chrome-probe-all-iframes.js");
console.log(readFileSync(path, "utf8"));
