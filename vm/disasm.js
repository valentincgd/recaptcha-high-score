'use strict';
/**
 * vm/disasm.js — ÉTAPE 2 du solver VM pur-JS : désassembleur du bytecode VM reCAPTCHA.
 *
 * Port fidèle de recaptcha-vm/src/disassembler/{disassemble,opcodes}.rs.
 * Décode le bytecode (config ou main) en instructions, suit les registres pour :
 *   - récupérer le CHARSET (1er LOAD_CONST),
 *   - déchiffrer les STRINGS VM (STR_TO_B → XOR/MOD → STR_DEC → indexe le charset),
 *   - lister les GET_WINDOW_PROP (props navigateur lues) et les SEND (signaux émis).
 *
 * Usage : node vm/disasm.js [vm/config_bytecode.bin] [--full]
 */
const fs = require('fs');

const OPCODES = {
  1: 'LOAD_CONST', 2: 'CONCAT', 3: 'XOR', 4: 'CALL_METHOD', 5: 'GET_PROP', 6: 'SET_PROP', 7: 'SEND',
  8: 'MOV', 9: 'NULL', 10: 'ADD', 11: 'SUB', 12: 'MUL', 13: 'DIV', 14: 'UNKNOWN_OP', 15: 'MOD',
  16: 'SET_WINDOW_PROP', 17: 'GET_WINDOW_PROP', 18: 'CALL_WINDOW_PROP', 19: 'JE', 20: 'HASH',
  21: 'STR_TO_B', 22: 'REGEXP', 23: 'UNKNOWN_BIN_OP', 24: 'UNKNOWN_BIN_OP', 25: 'NOT', 27: 'SERIAL_TO_STR',
  28: 'MATH_TRUNC', 30: 'NEW_FUNCTION', 31: 'JL', 32: 'DISPOSER', 34: 'BIND_APPLY', 35: 'OR',
  36: 'STR_DEC', 38: 'APPLY', 39: 'PERF', 40: 'LOAD_IMM', 41: 'TYPEOF',
};

class Disassembler {
  constructor(bytecode) {
    this.b = bytecode;
    this.size = bytecode.length;
    this.ip = 0;
    this.regs = new Map();
    this.decryptState = false;
    this.charset = [];
    this.xorKey = 0;
    this.modKey = 0;
    this.instructions = [];
    this.strings = [];       // strings déchiffrées (STR_DEC)
    this.winProps = [];      // GET_WINDOW_PROP / CALL_WINDOW_PROP
    this.sends = 0;
  }

  // ---- readers (port disassemble.rs) ----
  readByte() { return this.b[this.ip++]; }
  readInt32() { const b0 = this.readByte(), b1 = this.readByte(), b2 = this.readByte(), b3 = this.readByte(); return (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) | 0; }
  readVariant() {
    let value = 0;
    for (let shift = 0; shift < 32; shift += 7) {
      const byte = this.b[this.ip++];
      value |= (byte & 127) << shift;
      if ((byte & 128) === 0) return value | 0;
    }
    for (let i = 0; i < 5; i++) { const byte = this.b[this.ip++]; if ((byte & 128) === 0) return value | 0; }
    throw new Error('varint too long');
  }
  readIntFlag() {
    let value = 0; const limit = this.ip + 10; let flag = false;
    while (this.ip < limit) { const byte = this.readByte(); value |= byte; if ((byte & 0x80) === 0) { flag = (value & 127) !== 0; break; } }
    return flag;
  }
  readFloat64() { const buf = this.b.slice(this.ip, this.ip + 8); this.ip += 8; return buf.readDoubleLE(0); }
  readPointerRegister() { return this.readVariant() & 0xffff; }
  readRegisterIndex() { this.readByte(); this.readIntFlag(); this.readByte(); return this.readVariant() & 0xffff; }
  readDestRegister() { this.ip += 1; return this.readVariant() & 0xffff; }
  readOffset() { this.readByte(); this.readIntFlag(); this.readByte(); return this.readInt32(); }
  decodeStr() { const len = this.readVariant() >>> 0; const start = this.ip; this.ip += len; return this.b.slice(start, start + len).toString('utf8'); }
  readTypedValue() {
    this.readByte(); this.readIntFlag();
    const index = this.readByte() >> 3;
    switch (index) {
      case 1: return { t: 'reg', v: this.readPointerRegister() };
      case 2: return { t: 'bool', v: this.readIntFlag() };
      case 3: return { t: 'int', v: this.readVariant() };
      case 4: return { t: 'str', v: this.decodeStr() };
      case 6: return { t: 'float', v: this.readFloat64() };
      default: return { t: 'undef', v: undefined };
    }
  }
  readCallArgs(count, sub) { const n = Math.max(0, count - sub); const a = []; for (let i = 0; i < n; i++) a.push(this.readRegisterIndex()); return a; }

