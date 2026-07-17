#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

console.log(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "chrome-install-vm-capture.js"),
    "utf8",
  ),
);
