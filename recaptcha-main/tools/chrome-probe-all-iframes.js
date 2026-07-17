/**
 * Console Chrome — sonde reCAPTCHA (parent TM ou iframe Google).
 *
 * PARENT (top TM) : tableau + liste des iframes cross-origin à ouvrir à la main.
 * IFRAME (google.com/recaptcha) : lecture ___vmDump + copy JSON.
 *
 * Après exécution :
 *   __recaptchaProbe.export()
 *   __recaptchaProbe.help()
 */

(function probeRecaptcha() {
  const STATIC_DECODED = 78464;
  const TM_SITEKEY = "6LdoaXQrAAAAADQviABd-eByJu6kPL8awKDyc1zb";

  const inGoogleIframe =
    /google\.com/i.test(location.hostname) &&
    /recaptcha/i.test(location.pathname + location.href);

  function safe(fn, fb = null) {
    try {
      return fn();
    } catch (e) {
      return fb ?? { error: String(e.message || e).slice(0, 120) };
    }
  }

  function b64DecodedLen(b64) {
    if (typeof b64 !== "string" || !b64.length) return 0;
    try {
      return atob(b64.replace(/\s/g, "")).length;
    } catch {
      return 0;
    }
  }

  function analyzeVmDump(dump) {
    if (!dump) return { present: false };
    const blobs = [];
    if (typeof dump.mainBytecode === "string") blobs.push(dump.mainBytecode);
    for (const b of dump.bytecodes ?? dump.mainBytecodes ?? []) {
      if (typeof b === "string") blobs.push(b);
    }
    const sized = blobs
      .map((raw, i) => ({
        i,
        b64Len: raw.length,
        decodedLen: b64DecodedLen(raw),
        likelyStatic: b64DecodedLen(raw) === STATIC_DECODED,
      }))
      .sort((a, b) => b.decodedLen - a.decodedLen);
    const best = sized[0] ?? null;
    return {
      present: blobs.length > 0 || !!(dump.sends?.length || dump.last05AL),
      bytecodeCount: sized.length,
      sends: (dump.sends ?? []).length,
      has05AL: !!(
        dump.last05AL || (dump.sends ?? []).some((s) => String(s).startsWith("05AL"))
      ),
      best,
      sized: sized.slice(0, 5),
    };
  }

  function probeHere(w, label) {
    const anchor = w.recaptcha?.anchor;
    const main = anchor?.Main;
    const dump = w.___vmDump;
    const vm = analyzeVmDump(dump);
    return {
      label,
      context: inGoogleIframe ? "iframe-google" : "parent",
      href: w.location?.href ?? "",
      siteKey: (w.location?.href?.match(/[?&]k=([^&]+)/) || [])[1] ?? null,
      anchor: !!anchor,
      errorMain: !!anchor?.ErrorMain,
      mainKeys: main ? Object.keys(main) : [],
      execute: typeof main?.execute,
      vmDump: vm,
      hasDumpObject: dump != null,
      dumpKeys: dump ? Object.keys(dump) : [],
    };
  }

  function exportDump(w) {
    const dump = w.___vmDump;
    if (!dump) {
      console.error("[reCAPTCHA] ___vmDump absent. Déclencher login / attendre le challenge.");
      return null;
    }
    const vm = analyzeVmDump(dump);
    if (vm.best?.likelyStatic) {
      console.warn(
        "[reCAPTCHA] Blob ~78464 o = asset statique Rust, pas runtime TM. Refaire pendant le login actif.",
      );
    }
    const json = JSON.stringify(dump, null, 2);
    if (typeof copy === "function") {
      copy(json);
      console.log(
        "%c[reCAPTCHA] ___vmDump copié",
        "color:#0d652d;font-weight:bold",
        json.length,
        "chars, bytecodes:",
        vm.bytecodeCount,
        "bestDecoded:",
        vm.best?.decodedLen ?? 0,
      );
    } else {
      console.log(json);
    }
    return dump;
  }

  /** Mode iframe Google (contexte console = anchor) */
  function runInIframe() {
    const p = probeHere(window, "cette iframe");
    console.log("%c[reCAPTCHA] Contexte iframe Google", "font-weight:bold;color:#1a73e8");
    console.table([p]);
    console.log("___vmDump présent:", p.hasDumpObject, p.dumpKeys);
    if (p.vmDump.present) console.log("Détail bytecodes:", p.vmDump.sized);

    if (p.siteKey && p.siteKey !== TM_SITEKEY) {
      console.warn(
        `%c[reCAPTCHA] Mauvaise clé site`,
        "color:#c5221f;font-weight:bold",
        "\nIframe actuelle:",
        p.siteKey,
        "\nTicketmaster:",
        TM_SITEKEY,
        "\n→ Menu console (top) → iframe avec k=6LdoaXQr…",
      );
    }

    const api = {
      probe: p,
      export: () => exportDump(window),
      help() {
        console.log(
          "___vmDump n’existe pas nativement dans Chrome.\n\n" +
            "1. Coller tools/chrome-install-vm-capture.js dans CETTE iframe\n" +
            "2. Vérifier k=6LdoaXQr (Ticketmaster)\n" +
            "3. Cliquer « Se connecter » sur TM\n" +
            "4. __vmCapture.export() → dumps/chrome-vm.json\n" +
            "5. npm run import:vm-dump -- dumps/chrome-vm.json",
        );
      },
    };
    window.__recaptchaProbe = api;
    if (!p.hasDumpObject) {
      console.warn(
        "[reCAPTCHA] ___vmDump absent (normal dans Chrome).\n" +
          "→ Coller d’abord: tools/chrome-install-vm-capture.js\n" +
          "→ Puis login TM → __vmCapture.export()\n" +
          (p.siteKey !== TM_SITEKEY
            ? "→ ATTENTION: vous êtes sur k=" + p.siteKey?.slice(0, 12) + "… pas Ticketmaster"
            : ""),
      );
    } else if (p.execute !== "function") {
      console.warn(
        "[reCAPTCHA] Main.execute pas encore défini — normal avant interaction.\n" +
          "Cliquer login sur la page TM puis ré-exécuter.",
      );
    }
    console.log("%c[reCAPTCHA]", "font-weight:bold", " __recaptchaProbe.export() | .help()");
    return api;
  }

  /** Mode page parent TM */
  function runInParent() {
    function probeWindow(w) {
      return safe(() => probeHere(w, ""), { accessible: false });
    }

    const flat = [];
    flat.push({
      label: "top (page courante)",
      src: location.href.slice(0, 100),
      ...probeWindow(window),
      ok: true,
    });

    const crossOrigin = [];
    document.querySelectorAll("iframe").forEach((el, idx) => {
      const src = el.src || "(empty)";
      const siteKey = (src.match(/[?&]k=([^&]+)/) || [])[1] ?? null;
      const row = {
        label: `iframe[${idx}]`,
        src: src.slice(0, 100),
        siteKey,
        isTmKey: siteKey === TM_SITEKEY,
        ok: false,
        accessible: false,
        reason: "cross-origin",
      };
      const cw = safe(() => el.contentWindow);
      if (cw && cw !== window) {
        const child = probeWindow(cw);
        if (child.accessible !== false && !child.error) {
          row.ok = true;
          row.accessible = true;
          Object.assign(row, child);
        } else {
          crossOrigin.push({
            index: idx,
            label: row.label,
            src,
            siteKey,
            isTmKey: siteKey === TM_SITEKEY,
          });
        }
      } else if (cw === window) {
        row.note = "same-window";
        row.ok = true;
        Object.assign(row, probeWindow(window));
      } else if (src === "(empty)" || !src.startsWith("http")) {
        const child = safe(() => probeWindow(cw));
        if (child && !child.error) {
          row.ok = true;
          Object.assign(row, child);
        }
      }
      flat.push(row);
    });

    console.log("%c[reCAPTCHA] Sonde iframes (page parent)", "font-weight:bold;color:#1a73e8");
    console.table(
      flat.map((r) => ({
        iframe: r.label,
        src: (r.src || "").slice(0, 55),
        siteKey: (r.siteKey || "").slice(0, 18),
        tm: r.isTmKey ? "✓ TM" : "",
        ok: r.ok ?? r.accessible ?? false,
        anchor: r.anchor ?? "—",
        execute: r.execute ?? "—",
        ErrorMain: r.errorMain ?? "—",
        ___vmDump: r.hasDumpObject ?? false,
        bytecodes: r.vmDump?.bytecodeCount ?? 0,
        bestDecoded: r.vmDump?.best?.decodedLen ?? 0,
      })),
    );

    console.log("%c[reCAPTCHA] Lecture de vos résultats", "font-weight:bold");
    console.log(
      "• top : anchor=true mais execute=undefined + ErrorMain → API grecaptcha sur la page TM, PAS le bytecode VM.\n" +
        "• iframe[0]/[1] ok=false → normal (Google cross-origin). Le dump est DANS ces iframes.\n" +
        `• Pour Ticketmaster, cibler iframe avec k=${TM_SITEKEY.slice(0, 12)}… (souvent iframe[1]).`,
    );

    if (crossOrigin.length) {
      console.log("%c[reCAPTCHA] Étapes obligatoires (iframe Google)", "font-weight:bold;color:#c5221f");
      crossOrigin.forEach((f) => {
        const star = f.isTmKey ? " ★ TICKETMASTER" : "";
        console.log(
          `\n${f.label}${star}\n` +
            `  URL: ${f.src.slice(0, 90)}…\n` +
            "  1. Clic droit sur l’iframe reCAPTCHA → Inspecter\n" +
            "  2. Console → menu « top » → choisir l’iframe (recaptcha/api2/anchor…)\n" +
            "  3. Coller à nouveau ce même script (chrome-probe-all-iframes.js)\n" +
            "  4. __recaptchaProbe.export()",
        );
      });
    }

    const api = {
      rows: flat,
      crossOrigin,
      tmSiteKey: TM_SITEKEY,
      help() {
        console.log(
          "Depuis le PARENT on ne peut pas lire ___vmDump Google.\n\n" +
            "Menu contexte console (vos captures) :\n" +
            "  ✓ « a-xxxxx (anchor) » + www.google.com\n" +
            "  ✓ « webworker.js » + www.google.com (si pas de dump dans anchor)\n" +
            "  ✗ about:blank, cosmetic_filters, Captcha Solver / NoCaptcha (extensions)\n" +
            "  Puis: chrome-install-vm-capture.js → login TM → __vmCapture.export()\n\n" +
            "Puis : dumps/chrome-vm.json → npm run import:vm-dump -- dumps/chrome-vm.json",
        );
      },
      export() {
        console.error(
          "export() impossible depuis le parent (cross-origin).\n" +
            "Utilisez __recaptchaProbe.help() puis ré-exécutez le script DANS l’iframe.",
        );
        return null;
      },
      exportAll() {
        return api.export();
      },
    };
    window.__recaptchaProbe = api;
    console.log("%c[reCAPTCHA]", "font-weight:bold", " __recaptchaProbe.help()");
    return api;
  }

  return inGoogleIframe ? runInIframe() : runInParent();
})();
