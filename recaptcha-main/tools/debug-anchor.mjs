import { readFileSync } from "node:fs";
import { AnchorParser } from "../api/AnchorParser.js";

const html = readFileSync(process.argv[2] || "captures/anchor.html", "utf8");
const init = AnchorParser.parse(html).initPayload;
if (!init) {
  console.log("no init");
  process.exit(1);
}
console.log(
  "init len",
  init.length,
  init.map((x) => (Array.isArray(x) ? `arr[${x[0]}]` : typeof x)),
);
const conf = init.find((x) => Array.isArray(x) && x[0] === "conf");
console.log("conf", !!conf, "len", conf?.length);
if (conf) {
  console.log(
    "big nums",
    conf.filter((v) => typeof v === "number" && v > 1e12),
  );
  console.log("conf[7]", conf[7]);
}
console.log("tail", init.slice(-8));
