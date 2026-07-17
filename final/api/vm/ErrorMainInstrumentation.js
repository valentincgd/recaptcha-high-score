/**
 * Diagnostic Main.init → ErrorMain (échecs silencieux en JSDOM).
 * Active avec RECAPTCHA_ERRORMAIN_DEBUG=1 ou RECAPTCHA_VM_DEBUG=1.
 */

const MAX = 40;

function enabled() {
  return (
    process.env.RECAPTCHA_ERRORMAIN_DEBUG === "1" ||
    process.env.RECAPTCHA_VM_DEBUG === "1"
  );
}

function push(arr, item) {
  arr.push(item);
  if (arr.length > MAX) arr.shift();
}

function snap(diag, label, data) {
  push(diag.snapshots, { at: Date.now(), label, ...data });
}

function wrapAnchorMainInit(anchor, diag) {
  if (!anchor?.Main?.init || anchor.Main.__initWrapped) return;
  anchor.Main.__initWrapped = true;
  const orig = anchor.Main.init;
  anchor.Main.init = function wrappedMainInit(...args) {
    const arg0 = args[0];
    push(diag.initCalls, {
      at: Date.now(),
      argType: typeof arg0,
      argLen:
        typeof arg0 === "string"
          ? arg0.length
          : Array.isArray(arg0)
            ? arg0.length
            : 0,
      preview:
        typeof arg0 === "string"
          ? arg0.slice(0, 80)
          : Array.isArray(arg0)
            ? `[${arg0[0]},…]`
            : null,
    });
    try {
      const out = orig.apply(this, args);
      queueMicrotask(() =>
        snap(diag, "after-Main.init-sync", describeAnchor(anchor)),
      );
      return out;
    } catch (e) {
      push(diag.errors, {
        kind: "Main.init-throw",
        at: Date.now(),
        message: e?.message ?? String(e),
        stack: e?.stack?.slice(0, 400) ?? null,
      });
      throw e;
    }
  };
}

function wrapRecaptchaObject(recaptcha, diag) {
  if (!recaptcha) return;
  const anchor = recaptcha.anchor;
  if (!anchor) return;

  if (!recaptcha.__errorMainWrapped) {
    recaptcha.__errorMainWrapped = true;
    snap(diag, "anchor-wired", {
      keys: Object.keys(anchor),
      mainKeys: anchor.Main ? Object.keys(anchor.Main) : [],
      hasErrorMain: !!anchor.ErrorMain,
    });
  }

  wrapAnchorMainInit(anchor, diag);
  if (anchor.ErrorMain?.init) wrapErrorMainInit(anchor.ErrorMain, diag);
}

/** Installe hooks console / erreurs / Main.init sur une fenêtre JSDOM. */
export function installErrorMainDiagnostics(window) {
  if (!enabled() || !window || window.__errorMainDiagInstalled) return;
  window.__errorMainDiagInstalled = true;

  const diag = (window.__errorMainDiag = {
    startedAt: Date.now(),
    errors: [],
    rejections: [],
    console: [],
    initCalls: [],
    errorMainInit: null,
    errorMainSeenAt: null,
    snapshots: [],
    pollTicks: 0,
  });

  for (const level of ["error", "warn"]) {
    const orig = window.console?.[level]?.bind(window.console);
    if (!orig) continue;
    window.console[level] = (...args) => {
      const msg = args
        .map((a) => {
          if (a instanceof Error) return `${a.name}: ${a.message}`;
          if (typeof a === "object") {
            try {
              return JSON.stringify(a);
            } catch {
              return String(a);
            }
          }
          return String(a);
        })
        .join(" ")
        .slice(0, 600);
      push(diag.console, { level, at: Date.now(), msg });
      orig(...args);
    };
  }

  window.onerror = (message, source, lineno, colno, error) => {
    push(diag.errors, {
      kind: "window.onerror",
      at: Date.now(),
      message: String(message ?? "").slice(0, 400),
      source: source ? String(source).slice(-80) : null,
      line: lineno,
      col: colno,
      stack: error?.stack?.slice(0, 400) ?? null,
    });
    return false;
  };

  window.addEventListener?.("error", (ev) => {
    push(diag.errors, {
      kind: "error-event",
      at: Date.now(),
      message: String(ev.message ?? ev.error?.message ?? "").slice(0, 400),
      stack: ev.error?.stack?.slice(0, 400) ?? null,
    });
  });

  window.addEventListener?.("unhandledrejection", (ev) => {
    const reason = ev.reason;
    push(diag.rejections, {
      at: Date.now(),
      message:
        reason instanceof Error
          ? `${reason.name}: ${reason.message}`
          : String(reason ?? "").slice(0, 400),
      stack: reason?.stack?.slice(0, 400) ?? null,
    });
  });

  let recaptchaRef = window.recaptcha;
  try {
    Object.defineProperty(window, "recaptcha", {
      get: () => recaptchaRef,
      set: (v) => {
        recaptchaRef = v;
        wrapRecaptchaObject(v, diag);
      },
      configurable: true,
    });
  } catch {
    /* recaptcha déjà non-configurable */
  }
  wrapRecaptchaObject(recaptchaRef, diag);

  const poll = () => {
    diag.pollTicks += 1;
    wrapRecaptchaObject(window.recaptcha, diag);
    const anchor = window.recaptcha?.anchor;
    if (!anchor) return;
    if (anchor.ErrorMain && !diag.errorMainSeenAt) {
      diag.errorMainSeenAt = Date.now();
      snap(diag, "ErrorMain-appeared", {
        keys: Object.keys(anchor),
        errorMainKeys: Object.keys(anchor.ErrorMain),
        mainKeys: anchor.Main ? Object.keys(anchor.Main) : [],
        executeType: typeof anchor.Main?.execute,
      });
      wrapErrorMainInit(anchor.ErrorMain, diag);
    }
  };

  diag._pollTimer = setInterval(poll, 50);
  window.addEventListener?.("beforeunload", () => clearInterval(diag._pollTimer));
}

