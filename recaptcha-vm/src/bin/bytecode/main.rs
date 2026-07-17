use recaptcha_vm::bytecode::*;
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
    let seed = xor_fold(&[176, 170, 107], &[76]);
    let decrypted = xor_decrypt(&base64_decode(&config_raw), seed as i64);
    let decrypted_str: String = decrypted.iter().map(|&b| b as char).collect();

    let config_bytecode = match decode_bytecode(&decrypted_str) {
        Ok(bytecode) => bytecode,
        Err(e) => {
            eprintln!("Failed to decode config bytecode: {:?}", e);
            return;
        }
    };

    let raw_bytes = base64_decode(&config_raw);
    eprintln!(
        "ciphertext[0..10]: {:?}",
        &raw_bytes[..10.min(raw_bytes.len())]
    );

    eprintln!(
        "decrypted[0..30]: {:?}",
        &decrypted[..30.min(decrypted.len())]
    );

    let decrypted_str: String = decrypted.iter().map(|&b| b as char).collect();
    eprintln!(
        "decrypted_str bytes[0..30]: {:?}",
        decrypted_str
            .chars()
            .take(30)
            .map(|c| c as u32)
            .collect::<Vec<_>>()
    );

    println!("config bytecode: {:?}", config_bytecode);
    println!("len {}", main_bytecode.len());
}
