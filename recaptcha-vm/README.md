
# Project Structure

```
├───bytecode
│       mod.rs  (Bytecode Decoding Functions)
├───decompiler
│       cfg.rs  (Control Flow Graph Analyzer)
│       instruction.rs  (Instruction lifter)
│       mod.rs
├───disassembler
│       disassemble.rs  (VM Disassembler)
│       instructions.rs   (VM instruction set)
│       mod.rs
│       opcodes.rs  (Opcodes Table)
└───encryption  
        mod.rs  (Payload Encryption Functions)
        parse.rs   (Encryption Parser)
```

The decompiler is not fully terminated for now, only the cfg analyzer and the instruction lifter are complete

# VM 

### Bytecode
- **Config**

  Its the configuration of the vm, such as VM strings, which are encrypted, and the encryption key, to encrypt the signals and constants
  It is loaded directly into the anchor, it comes encrypted with 2 keys that must be combined to derive a seed used to perform LGC on the encrypted bytes of the bytecode

  ```rust
  pub fn xor_fold(key1: &[u8], key2: &[u8]) -> u8 {
      key1.iter()
          .chain(key2.iter())
          .fold(0u8, |acc, &val| acc ^ val)
  }


  let seed = xor_fold(&[176, 170, 107], &[76]);
  let decrypted = xor_decrypt(&base64_decode(&config_raw), seed as i64);
  ```

  The full implementation can be seen [here](https://github.com/elyelysiox/recaptcha-vm/blob/main/src/bytecode/mod.rs)

- **Main**

  It contains the fingerprint system for the payload values. This bytecode is dynamically constructed within reCAPTCHA's internal code and is not loaded by any endpoint.
  It extracts some anchor parameters for construction, is encrypted with LGC during execution, and is decrypted in the VM's bootstrap.

VM runs with 2048 registers, to be able to store enough data during execution


### Main Loop 

![g](https://github.com/elyelysiox/recaptcha-vm/blob/main/photos/Screenshot_17.png)

The loop handles:

- Reading instructions from the bytecode
- Decoding opcodes
- Obtaining arguments length for calling opcodes, such as `APPLY`, `CALL_METHOD`, etc
- Executing handlers

```
this.X.X →  Size of the bytecode
this.X.F →  Current Instruction Pointer
this.I →  Max Instructions (50)
this.F → Opcodes Table
z → Call Arguments Count
V → Opcode Index
```

Deobfuscated Version

```javascript
for (; !this.ctx.sizeBits == this.ctx.currentIP && this.count < this.maxInstructions; ) {
    this.count += 1;
    argsCount = readByte(this.ctx);
    index = readVariant(this.ctx);
    this.opcodesTable[index](argsCount);
}
if (!this.ctx.sizeBits == this.ctx.currentIP) {
    this.u = this.ctx.sizeBits
    return;
}
```

### Opcodes
Here is the list of opcodes that the VM has; there are 42 opcodes in total, but the VM only executes 36-38 opcodes


| Opcode  | Instruction       | Descrption |
|------   |-------------------|------------|
| `1`     | LOAD_CONST        | Load a constant value such as a string, float64 or integer |
| `2`     | CONCAT            | Concatenate two values |
| `3`     | XOR               | XOR two values |
| `4`     | CALL_METHOD       | Calls a method of an function |
| `5`     | GET_PROPERTY      | Get a property of an object |
| `6`     | SET_PROPERTY      | Set a property of an object |
| `7`     | SEND              | Sends an encrypted signal to be received outside |
| `8`     | MOV               | Move a value from one register to another |
| `9`     | NULL              | Load null |
| `10`    | ADD               | Add two values |
| `11`    | SUB               | Subtract two values |
| `12`    | MUL               | Multiply two values |
| `13`    | DIV               | Divide two values |
| `14`    | UNKWNON_OP        | Opcode never used in the browser |
| `15`    | MOD               | Modulo two values |
| `16`    | SET_WINDOW_PROP   | Set a property of the window object |
| `17`    | GET_WINDOW_PROP   | Get a property of the window object |
| `18`    | CALL_WINDOW_PROP  | Call a property of the window object |
| `19`    | JUMP_IF_EQUAL     | Jump if two values are equal |
| `20`    | HASH              | Hash a value with seed and returns 32-bit signed integer |
| `21`    | STRING_TO_BYTES   | Convert a string to bytes |
| `22`    | REGEXP            | Regular expression |
| `23`    | BOOL_AND          | Truthy `!!a && !!b` |
| `24`    | BOOL_OR           | Truthy `!!a or !!b` |
| `25`    | NOT               | Logical NOT of a value `!a` |
| `27`    | SERIAL_TO_STRING  | Serialize a value to a string |
| `28`    | MATH_TRUNC        | Obtain the current runtime timing and truncates it `Math.trunc(performance.now())` |
| `30`    | NEW_FUNCTION      | Create a VM function with an entry instruction pointer |
| `31`    | JUMP_IF_LT        | Jump if a value is less than another `a < b` |
| `32`    | DISPOSER          | Create and associate a "cleanup" VM function with event or wait VM functions , such as `addEventListener`, `setInterval`, etc, which is responsible for ending them |
| `34`    | BIND_APPLY        | Apply a function with a bound `this` value and arguments `new (Function.prototype.bind.apply(thisValue, [null].concat(args)))` |
| `35`    | LOGICAL_OR        | Logical OR of two values |
| `36`    | STRING_DECRYPT    | Decrypt a string |
| `38`    | CALL_APPLY        | Calls a function without `this` |
| `39`    | PERFORMANCE_NOW   | Obtain the current runtime timing `performance.now()` |
| `40`    | LOAD_IMM          | Load an immediate value |
| `41`    | TYPEOF            | Obtain the type of a value `typeof a` |

### Variant Reader

Reads a variable-length signed integer 32-bit from a byte stream using a 7-bit continuation encoding.
This function reads VM registers, indices of the next opcodes to be executed

![readerv](https://github.com/elyelysiox/recaptcha-vm/blob/main/photos/3121212121212.png)

Deobfuscated Version

```javascript
readVariant = function(ip, bytecode) {
    let index = ip;
    let byte = bytecode[index++];
    let value = byte & 127;

    if (byte & 128) {
        byte = bytecode[index++];
        value |= (byte & 127) << 7;

        if (byte & 128) {
            byte = bytecode[index++];
            value |= (byte & 127) << 14;

            if (byte & 128) {
                byte = bytecode[index++];
                value |= (byte & 127) << 21;

                if (byte & 128) {
                    byte = bytecode[index++];
                    value |= byte << 28;

                    if (bytecode[index++] & 128 &&
                        bytecode[index++] & 128 &&
                        bytecode[index++] & 128 &&
                        bytecode[index++] & 128 &&
                        bytecode[index++] & 128 &&
                        bytecode[index++] & 128) {
                        throw new Error("variant too big");
                    }
                }
            }
        }
    }
    ip = index
    return value
}
```

### VM Strings & Instructions

The encrypted string is transformed into codepoints using the opcode `STRING_TO_BYTES`. Then modulus `MOD` and xor `XOR` operations are applied to each codepoint using two decryption keys loaded into the config bytecode. XOR corresponds to the first key and MOD to the second; these keys are loaded into static registers.

After the decryption process, the codepoints are used to map a character from the character set

Keys and character set initialization
```
0x000000:  LOAD_CONST        R278, "[p, N, /, 0, z, d, 4, 6, M, h, _, V, w, \, F, r, p, E, j, S, =, 8, Y, :,  , E, H, ;, -, K, J, f, m, i, F, ?, <, f, >, 0, f, ?, #, v, G, p, Z, n, B, *, y, P, g, q, \, j, {, /, T, [, L, x, ], Z, $, [, I, /, t, S, O, y, B, ~, I, @, k, 0, (, H, o,  , l, X, i, P, v, !, V, €, z, O, R, ), @, m, Z, G, 9, 6, J, r, g, h, F, ], K, (, B, \, k, 5, a, I, g, H, |, ,, #, T, U, <, *, x, 1, D, 5, D, C, O, @, c, 9, 8, b, E, 6, s, ], W, A, ~, C, 2, 4, #, %, n, N, a, x, 4, k, K, T, 1, l, 3, o, }, %, N, e,  , 7, -, v, ^, D, G, m, 3, W, ., }, y, V, a, b, M, j, *, +, ', u, J, o, r, C, &, q]"
0x00024a:  LOAD_CONST        R341, 231
0x000254:  LOAD_CONST        R438, 573
```

Decryption Process
```
0x001a0d:  STR_TO_B          R237, R617               ; "ጛ㔯஦⢙eᩡⶵ⃬֠ㅅ੷㒯᛫ᱱ᛫ᚰ"
0x001a17:  XOR               R237, R237 ^ R341 
0x001a26:  MOD               R237, R237 % R438    
0x001a35:  STR_DEC           R237, "addEventListener"
```

The `JUMP_IF_EQUAL` instruction is not only used to compare the equality of two values, it is also used as an unconditional jump instruction to jump to a destination point (JUMP), achieved by comparing two numeric values ​​that return a true result

```
0x00078b:  JE                0 == 0, 0x000734
0x0008ad:  JE                1 == 1, 0x000bb8
```

In my disassembler implementation i transform it directly into a JUMP Instruction:

```rust
match (&lhs, &rhs) {
    (Value::Integer(l), Value::Integer(r)) => {
        let vallhs = *l;
        let valrhs = *r;

        if vallhs == valrhs
            && ((vallhs == 0 && valrhs == 0) || (vallhs == 1 && valrhs == 1))
        {
            emit!(self, "JMP", offset, JumpInstruction { target })
        } else {
            emit!(self, name, offset, JumpIfEqInstruction { lhs, rhs, target })
        }
    }
    _ => {
        emit!(self, name, offset, JumpIfEqInstruction { lhs, rhs, target })
    }
}
```

Also `JUMP` is used as a Terminator to end a block of VM functions or an indirect return by jumping to the end of the program

# Fingerprint Signal & Encryption

The VM uses a custom stream-based cipher to encrypt fingerprint signals (not cryptographic),
Also derives the encryption state dynamically using runtime timing:

```javascript
timestamp = Math.trunc(performance.now());

runtimeSeed = (timestamp + 939) * 2654435761;

state = (encryptionKey ^ signalKey) ^ runtimeSeed;
```

As Result:
- Replay attacks become more difficult
- Static payload signatures are weakened

The key is dynamic, it is always stored in a static register `586` along with its constants:

```
0x000249:  LOAD_IMM          R586, -940896859
0x00025b:  LOAD_CONST        R1454, 94906238
0x000267:  LOAD_CONST        R1846, 13558035
0x000273:  LOAD_CONST        R1213, 13037
```

These are used to derive the state with LGC

```javascript
state = (state * 13558035 + 13037) % 94906238;
X[n+1] = (13558035 * X[n] + 13037) % 94906238;
```

After encryption, the result would be for example:

```javascript
signalKey = 123;
encryptionKey = -940896859;

encrypt("false", signalKey, encryptionKey);
// →  [151, 91, 101, 161, 128, -75, -180, -38, -218]
```

Regarding how reCAPTCHA decrypts the data, they obtain the last 4 `[-75, -180, -38, -218]` bytes of the encrypted data which contain the encryption runtime seed serialized as a 32-bit signed integer. Serialization is performed in this loop 

```javascript
while (len !== r1620) {
    let byteVal = r744 % 256;
    encryptedData[r1620] = byteVal;
    let div = r744 / 256;
    r744 = Math.floor(div);
    r1620--;
}
```

This is equivalent to

```javascript
encryptedData.push(
    runtimeSeed >> 24,
    runtimeSeed >> 16,
    runtimeSeed >> 8,
    runtimeSeed
)
```

These 4 bytes are reconstructed server-side to recover the runtime state used during encryption.

Equivalent reconstruction:

```javascript
se = encryptedData.slice(-4);
runtimeSeed = (se[0] << 24) | (se[1] << 16) | (se[2] << 8) | se[3];
```

The server then derives the final stream state using:

```javascript
state = runtimeSeed ^ (encryptionKey ^ signalKey);
```

After reconstructing the state, the same LCG is used to regenerate the keystream and decrypt the payload

### Signals

reCAPTCHA VM takes certain signals that are loaded into the config bytecode; some have a low probability of being collected, and others will always be collected. Some of them:
```
[417, 727, 545, 779, 659, 959, 895, 1092, 41, 43, 549, 352]
```

```
0x0003c4:  LOAD_CONST        R352, "1"
0x0003ce:  LOAD_CONST        R417, "1"
0x0003d8:  LOAD_CONST        R545, "1"
0x0003e2:  LOAD_CONST        R1313, "1"
0x0003ec:  LOAD_CONST        R291, "1"
0x0003f6:  LOAD_CONST        R1092, "1"
0x000400:  LOAD_CONST        R549, "1"
0x00040a:  LOAD_CONST        R614, "1"
0x000414:  LOAD_CONST        R41, "1"
0x00041d:  LOAD_CONST        R1994, "1"
0x000427:  LOAD_CONST        R779, "1"
0x000431:  LOAD_CONST        R43, "1"
0x00043a:  LOAD_CONST        R619, "1"
0x000444:  LOAD_CONST        R2033, "1"
0x00044e:  LOAD_CONST        R659, "1"
0x000458:  LOAD_CONST        R727, "1"
0x000462:  LOAD_CONST        R1019, "1"
0x00046c:  LOAD_CONST        R1310, "1"
0x000476:  LOAD_CONST        R959, "1"
0x000480:  LOAD_CONST        R895, "1"
```

## Contact

- Discord: `@g_recaptcha`
- Telegram: `@lyxlobyx`