  // ---- helpers registres ----
  reg(r) { return this.regs.has(r) ? this.regs.get(r) : { t: 'undef', v: undefined }; }
  asNumber(val) { if (val.t === 'int' || val.t === 'float') return val.v; if (val.t === 'reg') { const rv = this.reg(val.v); return (rv.t === 'int' || rv.t === 'float') ? rv.v : 0; } return 0; }
  asStr(val) { if (val.t === 'str') return val.v; if (val.t === 'reg') { const rv = this.reg(val.v); return rv.t === 'str' ? rv.v : ''; } return ''; }

  emit(name, ip, extra) { if (this.instructions.length < 200000) this.instructions.push({ ip, op: name, ...extra }); }

  dispatch() {
    let guard = 0;
    while (this.ip < this.size) {
      if (++guard > 2000000) throw new Error('boucle disasm (guard)');
      const offset = this.ip;
      const argCount = this.readByte();
      const opIndex = this.readVariant();
      const name = OPCODES[opIndex];
      if (!name) throw new Error(`opcode inconnu ${opIndex} @${offset}`);
      this.exec(argCount, offset, opIndex, name);
    }
  }

  exec(argCount, offset, op, name) {
    switch (op) {
      case 1: case 40: { // LOAD_CONST / LOAD_IMM
        const dest = this.readDestRegister(); const value = this.readTypedValue();
        if (this.charset.length === 0) this.charset = [...this.asStr(value)];
        else this.regs.set(dest, value);
        this.emit(name, offset, { dest, value });
        break;
      }
      case 19: case 31: { // JE / JL
        const to = this.readOffset(); const lhs = this.readTypedValue(); const rhs = this.readTypedValue();
        this.emit(name, offset, { lhs, rhs, target: this.ip + to });
        break;
      }
      case 21: { // STR_TO_B
        const dest = this.readDestRegister(); const value = this.readTypedValue();
        const s = this.asStr(value);
        if (s) { this.decryptState = true; this.regs.set(dest, { t: 'cp', v: [...s].map(c => c.codePointAt(0)) }); }
        this.emit(name, offset, { dest });
        break;
      }
      case 3: case 15: case 10: case 11: case 12: case 13: case 35: case 23: case 24: { // XOR/MOD/ADD/SUB/MUL/DIV/OR/UNKNOWN_BIN
        const dest = this.readDestRegister(); const lhs = this.readTypedValue(); const rhs = this.readTypedValue();
        if (this.decryptState && (op === 3 || op === 15)) {
          if (this.xorKey === 0 && op === 3) this.xorKey = this.asNumber(rhs) >>> 0;
          else if (this.modKey === 0 && op === 15) this.modKey = this.asNumber(rhs) >>> 0;
          const lv = this.reg(lhs.t === 'reg' ? lhs.v : -1);
          if (lv && lv.t === 'cp') {
            let res = null;
            if (op === 3 && this.xorKey) res = lv.v.map(u => (u ^ this.xorKey) >>> 0);
            else if (op === 15 && this.modKey) res = lv.v.map(u => u % this.modKey);
            if (res) this.regs.set(dest, { t: 'cp', v: res });
          }
        }
        this.emit(name, offset, { dest });
        break;
      }
      case 36: { // STR_DEC
        const dest = this.readDestRegister(); this.readTypedValue(); const enc = this.readTypedValue();
        const cp = this.reg(enc.t === 'reg' ? enc.v : -1);
        let str = '';
        if (cp && cp.t === 'cp') { for (const pos of cp.v) if (pos < this.charset.length) str += this.charset[pos]; this.decryptState = false; this.regs.set(dest, { t: 'str', v: str }); this.strings.push(str); }
        this.emit(name, offset, { dest, string: str });
        break;
      }
      case 17: { // GET_WINDOW_PROP
        const dest = this.readDestRegister(); const prop = this.readTypedValue();
        this.winProps.push(this.asStr(prop) || `#${prop.t}:${prop.v}`);
        this.emit(name, offset, { dest, prop });
        break;
      }
      case 18: { // CALL_WINDOW_PROP
        const dest = this.readDestRegister(); const prop = this.readTypedValue(); const args = this.readCallArgs(argCount, 1);
        this.winProps.push('call:' + (this.asStr(prop) || `#${prop.t}:${prop.v}`));
        this.emit(name, offset, { dest, args });
        break;
      }
      case 4: { const dest = this.readDestRegister(); const fn = this.readTypedValue(); const method = this.readTypedValue(); const args = this.readCallArgs(argCount, 2); this.emit(name, offset, { dest, method, args }); break; }
      case 5: { const dest = this.readDestRegister(); const obj = this.readTypedValue(); const prop = this.readTypedValue(); this.emit(name, offset, { dest }); break; }
      case 6: { this.readTypedValue(); this.readTypedValue(); this.readTypedValue(); this.emit(name, offset, {}); break; }
      case 9: { const dest = this.readDestRegister(); this.emit(name, offset, { dest }); break; }
      case 22: { const dest = this.readDestRegister(); this.readTypedValue(); this.readTypedValue(); this.emit(name, offset, { dest }); break; }
      case 8: { const dest = this.readDestRegister(); const value = this.readTypedValue(); this.regs.set(dest, value); this.emit(name, offset, { dest }); break; }
      case 38: { const dest = this.readDestRegister(); this.readTypedValue(); this.readCallArgs(argCount, 1); this.emit(name, offset, { dest }); break; }
      case 39: { const dest = this.readDestRegister(); this.emit(name, offset, { dest }); break; }
      case 28: { const dest = this.readDestRegister(); this.emit(name, offset, { dest }); break; }
      case 34: { const dest = this.readDestRegister(); this.readTypedValue(); this.readCallArgs(argCount, 1); this.emit(name, offset, { dest }); break; }
      case 30: { const dest = this.readDestRegister(); const to = this.readOffset(); const argsReg = this.readRegisterIndex(); this.emit(name, offset, { dest, target: this.ip + to }); break; }
      case 32: { const to = this.readOffset(); const fnReg = this.readRegisterIndex(); this.emit(name, offset, { target: this.ip + to }); break; }
      case 2: { const dest = this.readDestRegister(); this.readTypedValue(); this.readTypedValue(); this.emit(name, offset, { dest }); break; }
      case 16: { this.readTypedValue(); this.readTypedValue(); this.emit(name, offset, {}); break; }
      case 20: { const dest = this.readDestRegister(); this.readTypedValue(); if (argCount > 1) this.readTypedValue(); this.emit(name, offset, { dest }); break; }
      case 27: { const dest = this.readDestRegister(); this.readTypedValue(); this.emit(name, offset, { dest }); break; }
      case 14: { this.readTypedValue(); this.emit(name, offset, {}); break; }
      case 25: { const dest = this.readDestRegister(); this.readTypedValue(); this.emit(name, offset, { dest }); break; }
      case 7: { for (let i = 0; i < argCount; i++) this.readRegisterIndex(); this.sends++; this.emit(name, offset, { count: argCount }); break; }
      case 41: { const dest = this.readDestRegister(); this.readTypedValue(); this.emit(name, offset, { dest }); break; }
      default: throw new Error(`handler manquant op ${op} (${name})`);
    }
  }
}

