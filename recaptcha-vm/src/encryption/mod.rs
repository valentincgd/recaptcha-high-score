pub mod parse;
pub use parse::parse_encryption;
use rand::Rng;

const LCG_MODULUS: i32 = 94906238;
const LCG_MULTIPLIER: i32 = 13558035;
const LCG_INCREMENT: i32 = 13037;
const GOLDEN_RATIO: i64 = 2654435761;

fn serialize_runtime_seed(runtime_seed: i32) -> [u8; 4] {
    [
        ((runtime_seed >> 24) & 0xff) as u8,
        ((runtime_seed >> 16) & 0xff) as u8,
        ((runtime_seed >> 8) & 0xff) as u8,
        (runtime_seed & 0xff) as u8,
    ]
}

fn normalize_seed(seed: i32) -> i32 {
    ((seed % LCG_MODULUS) + LCG_MODULUS) % LCG_MODULUS
}

fn next_lcg(seed: i32) -> i32 {
    (((seed as i64 * LCG_MULTIPLIER as i64) + LCG_INCREMENT as i64) % LCG_MODULUS as i64) as i32
}

pub fn encrypt_signal_payload(plaintext: &str, encryption_key: i32, signal_key: i32) -> Vec<u8> {
    let mut rng = rand::thread_rng();
    let timestamp: i32 = rng.gen_range(0..i32::MAX);

    // equivalent to:
    // ((timestamp + 939) * 2654435761) | 0
    let runtime_seed = (((timestamp + 939) as i64 * GOLDEN_RATIO) as i32) ^ 0;

    // runtime_seed ^ (encryptionKey ^ signalKey)
    let initial_seed = runtime_seed ^ (encryption_key ^ signal_key);
    let mut encrypted = plaintext.as_bytes().to_vec();

    if encrypted.is_empty() {
        return serialize_runtime_seed(runtime_seed).to_vec();
    }

    let mut seed = normalize_seed(initial_seed);
    seed = next_lcg(seed);
    encrypted[0] = ((encrypted[0] as i32 + seed) % 256) as u8;

    for index in 1..encrypted.len() {
        seed = next_lcg(seed);
        encrypted[index] = ((encrypted[index] as i32 + seed) % 256) as u8;
    }

    encrypted.extend_from_slice(&serialize_runtime_seed(runtime_seed));
    encrypted
}

pub fn decrypt_signal_payload(
    encrypted_data: &[u8],
    encryption_key: i32,
    signal_key: i32,
) -> String {
    if encrypted_data.len() < 4 {
        return String::new();
    }

    // extract last 4 bytes
    let last4 = &encrypted_data[encrypted_data.len() - 4..];

    // reconstruct int32 runtime seed
    let runtime_seed: i32 = ((last4[0] as i32) << 24)
        | ((last4[1] as i32) << 16)
        | ((last4[2] as i32) << 8)
        | (last4[3] as i32);

    // runtime_seed ^ (encryptionKey ^ signalKey)
    let initial_seed = runtime_seed ^ (encryption_key ^ signal_key);

    let encrypted_payload = &encrypted_data[..encrypted_data.len() - 4];

    if encrypted_payload.is_empty() {
        return String::new();
    }

    let mut decrypted = vec![0u8; encrypted_payload.len()];
    let mut seed = normalize_seed(initial_seed);
    seed = next_lcg(seed);
    decrypted[0] = ((encrypted_payload[0] as i32 - seed) % 256) as u8;

    for index in 1..encrypted_payload.len() {
        seed = next_lcg(seed);
        decrypted[index] = ((encrypted_payload[index] as i32 - seed) % 256) as u8;
    }

    String::from_utf8_lossy(&decrypted).to_string()
}
