use super::Value;
use super::instructions::*;
use super::opcodes::{OPCODES_TABLE, Opcode};
use crate::emit;
use anyhow::{Error, bail};
use rustc_hash::FxHashMap;
use std::fmt::Write;
use std::fs::File;
use std::str;

pub struct Disassembler<'a> {
    bytecode: &'a [u8],
    pub size_bits: usize,
    ip: usize,
    registers: FxHashMap<u16, Value>,
    decrypt_state: bool,
    show_instructions: bool,
    pub instructions: Vec<InstructionBase<Instruction>>,
    // known
    charset: Vec<char>,
    xor_key: u32,
    mod_key: u32,
}

impl<'a> Disassembler<'a> {
    pub fn new(bytecode: &'a [u8], show_instructions: bool) -> Self {
        Self {
            bytecode,
            size_bits: bytecode.len(),
            ip: 0,
            registers: FxHashMap::default(),
            decrypt_state: false,
            show_instructions,
            charset: Vec::new(),
            instructions: Vec::new(),
            xor_key: 0,
            mod_key: 0,
        }
    }

    pub fn with(&mut self, bytecode: &'a [u8]) {
        self.bytecode = bytecode;
        self.size_bits = bytecode.len();
        self.ip = 0;

        self.dispatch();
    }

    pub fn save_disassembled_output(&mut self, path: &str) -> Result<(), Error> {
        use std::io::Write;

        let mut file = File::create(path)?;
        for instruction in &self.instructions {
            writeln!(&mut file, "{}", instruction)?;
        }
        Ok(())
    }

    pub fn read_byte(&mut self) -> u8 {
        let byte = self.bytecode[self.ip];
        self.ip += 1;
        byte
    }

