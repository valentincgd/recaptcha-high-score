use recaptcha_vm::bytecode::*;
use recaptcha_vm::disassembler::disassemble::Disassembler;
use recaptcha_vm::encryption::parse_encryption;
use recaptcha_vm::encryption::{decrypt_signal_payload, encrypt_signal_payload};
use std::fs;

fn main() {
    // let encryption_key = -940896859;
    // let signal_key = 417;

    // let encrypted = encrypt_signal_payload(
    //     "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
    //     encryption_key,
    //     signal_key,
    // );

    // println!("encrypted: {:?}", encrypted);

    // let decrypted = decrypt_signal_payload(&encrypted, encryption_key, signal_key);

    // println!("decrypted: {}", decrypted);

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
    let mut disasm = Disassembler::new(&config_bytecode, false);
    disasm.dispatch();
    disasm.with(&main_bytecode);

    // encrypt

    let parsed = parse_encryption(&disasm.instructions);

    dbg!(&parsed);

    let signal_key = 417;

    let encrypted = encrypt_signal_payload(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
        parsed.encryption_key,
        signal_key,
    );

    println!("encrypted: {:?}", encrypted);

    let decrypted = decrypt_signal_payload(&encrypted, parsed.encryption_key, signal_key);

    println!("decrypted: {}", decrypted);
}
