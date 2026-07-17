/**
 * Catalogue des signalKey utilisés par les collecteurs TM (aligné bytecode config reg "1").
 * Les clés VM extraites (offset 760–1700) servent à valider / journaliser.
 */
export const COLLECTOR_SIGNAL_KEYS = [
  417, 1641, 1641, 1310, 352, 360, 1628, 16, 34, 31, 3553, 291, 4, 5, 32, 352, 291, 1626,
];

export class VmSignalCatalog {
  static summarize(vmAnalysis) {
    const fromVm = vmAnalysis?.signalKeys ?? [];
    const known = new Set(COLLECTOR_SIGNAL_KEYS);
    const overlap = fromVm.filter((k) => known.has(k));
    return {
      vmSignalKeyCount: fromVm.length,
      collectorKeyCount: COLLECTOR_SIGNAL_KEYS.length,
      overlapCount: overlap.length,
      vmEncryptionKey: vmAnalysis?.encryptionKey ?? null,
      vmEncryptionKeySource: vmAnalysis?.encryptionKeySource ?? "vm-reg-586",
    };
  }
}
