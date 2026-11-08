//! Sandbox-only stand-in for the NEAR MPC signer (`v1.signer-prod.testnet`).
//!
//! Same method names and JSON shapes as the real signer, so Bearer's code path is
//! identical in tests. Keys are deterministic: secret = sha256(seed | predecessor | path | domain).
//! It answers synchronously instead of through yield/resume; Bearer's callback can't tell.
//! `set_mode` switches it to fail or to sign with the wrong key, for T9 and T17.

use ed25519_dalek::Signer;
use k256::ecdsa::SigningKey;
use near_sdk::{env, near, require, AccountId, NearToken};
use sha2::{Digest, Sha256};

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    Ok,
    Error,
    WrongKey,
}

#[near(serializers = [json])]
pub struct SignRequest {
    pub path: String,
    pub payload_v2: Payload,
    pub domain_id: u64,
}

#[near(serializers = [json])]
pub enum Payload {
    Ecdsa(String),
    Eddsa(String),
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

#[near(contract_state)]
pub struct MockSigner {
    seed: String,
    mode: Mode,
    sign_calls: u64,
}

impl Default for MockSigner {
    fn default() -> Self {
        Self {
            seed: "bearer-mock-signer".into(),
            mode: Mode::Ok,
            sign_calls: 0,
        }
    }
}

#[near]
impl MockSigner {
    #[init]
    pub fn new(seed: Option<String>) -> Self {
        Self {
            seed: seed.unwrap_or_else(|| "bearer-mock-signer".into()),
            ..Default::default()
        }
    }

    /// Sandbox control. The real signer has no such method.
    pub fn set_mode(&mut self, mode: Mode) {
        self.mode = mode;
    }

    pub fn mode(&self) -> Mode {
        self.mode
    }

    /// How many signatures were requested, so tests can assert none were (T3).
    pub fn sign_calls(&self) -> u64 {
        self.sign_calls
    }

    #[payable]
    pub fn sign(&mut self, request: SignRequest) -> SignatureResponse {
        require!(
            env::attached_deposit() >= NearToken::from_yoctonear(1),
            "Attached deposit is lower than required"
        );
        self.sign_calls += 1;
        require!(self.mode != Mode::Error, "MOCK_SIGN_ERROR");
        let predecessor = env::predecessor_account_id();
        let path = match self.mode {
            Mode::WrongKey => format!("{}#wrong", request.path),
            _ => request.path,
        };
        match request.payload_v2 {
            Payload::Ecdsa(hex) => {
                let hash = decode_hex(&hex);
                require!(hash.len() == 32, "ECDSA payload must be 32 bytes");
                let key = secp_key(&self.seed, &predecessor, &path);
                let (sig, recid) = key
                    .sign_prehash_recoverable(&hash)
                    .unwrap_or_else(|_| env::panic_str("sign failed"));
                let mut big_r = vec![0x02 | recid.is_y_odd() as u8];
                big_r.extend_from_slice(&sig.r().to_bytes());
                SignatureResponse::Secp256k1 {
                    big_r: AffinePoint {
                        affine_point: encode_hex(&big_r),
                    },
                    s: Scalar {
                        scalar: encode_hex(&sig.s().to_bytes()),
                    },
                    recovery_id: recid.to_byte(),
                }
            }
            Payload::Eddsa(hex) => {
                let message = decode_hex(&hex);
                let key = ed_key(&self.seed, &predecessor, &path);
                SignatureResponse::Ed25519 {
                    signature: key.sign(&message).to_bytes().to_vec(),
                }
            }
        }
    }

    /// Same shape as the real view: `secp256k1:<base58 64 bytes>` or `ed25519:<base58 32 bytes>`.
    pub fn derived_public_key(
        &self,
        path: String,
        predecessor: Option<AccountId>,
        domain_id: Option<u64>,
    ) -> String {
        let predecessor = predecessor.unwrap_or_else(env::predecessor_account_id);
        match domain_id.unwrap_or(0) {
            0 => {
                let point = secp_key(&self.seed, &predecessor, &path)
                    .verifying_key()
                    .to_encoded_point(false);
                format!(
                    "secp256k1:{}",
                    bs58::encode(&point.as_bytes()[1..]).into_string()
                )
            }
            1 => format!(
                "ed25519:{}",
                bs58::encode(
                    ed_key(&self.seed, &predecessor, &path)
                        .verifying_key()
                        .to_bytes()
                )
                .into_string()
            ),
            _ => env::panic_str("unknown domain"),
        }
    }

