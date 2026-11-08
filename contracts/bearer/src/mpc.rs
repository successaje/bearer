//! Request and response shapes of the NEAR MPC signer (`v1.signer-prod.testnet`),
//! and signature checks against the vault's derived keys.

use near_sdk::{env, near, serde_json, PublicKey};
use std::str::FromStr;

#[near(serializers = [json])]
pub struct SignArgs {
    pub request: SignRequest,
}

#[near(serializers = [json])]
pub struct SignRequest {
    pub path: String,
    pub payload_v2: Payload,
    pub domain_id: u64,
}

#[near(serializers = [json])]
pub enum Payload {
    /// Hex of the 32-byte hash to sign (secp256k1).
    Ecdsa(String),
    /// Hex of the message to sign (Ed25519).
    Eddsa(String),
}

#[near(serializers = [json])]
pub struct DerivedKeyArgs {
    pub path: String,
    pub predecessor: near_sdk::AccountId,
    pub domain_id: u64,
}

#[near(serializers = [json])]
pub struct AffinePoint {
    pub affine_point: String,
}

#[near(serializers = [json])]
pub struct Scalar {
    pub scalar: String,
}

#[near(serializers = [json])]
#[serde(tag = "scheme")]
pub enum SignatureResponse {
    Secp256k1 {
        big_r: AffinePoint,
        s: Scalar,
        recovery_id: u8,
    },
    Ed25519 {
        signature: Vec<u8>,
    },
}

/// A secp256k1 signature that has been checked against the expected key.
pub struct EcdsaSignature {
    pub r: [u8; 32],
    pub s: [u8; 32],
    pub recovery_id: u8,
}

/// Parses a callback result without ever panicking.
pub fn parse_response(bytes: &[u8]) -> Result<SignatureResponse, String> {
    serde_json::from_slice(bytes).map_err(|e| format!("ERR_BAD_SIGNATURE_RESPONSE: {e}"))
}

fn hex32(s: &str) -> Result<[u8; 32], String> {
    let bytes = decode_hex(s)?;
    bytes
        .try_into()
        .map_err(|_| "ERR_BAD_SIGNATURE_RESPONSE: expected 32 bytes".to_string())
}

pub fn decode_hex(s: &str) -> Result<Vec<u8>, String> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    if !s.len().is_multiple_of(2) {
        return Err("ERR_BAD_HEX".into());
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).map_err(|_| "ERR_BAD_HEX".to_string()))
        .collect()
}

pub fn encode_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0xf) as usize] as char);
    }
    out
}

/// Uncompressed 64-byte secp256k1 key from a NEAR `secp256k1:…` string.
pub fn secp256k1_key_bytes(key: &str) -> Result<[u8; 64], String> {
    let pk = PublicKey::from_str(key).map_err(|_| "ERR_BAD_DERIVED_KEY".to_string())?;
    let raw = pk.as_bytes();
    // First byte is the curve type (1 = secp256k1).
    if raw.first() != Some(&1) || raw.len() != 65 {
        return Err("ERR_BAD_DERIVED_KEY".into());
    }
    let mut out = [0u8; 64];
    out.copy_from_slice(&raw[1..]);
    Ok(out)
}

/// Checks the MPC signature recovers to the vault's derived key (T17).
pub fn verify_ecdsa(
    payload: &[u8; 32],
    response: SignatureResponse,
    expected_key: &str,
) -> Result<EcdsaSignature, String> {
    let SignatureResponse::Secp256k1 {
        big_r,
        s,
        recovery_id,
    } = response
    else {
        return Err("ERR_WRONG_SCHEME".into());
    };
    let big_r = decode_hex(&big_r.affine_point)?;
    if big_r.len() != 33 {
        return Err("ERR_BAD_SIGNATURE_RESPONSE: big_r".into());
    }
    let mut r = [0u8; 32];
    r.copy_from_slice(&big_r[1..]);
    // Bitcoin (BIP146) and Ethereum (EIP-2) both require low S; flip a high one rather than fail.
    let (s, flipped) = low_s(hex32(&s.scalar)?);
    let recovery_id = if flipped { recovery_id ^ 1 } else { recovery_id };
    let mut sig = [0u8; 64];
    sig[..32].copy_from_slice(&r);
    sig[32..].copy_from_slice(&s);
    let recovered =
        env::ecrecover(payload, &sig, recovery_id, true).ok_or("ERR_ECRECOVER_FAILED")?;
    if recovered != secp256k1_key_bytes(expected_key)? {
        return Err("ERR_SIGNATURE_WRONG_KEY".into());
    }
    Ok(EcdsaSignature { r, s, recovery_id })
}

/// secp256k1 group order n, and n / 2, big-endian.
const CURVE_N: [u8; 32] = [
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xfe,
    0xba, 0xae, 0xdc, 0xe6, 0xaf, 0x48, 0xa0, 0x3b, 0xbf, 0xd2, 0x5e, 0x8c, 0xd0, 0x36, 0x41, 0x41,
];
const HALF_N: [u8; 32] = [
    0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0x5d, 0x57, 0x6e, 0x73, 0x57, 0xa4, 0x50, 0x1d, 0xdf, 0xe9, 0x2f, 0x46, 0x68, 0x1b, 0x20, 0xa0,
];

/// Returns `(s, false)` if `s ≤ n/2`, else `(n − s, true)`.
fn low_s(s: [u8; 32]) -> ([u8; 32], bool) {
    if s <= HALF_N {
        return (s, false);
    }
    let mut out = [0u8; 32];
    let mut borrow = 0i16;
    for i in (0..32).rev() {
        let mut d = CURVE_N[i] as i16 - s[i] as i16 - borrow;
        borrow = if d < 0 { 1 } else { 0 };
        if d < 0 {
            d += 256;
        }
        out[i] = d as u8;
    }
    (out, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn high_s_is_flipped() {
        assert_eq!(low_s(HALF_N), (HALF_N, false));
        let mut above = HALF_N;
        above[31] += 1;
        // n = 2·(n/2) + 1, so n − (n/2 + 1) = n/2.
        assert_eq!(low_s(above), (HALF_N, true));
        let mut one = [0u8; 32];
        one[31] = 1;
        let mut n_minus_one = CURVE_N;
        n_minus_one[31] -= 1;
        assert_eq!(low_s(n_minus_one), (one, true));
    }

    #[test]
    fn hex_roundtrip() {
        let bytes = [0u8, 1, 0xab, 0xff];
        assert_eq!(encode_hex(&bytes), "0001abff");
        assert_eq!(decode_hex("0x0001abff").unwrap(), bytes);
        assert!(decode_hex("abc").is_err());
    }

    #[test]
    fn parses_signer_response_shapes() {
        let ecdsa = r#"{"scheme":"Secp256k1","big_r":{"affine_point":"02aa"},"s":{"scalar":"bb"},"recovery_id":1}"#;
        assert!(matches!(
            parse_response(ecdsa.as_bytes()).unwrap(),
            SignatureResponse::Secp256k1 { recovery_id: 1, .. }
        ));
        let eddsa = r#"{"scheme":"Ed25519","signature":[1,2,3]}"#;
        assert!(matches!(
            parse_response(eddsa.as_bytes()).unwrap(),
            SignatureResponse::Ed25519 { .. }
        ));
        assert!(parse_response(b"not json").is_err());
    }
}
