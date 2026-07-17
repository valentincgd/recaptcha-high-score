use recaptcha_vm::bytecode::*;
use recaptcha_vm::disassembler::disassemble::Disassembler;
use std::fs;

fn main() {
    let main_raw = fs::read_to_string("assets/main_bytecode.txt")
        .unwrap()
        .trim()
        .to_string();

    let config_raw = fs::read_to_string("assets/config_bytecode.txt")
        .unwrap()
        .trim()
        .to_string();

    let main_bytecode = match decode_bytecode(&main_raw) {
        Ok(bytecode) => bytecode,
        Err(e) => {
            eprintln!("Failed to decode main bytecode: {}", e);
            return;
        }
    };

    let seed = xor_fold(&[230, 6], &[224, 3]);
    let decrypted = xor_decrypt(&base64_decode(&config_raw), seed as i64);
    let decrypted_str: String = decrypted.iter().map(|&b| b as char).collect();

    let config_bytecode = match decode_bytecode(&decrypted_str) {
        Ok(bytecode) => bytecode,
        Err(e) => {
            eprintln!("Failed to decode config bytecode: {:?}", e);
            return;
        }
    };
    let mut disasm = Disassembler::new(&config_bytecode, true);
    disasm.dispatch();
    disasm.with(&main_bytecode);

    match disasm.save_disassembled_output("output/disassembled.txt") {
        Ok(_) => println!("Disassembled output saved to output/disassembled.txt"),
        Err(e) => eprintln!("Failed to save disassembled output: {}", e),
    }
}
