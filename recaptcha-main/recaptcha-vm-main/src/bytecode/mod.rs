use base64::{Engine as _, engine::general_purpose};

/// this base64 decoder is different from the standard
/// the difference is that the standard only allows characters +, /, =, but this one supports -, _, or .

fn base64_char_to_value(c: char) -> Option<u8> {
    match c {
        'A'..='Z' => Some(c as u8 - b'A'),
        'a'..='z' => Some(c as u8 - b'a' + 26),
        '0'..='9' => Some(c as u8 - b'0' + 52),
        '+' | '-' => Some(62),
        '/' | '_' => Some(63),
        '=' | '.' => Some(64),
        _ => None,
    }
}

pub fn decode_base64_custom(encoded: &str, low_bits_shift: u32) -> Result<Vec<u8>, String> {
    const PADDING: u8 = 64;

    let mut output = Vec::new();
    let valid_chars: Vec<char> = encoded
        .chars()
        .filter(|&c| base64_char_to_value(c).is_some())
        .collect();

    let mut idx = 0;

    let mut read_next = |fallback: u8| -> u8 {
        if idx < valid_chars.len() {
            let v = base64_char_to_value(valid_chars[idx]).unwrap();
            idx += 1;
            v
        } else {
            fallback
        }
    };

    loop {
        let sym0 = read_next(u8::MAX);
        let sym1 = read_next(0);
        let sym2 = read_next(PADDING);
        let sym3 = read_next(PADDING);

        if sym3 == PADDING && sym0 == u8::MAX {
            break;
        }

        output.push((sym0 << 2) | (sym1 >> 4));

        if sym2 != PADDING {
            output.push(((sym1 << 4) & 0xF0) | (sym2 >> 2));

            if sym3 != PADDING {
                output.push(((sym2 << low_bits_shift) & 0xC0) | sym3);
            }
        }
    }

    Ok(output)
}

pub fn base64_decode(input: &str) -> Vec<u8> {
    general_purpose::STANDARD
        .decode(&input)
        .expect("failed to decode base64")
}

pub fn xor_fold(key1: &[u8], key2: &[u8]) -> u8 {
    key1.iter()
        .chain(key2.iter())
        .fold(0u8, |acc, &val| acc ^ val)
}

struct Lcg {
    state: u64,
}

impl Lcg {
    fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    fn next_byte(&mut self) -> u8 {
        self.state = (4391 * self.state + 277) % 32779;
        (self.state % 255) as u8
    }
}

pub fn xor_decrypt(ciphertext_bytes: &[u8], seed: i64) -> Vec<u8> {
    let ciphertext_str =
        String::from_utf8(ciphertext_bytes.to_vec()).expect("ciphertext is not valid UTF-8");

    let mut lcg = Lcg::new(seed.unsigned_abs());

    ciphertext_str
        .chars()
        .map(|c| (c as u32 ^ lcg.next_byte() as u32) as u8)
        .collect()
}
pub fn decode_bytecode(raw: &str) -> Result<Vec<u8>, String> {
    let bytecode = decode_base64_custom(raw, 6)?;
    Ok(bytecode)
}
