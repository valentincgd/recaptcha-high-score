import { VmDisassembler } from "./VmDisassembler.js";
import { decryptConfigWithKeyCandidates } from "./VmBytecodeKeys.js";
import { resolveConfigBytecode } from "./VmConfigBytecode.js";
import { SignalEncryptor } from "../level2/SignalEncryptor.js";

/**
 * Exécute / désassemble le bytecode config anchor et collecte SEND + clé crypto.
 */
export class VmInterpreter {
  static analyzeAnchorConfig(
    configBytecodeRaw,
    vmBytecodeKeys,
    anchorEncryptionKey = null,
    anchor = null,
  ) {
    if (anchor && !configBytecodeRaw) {
      const resolved = resolveConfigBytecode(anchor);
      if (resolved?.raw) {
        configBytecodeRaw = resolved.raw;
        vmBytecodeKeys = resolved.keys ?? vmBytecodeKeys;
      }
    }

    const result = {
      configDecryptedLen: 0,
      innerBytecodeLen: 0,
      encryptionKey: null,
      signalKeys: [],
      sends: [],
      instructions: [],
      errors: [],
    };

    try {
      const { decrypted, inner, seed, keys } = decryptConfigWithKeyCandidates(
        configBytecodeRaw,
        vmBytecodeKeys,
      );
      result.configDecryptedLen = decrypted.length;
      result.innerBytecodeLen = inner.length;
      result.vmSeed = seed;
      result.vmKeys = keys;

      const dis = new VmDisassembler(inner);
      dis.dispatch();
      result.instructions = dis.instructions;
      const enc = dis.parseEncryption();
      result.encryptionKey = enc.encryptionKey;
      result.signalKeys = enc.signalKeys;
      result.sends = dis.collectSends();
    } catch (err) {
      result.errors.push(err.message);
    }

    if (result.encryptionKey == null && anchorEncryptionKey != null) {
      result.encryptionKey = Number(anchorEncryptionKey) | 0;
      result.encryptionKeySource = "anchor-session";
    }

    return result;
  }

  static encryptCollectorSignals(signals, encryptionKey) {
    const key = Number(encryptionKey) | 0;
    return signals.map(({ plaintext, signalKey }) => ({
      signalKey,
      plaintext,
      encrypted: SignalEncryptor.encrypt(plaintext, key, signalKey),
    }));
  }
}