function disassemble(bytecode) {
  const d = new Disassembler(bytecode);
  let err = null;
  try { d.dispatch(); } catch (e) { err = e.message; }
  return { d, err };
}

module.exports = { disassemble, Disassembler, OPCODES };

if (require.main === module) {
  const path = process.argv[2] || 'vm/config_bytecode.bin';
  const full = process.argv.includes('--full');
  const bytecode = fs.readFileSync(path);
  console.log(`bytecode: ${bytecode.length} octets (${path})`);
  const { d, err } = disassemble(bytecode);
  const covered = d.ip;
  console.log(`instructions décodées: ${d.instructions.length}  |  ip=${d.ip}/${d.size} (${(covered / d.size * 100).toFixed(1)}% couvert)${err ? '  ⚠ ' + err : '  ✔ walk complet'}`);
  // histogramme opcodes
  const hist = {}; for (const ins of d.instructions) hist[ins.op] = (hist[ins.op] || 0) + 1;
  console.log('opcodes:', Object.entries(hist).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '));
  console.log(`charset: ${d.charset.length} caractères  ${JSON.stringify(d.charset.slice(0, 40).join(''))}…`);
  console.log(`strings déchiffrées (STR_DEC): ${d.strings.length}`);
  const uniq = [...new Set(d.strings)];
  console.log('  échantillon:', JSON.stringify(uniq.slice(0, 30)));
  console.log(`GET/CALL_WINDOW_PROP: ${d.winProps.length}  SEND: ${d.sends}`);
  if (full) { require('fs').writeFileSync('vm/disasm_strings.json', JSON.stringify(uniq, null, 1)); console.log('  → toutes les strings dans vm/disasm_strings.json'); }
}