/** Ré-enveloppe Main.init juste avant l'appel programmé (après recaptcha__fr.js). */
export function ensureAnchorInitHooks(window) {
  if (!enabled() || !window?.__errorMainDiag) return;
  wrapRecaptchaObject(window.recaptcha, window.__errorMainDiag);
}

function wrapErrorMainInit(errorMain, diag) {
  if (!errorMain?.init || errorMain.__initWrapped) return;
  errorMain.__initWrapped = true;
  const orig = errorMain.init;
  errorMain.init = function wrappedErrorMainInit(...args) {
    diag.errorMainInit = {
      at: Date.now(),
      argCount: args.length,
      argTypes: args.map((a) => typeof a),
      preview: args.map((a) => String(a).slice(0, 120)),
    };
    push(diag.errors, {
      kind: "ErrorMain.init-called",
      at: Date.now(),
      message: `ErrorMain.init(${args.length} args)`,
      preview: diag.errorMainInit.preview,
    });
    try {
      return orig.apply(this, args);
    } catch (e) {
      push(diag.errors, {
        kind: "ErrorMain.init-throw",
        at: Date.now(),
        message: e?.message ?? String(e),
        stack: e?.stack?.slice(0, 400) ?? null,
      });
      throw e;
    }
  };
}

function describeAnchor(anchor) {
  if (!anchor) return { missing: true };
  return {
    keys: Object.keys(anchor),
    mainKeys: anchor.Main ? Object.keys(anchor.Main) : [],
    executeType: typeof anchor.Main?.execute,
    hasErrorMain: !!anchor.ErrorMain,
  };
}

/** Arrête le poll et retourne un rapport synthétique. */
export function collectErrorMainReport(window) {
  const diag = window?.__errorMainDiag;
  if (!diag) return { installed: false };

  if (diag._pollTimer) {
    clearInterval(diag._pollTimer);
    diag._pollTimer = null;
  }

  const anchor = window.recaptcha?.anchor;
  const likelyCause = inferLikelyCause(diag, anchor, window);

  return {
    installed: true,
    durationMs: Date.now() - diag.startedAt,
    anchor: describeAnchor(anchor),
    errorMainSeen: !!diag.errorMainSeenAt,
    errorMainSeenMs: diag.errorMainSeenAt
      ? diag.errorMainSeenAt - diag.startedAt
      : null,
    initCalls: diag.initCalls.length,
    errorMainInit: diag.errorMainInit,
    consoleErrors: diag.console.filter((c) => c.level === "error").length,
    consoleWarns: diag.console.filter((c) => c.level === "warn").length,
    windowErrors: diag.errors.length,
    rejections: diag.rejections.length,
    likelyCause,
    recentConsole: diag.console.slice(-8),
    recentErrors: diag.errors.slice(-8),
    recentRejections: diag.rejections.slice(-5),
    snapshots: diag.snapshots.slice(-6),
    workerBootError: window.__workerBootError ?? null,
    workerMsg: window.__workerLastMsg ? "set" : null,
  };
}

function inferLikelyCause(diag, anchor, win) {
  if (!anchor?.ErrorMain && typeof anchor?.Main?.execute === "function") {
    return "ok-execute-present";
  }
  if (anchor?.ErrorMain && typeof anchor?.Main?.execute !== "function") {
    if (diag.errorMainInit) return "ErrorMain.init-invoked";
    return "init-failed-ErrorMain";
  }
  if (!anchor?.ErrorMain && !diag.errorMainSeenAt) {
    if (diag.initCalls.length === 0) return "Main.init-never-called";
    if (typeof anchor?.Main?.execute !== "function") {
      return "init-incomplete-no-execute-yet";
    }
  }

  const errText = [
    ...diag.errors.map((e) => e.message ?? ""),
    ...diag.console.map((c) => c.msg ?? ""),
    ...diag.rejections.map((r) => r.message ?? ""),
  ].join("\n");

  if (/JSON\.parse|is not valid JSON/i.test(errText)) {
    return "json-parse-postMessage";
  }
  if (/postMessage|MessageChannel|port/i.test(errText)) {
    return "handshake-postMessage";
  }
  if (/Timed out|timeout/i.test(errText)) {
    return "timeout";
  }
  if (/Worker|blob:/i.test(errText) || win?.__workerBootError) {
    return "worker-bootstrap";
  }
  if (diag.initCalls.length === 0) return "Main.init-never-called";
  return "unknown";
}

/** Log lisible pour onLog / console. */
export function formatErrorMainReport(report) {
  if (!report?.installed) return "ErrorMain diag: non installé";
  const lines = [
    `cause=${report.likelyCause}`,
    `ErrorMain=${report.errorMainSeen}`,
    `initCalls=${report.initCalls}`,
    `err=${report.windowErrors} warn=${report.consoleWarns} rej=${report.rejections}`,
  ];
  if (report.workerBootError) {
    lines.push(`workerBoot=${report.workerBootError.slice(0, 80)}`);
  }
  const last = report.recentErrors[report.recentErrors.length - 1];
  if (last?.message) lines.push(`lastErr=${last.message.slice(0, 100)}`);
  return lines.join(" | ");
}
