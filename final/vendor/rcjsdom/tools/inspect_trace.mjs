/**
 * inspect_trace.mjs — lance vm_capture2.js sous inspecteur node, s'attache via CDP, et au `debugger;`
 * (point d'envoi de la requête C/z) dump la chaîne de scopes + évalue V[35]/l[35]/le deferred pour
 * comprendre le vrai mécanisme d'envoi. Puis step-over pour voir où la coroutine stalle.
 */
import { spawn } from "child_process";
import { createRequire } from "module";
const require = createRequire("C:/Users/Valentin/AppData/Local/Temp/claude/C--Users-Valentin-Desktop-recaptcha-high-score/56d2f254-3735-4ce5-a15e-d9d6e34e728f/scratchpad/browser/x.js");
const CDP = require("chrome-remote-interface");

const PORT = 9231;
const child = spawn("node", [`--inspect-brk=${PORT}`, "vm_capture2.js"], { cwd: process.cwd(), env: { ...process.env, DBG: "1" }, stdio: ["ignore", "inherit", "pipe"] });
let wsReady = false;
child.stderr.on("data", (d) => { const s = d.toString(); if (!wsReady && /Debugger listening on ws/.test(s)) { wsReady = true; } if (!/Debugger listening|For help|Debugger attached|Waiting for the debugger/.test(s)) process.stderr.write(s); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(1200);

let client;
for (let i = 0; i < 20; i++) { try { client = await CDP({ port: PORT }); break; } catch (_) { await sleep(300); } }
if (!client) { console.error("CDP connect failed"); process.exit(1); }
const { Debugger, Runtime } = client;
await Runtime.enable();
await Debugger.enable();
await Runtime.runIfWaitingForDebugger();

let stepping = false, steps = 0; const stepLog = [];
Debugger.paused(async (params) => {
  const frames = params.callFrames;
  const top = frames[0];
  if (!stepping && top && top.functionName.includes("__bgReqMsg")) {
    stepping = true;
    console.error("=== START STEPPING depuis __bgReqMsg ===");
    await Debugger.stepOut();
    return;
  }
  if (stepping && steps < 120) {
    steps++;
    const fn = top.functionName || "(anon)";
    stepLog.push(fn + "@" + top.location.columnNumber);
    // détecter l'entrée dans un postMessage (send réel)
    if (/postMessage|send|dispatch/i.test(fn)) console.error("  STEP " + steps + " → " + fn + " col=" + top.location.columnNumber);
    await Debugger.stepInto().catch(async () => { await Debugger.stepOver().catch(() => {}); });
    return;
  }
  if (stepping && steps >= 120) { console.error("=== 120 steps atteints. Chaîne d'appels (fns uniques) ==="); console.error([...new Set(stepLog.map((s) => s.split("@")[0]))].join(" → ")); stepping = false; }
  await Debugger.resume();
});
const _unused = async (params) => {
  const frames = params.callFrames; const top = frames[0];
  if (false) {
    console.error("\n=== PAUSED au debugger (send point) — call stack (top 8) ===");
    for (const f of frames.slice(0, 8)) console.error("  " + f.functionName + " @ " + (f.url.split("/").pop() || f.url) + ":" + f.location.lineNumber);
    // le frame appelant = la coroutine avec A,P,b,B,C,z,v,V,l...
    const sendFrame = frames.find((f) => f.functionName.includes("send")) || frames[1];
    if (sendFrame) {
      const ev = async (expr) => { try { const r = await Debugger.evaluateOnCallFrame({ callFrameId: sendFrame.callFrameId, expression: expr, returnByValue: false }); return (r.result.description || JSON.stringify(r.result.value) || r.result.type || "").slice(0, 300); } catch (e) { return "ERR:" + e.message; } };
      console.error("\n=== eval dans vb.send (" + sendFrame.functionName + ") ===");
      for (const expr of ["this.v&&this.v.__chan", "this.v&&this.v.__side", "typeof (this.v&&this.v.postMessage)", "Object.getOwnPropertyNames(this.v||{}).slice(0,15).join(',')", "Object.getOwnPropertyNames(this.i||{}).slice(0,15).join(',')", "this.i&&this.i.v&&this.i.v.__chan", "typeof (this.i&&this.i.v&&this.i.v.postMessage)", "Object.getOwnPropertyNames(this.W||{}).slice(0,10).join(',')", "String(N&&N[38]).slice(0,200)"]) {
        console.error("  " + expr + " = " + await ev(expr));
      }
    }
    await Debugger.resume();
  } else {
    await Debugger.resume();
  }
};
void _unused;

await sleep(35000);
console.error("=== fin trace ===");
try { await client.close(); } catch (_) {}
try { child.kill(); } catch (_) {}
process.exit(0);