    pub fn read_int_32(&mut self) -> i32 {
        let b0 = self.read_byte() as i32;
        let b1 = self.read_byte() as i32;
        let b2 = self.read_byte() as i32;
        let b3 = self.read_byte() as i32;

        b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)
    }

    pub fn set_ip(&mut self, offset: usize) -> Result<usize, Error> {
        let old_ip = self.ip;
        let ip = self.ip + offset;

        if ip > self.size_bits {
            bail!("unexpected end of bytecode");
        }

        self.ip = ip;
        Ok(old_ip)
    }

    fn decode_str(&mut self) -> Result<String, Error> {
        let length = self.read_variant()? as usize;
        let string = self.decode_string(false, length)?;
        Ok(string)
    }

    fn read_byte_checked(&mut self) -> Result<u8, Error> {
        if self.ip >= self.bytecode.len() {
            bail!("unexpected end of bytecode");
        }
        Ok(self.read_byte())
    }

    pub fn read_variant(&mut self) -> Result<i32, Error> {
        // simplified cus of unnecessary nested if stmts
        let mut value: i32 = 0;

        for shift in (0..32).step_by(7) {
            let byte = self.read_byte_checked()?;
            value |= ((byte & 127) as i32) << shift;

            if byte & 128 == 0 {
                return Ok(value);
            }
        }

        for _ in 0..5 {
            let byte = self.read_byte_checked()?;
            if byte & 128 == 0 {
                return Ok(value);
            }
        }

        bail!("varint too long")
    }

    pub fn decode_string(&mut self, flag_utf8: bool, length_hint: usize) -> Result<String, Error> {
        let length = self.set_ip(length_hint)?;
        let decoded_string = if length > 0 && !self.bytecode.is_empty() {
            let start = length;
            let end = length + length_hint;

            if end > self.bytecode.len() {
                bail!("decodeString: out of bounds");
            }

            let subarray = &self.bytecode[start..end];

            if flag_utf8 {
                if str::from_utf8(subarray).is_err() {
                    bail!("invalid UTF-8 sequence");
                }
            }
            String::from_utf8_lossy(subarray).to_string()
        } else {
            let mut runes: Vec<u32> = Vec::new();
            let limit = length + length_hint;
            let mut i = length;

            while i < limit {
                let byte1 = self.bytecode[i];
                i += 1;

                if byte1 < 0x80 {
                    runes.push(byte1 as u32);
                } else if byte1 < 0xE0 {
                    if i >= limit {
                        bail!("decodeString: truncated 2-byte sequence");
                    }
                    let byte2 = self.bytecode[i];
                    i += 1;

                    if (byte2 & 0xC0) != 0x80 {
                        bail!("decodeString: invalid 2-byte continuation");
                    }

                    runes.push(((byte1 & 0x1F) as u32) << 6 | (byte2 & 0x3F) as u32);
                } else if byte1 < 0xF0 {
                    if i >= limit - 1 {
                        bail!("decodeString: truncated 3-byte sequence");
                    }

                    let byte2 = self.bytecode[i];
                    let byte3 = self.bytecode[i + 1];
                    i += 2;

                    if (byte2 & 0xC0) != 0x80 || (byte3 & 0xC0) != 0x80 {
                        bail!("decodeString: invalid 3-byte continuation");
                    }

                    if (byte1 == 0xE0 && byte2 < 0xA0) || (byte1 == 0xED && byte2 >= 0xA0) {
                        bail!("decodeString: invalid 3-byte range");
                    }

                    runes.push(
                        ((byte1 & 0x0F) as u32) << 12
                            | ((byte2 & 0x3F) as u32) << 6
                            | (byte3 & 0x3F) as u32,
                    );
                } else if byte1 <= 0xF4 {
                    if i >= limit - 2 {
                        bail!("decodeString: truncated 4-byte sequence");
                    }

                    let byte2 = self.bytecode[i];
                    let byte3 = self.bytecode[i + 1];
                    let byte4 = self.bytecode[i + 2];
                    i += 3;

                    let code_point = (((byte1 as u32 & 7) << 18)
                        | ((byte2 as u32 & 0x3F) << 12)
                        | ((byte3 as u32 & 0x3F) << 6)
                        | (byte4 as u32 & 0x3F))
                        - 0x10000;

                    runes.push((code_point >> 10) + 0xD800);
                    runes.push((code_point & 0x3FF) + 0xDC00);
                } else {
                    bail!("decodeString: invalid UTF-8 leading byte");
                }

                if runes.len() >= 8192 {
                    bail!("decodeString: too many characters (8192 limit)");
                }
            }

            let mut buf = String::new();
            for r in runes {
                if let Some(ch) = char::from_u32(r) {
                    buf.write_char(ch).unwrap();
                }
            }

            buf
        };

        Ok(decoded_string)
    }

    pub fn read_float_64(&mut self) -> f64 {
        let lo = self.read_int_32() as u32;
        let hi = self.read_int_32() as u32;

        let sign = if (hi >> 31) != 0 { -1.0 } else { 1.0 };

        let exponent = (hi >> 20) & 0x7FF;
        let mantissa = ((hi & 0xFFFFF) as u64) << 32 | lo as u64;

        match exponent {
            0x7FF => {
                if mantissa != 0 {
                    f64::NAN
                } else {
                    sign * f64::INFINITY
                }
            }
            0 => sign * f64::powi(2.0, -1074) * mantissa as f64,
            _ => {
                sign * f64::powi(2.0, (exponent as i32) - 1075)
                    * (mantissa + 0x10000000000000) as f64
            }
        }
    }

    pub fn read_int_flag(&mut self) -> bool {
        let mut value = 0;
        let limit = self.ip + 10;
        let mut flag = false;

        while self.ip < limit {
            let byte = self.read_byte();
            value |= byte;

            if (byte & 0x80) == 0 {
                flag = (value & 127) != 0;
                break;
            }
        }

        flag
    }

    // get ptr value
    pub fn read_pointer_register(&mut self) -> Result<u16, Error> {
        Ok(self.read_variant()? as u16)
    }

    pub fn read_register(&self, register: u16) -> Option<&Value> {
        match self.registers.get(&register) {
            Some(v) => Some(v),
            None => Some(&Value::Undefined),
        }
    }

    pub fn read_register_index(&mut self) -> Result<u16, Error> {
        self.read_byte();
        self.read_int_flag();
        self.read_byte();

        Ok(self.read_variant()? as u16)
    }

    // load value
    pub fn read_typed_value(&mut self) -> Result<Value, Error> {
        self.read_byte();
        self.read_int_flag();
        let index = self.read_byte() >> 3;

        match index {
            1 => Ok(Value::Register(self.read_pointer_register()?)),
            2 => Ok(Value::Boolean(self.read_int_flag())),
            3 => Ok(Value::Integer(self.read_variant()?)),
            4 => Ok(Value::String(self.decode_str()?)),
            6 => Ok(Value::Float(self.read_float_64())),
            _ => Ok(Value::Undefined),
        }
    }

    // get register
    pub fn read_dest_register(&mut self) -> Result<u16, Error> {
        self.ip += 1;
        let register = self.read_variant()?;
        Ok(register as u16)
    }

    pub fn set_register(&mut self, register: u16, value: Value) {
        self.registers.insert(register, value);
    }

    pub fn read_offset(&mut self) -> i32 {
        self.read_byte();
        self.read_int_flag();
        self.read_byte();
        let offset = self.read_int_32();
        offset
    }

    pub fn read_call_args(&mut self, count: usize, sub: usize) -> Result<Vec<u16>, Error> {
        let mut args = Vec::with_capacity(count);

        for _ in 0..count.saturating_sub(sub) {
            args.push(self.read_register_index()?);
        }

        Ok(args)
    }

    fn exec_instruction(
        &mut self,
        arg_count: usize,
        offset: usize,
        opcode: &Opcode,
    ) -> Result<(), Error> {
        let name = opcode.as_str();

        match opcode {
            Opcode::LoadConst | Opcode::LoadImm => {
                let dest = self.read_dest_register()?;
                let value = self.read_typed_value()?;

                if self.charset.is_empty() {
                    self.charset = value.as_str().chars().collect();
                } else {
                    self.set_register(dest, value.clone());
                }

                emit!(self, name, offset, LoadConstInstruction { dest, value })
            }
            Opcode::JumpIfEq => {
                let target_offset = self.read_offset();
                let lhs = self.read_typed_value()?;
                let rhs = self.read_typed_value()?;
                let target = self.ip as i32 + target_offset;

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
            }
            Opcode::StrToBytes => {
                let dest = self.read_dest_register()?;
                let value = self.read_typed_value()?;

                let unicodes: Option<Vec<u32>> = match &value {
                    Value::String(s) => Some(s.chars().map(|c| c as u32).collect()),
                    Value::Register(reg) => {
                        if let Some(Value::String(s)) = self.read_register(*reg) {
                            Some(s.chars().map(|c| c as u32).collect())
                        } else {
                            None
                        }
                    }
                    _ => None,
                };

                if let Some(u) = unicodes {
                    self.decrypt_state = true;
                    self.set_register(dest, Value::CodePoints(u));
                }
                emit!(self, name, offset, StrToBytesInstruction { dest, value })
            }
            Opcode::Add
            | Opcode::Sub
            | Opcode::Mul
            | Opcode::Div
            | Opcode::Mod
            | Opcode::Xor
            | Opcode::Or
            | Opcode::UnknownBinOp => {
                let op = match opcode {
                    Opcode::Add => BinOp::Add,
                    Opcode::Sub => BinOp::Sub,
                    Opcode::Mul => BinOp::Mul,
                    Opcode::Div => BinOp::Div,
                    Opcode::Mod => BinOp::Mod,
                    Opcode::Xor => BinOp::Xor,
                    Opcode::Or => BinOp::Or,
                    _ => BinOp::Unknown,
                };

                let dest = self.read_dest_register()?;
                let lhs = self.read_typed_value()?;
                let rhs = self.read_typed_value()?;

                if self.decrypt_state && matches!(opcode, Opcode::Xor | Opcode::Mod) {
                    if self.xor_key == 0 {
                        self.xor_key =
                            self.read_register(rhs.as_register()).unwrap().as_number() as u32;
                    } else if self.mod_key == 0 {
                        self.mod_key =
                            self.read_register(rhs.as_register()).unwrap().as_number() as u32;
                    }

                    if let Some(Value::CodePoints(unic)) = &self.read_register(lhs.as_register()) {
                        let result = match op {
                            BinOp::Xor => Some(unic.iter().map(|u| u ^ self.xor_key).collect()),
                            BinOp::Mod => Some(unic.iter().map(|u| u % self.mod_key).collect()),
                            _ => None,
                        };
                        if let Some(result) = result {
                            self.set_register(dest, Value::CodePoints(result));
                        }
                    }
                }

                emit!(self, name, offset, BinaryInstruction { op, dest, lhs, rhs })
            }
            Opcode::StrDec => {
                let dest = self.read_dest_register()?;
                let _ = self.read_typed_value()?;
                let decrypted = self.read_typed_value()?;
                let mut string = String::new();

                if let Some(Value::CodePoints(unic)) = self.read_register(decrypted.as_register()) {
                    for pos in unic.iter() {
                        string.push(self.charset[*pos as usize]);
                    }
                    self.decrypt_state = false;
                }

                emit!(self, name, offset, StrDecInstruction { dest, string })
            }
            Opcode::GetWindowProp => {
                let dest = self.read_dest_register()?;
                let prop = self.read_typed_value()?;

                emit!(self, name, offset, GetWindowPropInstruction { dest, prop })
            }
            Opcode::CallMethod => {
                let dest = self.read_dest_register()?;
                let function = self.read_typed_value()?;
                let method = self.read_typed_value()?;
                let args = self.read_call_args(arg_count, 2)?;

                emit!(
                    self,
                    name,
                    offset,
                    CallMethodInstruction {
                        dest,
                        function,
                        method,
                        args
                    }
                )
            }
            Opcode::GetProp => {
                let dest = self.read_dest_register()?;
                let obj = self.read_typed_value()?;
                let prop = self.read_typed_value()?;

                emit!(self, name, offset, GetPropInstruction { dest, obj, prop })
            }
            Opcode::SetProp => {
                let obj = self.read_typed_value()?;
                let prop = self.read_typed_value()?;
                let value = self.read_typed_value()?;

                emit!(self, name, offset, SetPropInstruction { obj, prop, value })
            }
            Opcode::Null => {
                let dest = self.read_dest_register()?;

                emit!(self, name, offset, NullInstruction { dest })
            }
            Opcode::Regexp => {
                let dest = self.read_dest_register()?;
                let pattern = self.read_typed_value()?;
                let flags = self.read_typed_value()?;

                emit!(
                    self,
                    name,
                    offset,
                    RegexpInstruction {
                        dest,
                        pattern,
                        flags
                    }
                )
            }
            Opcode::Mov => {
                let dest = self.read_dest_register()?;
                let value = self.read_typed_value()?;

                emit!(self, name, offset, MovInstruction { dest, value })
            }
            Opcode::Apply => {
                let dest = self.read_dest_register()?;
                let function = self.read_typed_value()?;
                let args = self.read_call_args(arg_count, 1)?;

                emit!(
                    self,
                    name,
                    offset,
                    ApplyInstruction {
                        dest,
                        function,
                        args
                    }
                )
            }
            Opcode::Perf => {
                let dest = self.read_dest_register()?;

                emit!(self, name, offset, PerfInstruction { dest })
            }
            Opcode::MathTrunc => {
                let dest = self.read_dest_register()?;

                emit!(self, name, offset, MathTruncInstruction { dest })
            }
            Opcode::BindApply => {
                let dest = self.read_dest_register()?;
                let this = self.read_typed_value()?;
                let args = self.read_call_args(arg_count, 1)?;

                emit!(
                    self,
                    name,
                    offset,
                    BindApplyInstruction { dest, this, args }
                )
            }
            Opcode::NewFunction => {
                let dest = self.read_dest_register()?;
                let target_offset = self.read_offset();
                let args_reg = self.read_register_index()?;
                let target = self.ip as i32 + target_offset;

                emit!(
                    self,
                    name,
                    offset,
                    NewFunctionInstruction {
                        dest,
                        args_reg,
                        target
                    }
                )
            }
            Opcode::CallWindowProp => {
                let dest = self.read_dest_register()?;
                let prop = self.read_typed_value()?;
                let args = self.read_call_args(arg_count, 1)?;

                emit!(
                    self,
                    name,
                    offset,
                    CallWindowPropInstruction { dest, prop, args }
                )
            }
            Opcode::JumpIfLt => {
                let target_offset = self.read_offset();
                let lhs = self.read_typed_value()?;
                let rhs = self.read_typed_value()?;
                let target = self.ip as i32 + target_offset;

                emit!(self, name, offset, JumpIfLtInstruction { lhs, rhs, target })
            }
            Opcode::Disposer => {
                let target_offset = self.read_offset();
                let func_reg = self.read_register_index()?;
                let target = self.ip as i32 + target_offset;

                emit!(self, name, offset, DisposerInstruction { func_reg, target })
            }
            Opcode::Concat => {
                let dest = self.read_dest_register()?;
                let lhs = self.read_typed_value()?;
                let rhs = self.read_typed_value()?;

                emit!(self, name, offset, ConcatInstruction { dest, lhs, rhs })
            }
            Opcode::SetWindowProp => {
                let prop = self.read_typed_value()?;
                let value = self.read_typed_value()?;

                emit!(self, name, offset, SetWindowPropInstruction { prop, value })
            }
            Opcode::Hash => {
                let dest = self.read_dest_register()?;
                let value = self.read_typed_value()?;
                let mut seed = Value::Undefined;

                if arg_count > 1 {
                    seed = self.read_typed_value()?;
                }

                emit!(self, name, offset, HashInstruction { dest, seed, value })
            }
            Opcode::SerialToStr => {
                let dest = self.read_dest_register()?;
                let value = self.read_typed_value()?;

                emit!(self, name, offset, SerialToStrInstruction { dest, value })
            }
            Opcode::UnknownOp => {
                let value = self.read_typed_value()?;

                emit!(self, name, offset, UnknownOpInstruction { value })
            }
            Opcode::Not => {
                let dest = self.read_dest_register()?;
                let value = self.read_typed_value()?;

                emit!(self, name, offset, NotInstruction { dest, value })
            }
            Opcode::Send => {
                let mut values: Vec<u16> = Vec::new();
                let mut count = 0;

                while count < arg_count {
                    let value = self.read_register_index()?;
                    values.push(value);
                    count += 1;
                }

                emit!(self, name, offset, SendInstruction { values })
            }
            Opcode::Typeof => {
                let dest = self.read_dest_register()?;
                let value = self.read_typed_value()?;

                emit!(self, name, offset, TypeofInstruction { dest, value })
            }
            _ => {
                bail!("unknown opcode {}", name);
            }
        }

        Ok(())
    }

    pub fn dispatch(&mut self) {
        while self.ip != self.size_bits {
            let offset = self.ip;
            let arg_count = self.read_byte() as usize;
            let op_index = match self.read_variant() {
                Ok(i) => i as u16,
                Err(e) => {
                    eprintln!("error: {}", e);
                    break;
                }
            };
            match OPCODES_TABLE.get(&op_index) {
                Some(op) => {
                    if let Err(e) = self.exec_instruction(arg_count, offset, &op) {
                        eprintln!("error: {}", e);
                        return;
                    }
                }
                None => {
                    eprintln!("unknown opcode at index {}", op_index);
                    return;
                }
            }
        }
    }
}
