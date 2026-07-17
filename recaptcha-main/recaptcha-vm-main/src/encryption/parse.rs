use crate::disassembler::Value;
use crate::disassembler::instructions::{Instruction, InstructionBase};

#[derive(Default, Debug)]
pub struct ParsedEncryption {
    pub encryption_key: i32,
    pub signal_keys: Vec<u16>,
}

pub fn parse_encryption(instructions: &[InstructionBase<Instruction>]) -> ParsedEncryption {
    let mut parsed_enc = ParsedEncryption::default();

    for instr in instructions {
        match &instr.inner {
            Instruction::LoadConst(i) => {
                if i.dest == 586 {
                    parsed_enc.encryption_key = i.value.as_number() as i32;
                } else {
                    if let Value::String(s) = &i.value
                        && instr.offset > 760
                        && instr.offset < 1700
                    {
                        if s == "1" {
                            parsed_enc.signal_keys.push(i.dest as u16);
                        }
                    }
                }
            }
            _ => {}
        }
    }

    parsed_enc
}
