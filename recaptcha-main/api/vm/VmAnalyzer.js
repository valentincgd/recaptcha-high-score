/** Analyse un dump VM et produit un rapport lisible. */
export class VmAnalyzer {
  static analyze(dump) {
    const report = {
      summary: {},
      script: {},
      anchor: {},
      bytecode: {},
      sends: [],
      recommendations: [],
    };

    report.summary = {
      scriptLoaded: !!dump.script?.grecaptchaReady,
      anchorTokenLen: dump.anchor?.anchorToken?.length ?? 0,
      encryptionKey: dump.anchor?.encryptionKey ?? dump.bytecode?.encryptionKey,
      sendCount: dump.bytecode?.sends?.length ?? 0,
      instructionCount: dump.bytecode?.instructions?.length ?? 0,
      errors: [
        ...(dump.script?.errors ?? []),
        ...(dump.bytecode?.errors ?? []),
      ],
    };

    report.script = dump.script ?? {};
    report.anchor = dump.anchor ?? {};
    report.bytecode = {
      encryptionKey: dump.bytecode?.encryptionKey,
      signalKeys: dump.bytecode?.signalKeys?.slice?.(0, 20),
      sendsPreview: (dump.bytecode?.sends ?? []).slice(0, 10),
      opcodeHistogram: VmAnalyzer.#histogram(dump.bytecode?.instructions),
    };

    const sends05 = (dump.bytecode?.sends ?? []).filter((s) =>
      String(s).startsWith("05AL"),
    );
    if (sends05.length) {
      report.sends.push({ type: "05AL", samples: sends05.slice(0, 2) });
    }

    if (!dump.script?.grecaptchaReady) {
      report.recommendations.push(
        "Script Google non initialisé — vérifier polyfills (BrowserPolyfills) ou charger via <script> dans JSDOM.",
      );
    }
    if (!dump.bytecode?.encryptionKey) {
      report.recommendations.push(
        "encryptionKey VM introuvable — désassemblage config bytecode incomplet.",
      );
    }
    if (!(dump.bytecode?.sends?.length > 0)) {
      report.recommendations.push(
        "Aucun SEND capturé — exécuter le bytecode main dynamique (pas seulement config).",
      );
    }

    return report;
  }

  static #histogram(instructions = []) {
    const h = {};
    for (const i of instructions) {
      h[i.op] = (h[i.op] ?? 0) + 1;
    }
    return Object.entries(h)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([op, count]) => ({ op, count }));
  }
}