    pub fn public_key(&self, domain_id: Option<u64>) -> String {
        let root: AccountId = "root.mock"
            .parse()
            .unwrap_or_else(|_| env::panic_str("bad account"));
        self.derived_public_key(String::new(), Some(root), domain_id)
    }
}

fn secret(seed: &str, predecessor: &AccountId, path: &str, domain: u8, attempt: u8) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(seed.as_bytes());
    h.update(b"|");
    h.update(predecessor.as_bytes());
    h.update(b"|");
    h.update(path.as_bytes());
    h.update([b'|', domain, attempt]);
    h.finalize().into()
}

fn secp_key(seed: &str, predecessor: &AccountId, path: &str) -> SigningKey {
    // A sha256 output is almost always a valid scalar; retry on the astronomically rare miss.
    for attempt in 0..8u8 {
        let bytes = secret(seed, predecessor, path, 0, attempt);
        if let Ok(key) = SigningKey::from_bytes(&bytes.into()) {
            return key;
        }
    }
    env::panic_str("no valid key")
}

fn ed_key(seed: &str, predecessor: &AccountId, path: &str) -> ed25519_dalek::SigningKey {
    ed25519_dalek::SigningKey::from_bytes(&secret(seed, predecessor, path, 1, 0))
}

fn decode_hex(s: &str) -> Vec<u8> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    require!(s.len().is_multiple_of(2), "bad hex");
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap_or_else(|_| env::panic_str("bad hex")))
        .collect()
}

fn encode_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use k256::ecdsa::{RecoveryId, Signature, VerifyingKey};

    #[test]
    fn ecdsa_signature_recovers_to_derived_key() {
        let mut signer = MockSigner::default();
        let bearer: AccountId = "bearer.test.near".parse().unwrap();
        near_sdk::testing_env!(near_sdk::test_utils::VMContextBuilder::new()
            .predecessor_account_id(bearer.clone())
            .attached_deposit(NearToken::from_yoctonear(1))
            .build());
        let hash = [7u8; 32];
        let SignatureResponse::Secp256k1 {
            big_r,
            s,
            recovery_id,
        } = signer.sign(SignRequest {
            path: "bearer:v3:1:evm".into(),
            payload_v2: Payload::Ecdsa(encode_hex(&hash)),
            domain_id: 0,
        })
        else {
            panic!("wrong scheme")
        };
        let r = &decode_hex(&big_r.affine_point)[1..];
        let sig = Signature::from_scalars(
            <[u8; 32]>::try_from(r).unwrap(),
            <[u8; 32]>::try_from(decode_hex(&s.scalar)).unwrap(),
        )
        .unwrap();
        let recovered = VerifyingKey::recover_from_prehash(
            &hash,
            &sig,
            RecoveryId::from_byte(recovery_id).unwrap(),
        )
        .unwrap();
        let expected = signer.derived_public_key("bearer:v3:1:evm".into(), Some(bearer), Some(0));
        let got = format!(
            "secp256k1:{}",
            bs58::encode(&recovered.to_encoded_point(false).as_bytes()[1..]).into_string()
        );
        assert_eq!(got, expected);
    }

    #[test]
    fn keys_differ_per_path_and_predecessor() {
        let signer = MockSigner::default();
        let a: AccountId = "a.near".parse().unwrap();
        let b: AccountId = "b.near".parse().unwrap();
        let k1 = signer.derived_public_key("p:btc".into(), Some(a.clone()), Some(0));
        assert_ne!(
            k1,
            signer.derived_public_key("p:evm".into(), Some(a.clone()), Some(0))
        );
        assert_ne!(
            k1,
            signer.derived_public_key("p:btc".into(), Some(b), Some(0))
        );
        assert!(signer
            .derived_public_key("p:sol".into(), Some(a), Some(1))
            .starts_with("ed25519:"));
    }
}
