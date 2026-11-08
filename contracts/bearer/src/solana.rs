//! Solana legacy transactions holding exactly one SystemProgram transfer, encoded by hand (T7).
//! The message always carries a recent blockhash, never a durable nonce, so a signature stops
//! being usable once that blockhash expires (about 150 blocks).

use near_sdk::json_types::U64;
use near_sdk::{env, near, PublicKey};
use std::str::FromStr;

/// `11111111111111111111111111111111`: the system program's address is 32 zero bytes.
const SYSTEM_PROGRAM: [u8; 32] = [0; 32];
/// SystemInstruction::Transfer.
const TRANSFER: u32 = 2;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct SolWithdrawParams {
    /// Base58 blockhash from the cluster, at most ~60–90 s old when signed.
    pub recent_blockhash: String,
    /// Base58 recipient address.
    pub to: String,
    pub lamports: U64,
}

impl SolWithdrawParams {
    /// The message the vault's key signs: one transfer from the vault, which also pays the fee.
    /// Never panics, so the callback can rebuild it safely.
    pub fn message(&self, from: &[u8; 32]) -> Result<Vec<u8>, String> {
        let blockhash = decode32(&self.recent_blockhash).ok_or("ERR_BAD_BLOCKHASH")?;
        let to = decode32(&self.to).ok_or("ERR_BAD_ADDRESS")?;
        if to == SYSTEM_PROGRAM {
            return Err("ERR_BAD_ADDRESS".into());
        }
        if self.lamports.0 == 0 {
            return Err("ERR_AMOUNT_ZERO".into());
        }

        // Accounts: the vault (signer, writable), the recipient (writable, unless it is the
        // vault itself), then the system program (read-only).
        let self_transfer = to == *from;
        let mut keys: Vec<[u8; 32]> = vec![*from];
        if !self_transfer {
            keys.push(to);
        }
        keys.push(SYSTEM_PROGRAM);

        let mut m = vec![1, 0, 1]; // 1 signature; 0 read-only signers; 1 read-only non-signer
        m.extend(compact_u16(keys.len()));
        for k in &keys {
            m.extend_from_slice(k);
        }
        m.extend_from_slice(&blockhash);
        m.extend(compact_u16(1)); // exactly one instruction
        m.push((keys.len() - 1) as u8); // program: the system program
        m.extend(compact_u16(2));
        m.push(0);
        m.push(if self_transfer { 0 } else { 1 });
        let mut data = TRANSFER.to_le_bytes().to_vec();
        data.extend_from_slice(&self.lamports.0.to_le_bytes());
        m.extend(compact_u16(data.len()));
        m.extend(data);
        Ok(m)
    }
}

/// The wire transaction: one signature, then the message.
pub fn signed_raw(message: &[u8], signature: &[u8; 64]) -> Vec<u8> {
    let mut out = compact_u16(1);
    out.extend_from_slice(signature);
    out.extend_from_slice(message);
    out
}

/// The vault's 32-byte Ed25519 key from its NEAR-style `ed25519:…` derived key.
pub fn vault_key(key: &str) -> Result<[u8; 32], String> {
    let pk = PublicKey::from_str(key).map_err(|_| "ERR_BAD_DERIVED_KEY".to_string())?;
    let raw = pk.as_bytes();
    // First byte is the curve type (0 = ed25519).
    if raw.first() != Some(&0) || raw.len() != 33 {
        return Err("ERR_BAD_DERIVED_KEY".into());
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&raw[1..]);
    Ok(out)
}

/// A Solana address is the base58 of the Ed25519 key.
pub fn address(key: &[u8; 32]) -> String {
    bs58::encode(key).into_string()
}

pub fn verify(signature: &[u8; 64], message: &[u8], key: &[u8; 32]) -> bool {
    env::ed25519_verify(signature, message, key)
}

fn decode32(s: &str) -> Option<[u8; 32]> {
    bs58::decode(s).into_vec().ok()?.try_into().ok()
}

/// Solana's "shortvec" length: 7 bits per byte, low bits first.
fn compact_u16(n: usize) -> Vec<u8> {
    let mut n = n as u16;
    let mut out = Vec::with_capacity(3);
    loop {
        let byte = (n & 0x7f) as u8;
        n >>= 7;
        if n == 0 {
            out.push(byte);
            return out;
        }
        out.push(byte | 0x80);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FROM: &str = "Dgx8782F7YJYYYYsKuk1uhdyPbvnu2DNRFrfKKGKgUKn";
    const TO: &str = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
    const HASH: &str = "3SPUWvuNQALMPKUaABs4CjQ3X8H8TfRWcb8gcXd7nUoE";

    fn params(to: &str, lamports: u64) -> SolWithdrawParams {
        SolWithdrawParams {
            recent_blockhash: HASH.into(),
            to: to.into(),
            lamports: U64(lamports),
        }
    }

    #[test]
    fn compact_u16_vectors() {
        // From the Solana docs: 0x7f, 0x80, 0x3fff, 0x4000.
        assert_eq!(compact_u16(0x7f), vec![0x7f]);
        assert_eq!(compact_u16(0x80), vec![0x80, 0x01]);
        assert_eq!(compact_u16(0x3fff), vec![0xff, 0x7f]);
        assert_eq!(compact_u16(0x4000), vec![0x80, 0x80, 0x01]);
    }

    #[test]
    fn sol_single_transfer_only() {
        let from = decode32(FROM).unwrap();
        let m = params(TO, 1_000_000).message(&from).unwrap();
        assert_eq!(&m[..4], &[1, 0, 1, 3]); // header, three accounts
        assert_eq!(&m[4..36], &from);
        assert_eq!(&m[36..68], &decode32(TO).unwrap());
        assert_eq!(&m[68..100], &SYSTEM_PROGRAM);
        assert_eq!(&m[100..132], &decode32(HASH).unwrap());
        // One instruction: program 2, accounts [0, 1], data = Transfer(1_000_000).
        assert_eq!(&m[132..138], &[1, 2, 2, 0, 1, 12]);
        assert_eq!(&m[138..142], &TRANSFER.to_le_bytes());
        assert_eq!(&m[142..], &1_000_000u64.to_le_bytes());
    }

    #[test]
    fn self_transfer_lists_the_vault_once() {
        let from = decode32(FROM).unwrap();
        let m = params(FROM, 5).message(&from).unwrap();
        assert_eq!(&m[..4], &[1, 0, 1, 2]);
        assert_eq!(&m[100..106], &[1, 1, 2, 0, 0, 12]);
    }

    #[test]
    fn rejects_bad_params() {
        let from = decode32(FROM).unwrap();
        let err = |p: SolWithdrawParams| p.message(&from).unwrap_err();
        assert_eq!(err(params("11111111111111111111111111111111", 1)), "ERR_BAD_ADDRESS");
        assert_eq!(err(params("0xnotbase58", 1)), "ERR_BAD_ADDRESS");
        assert_eq!(err(params("3QJmV3qfvL9SuYo34YihAf3sRCW3qSinyC", 1)), "ERR_BAD_ADDRESS");
        assert_eq!(err(params(TO, 0)), "ERR_AMOUNT_ZERO");
        let mut p = params(TO, 1);
        p.recent_blockhash = "short".into();
        assert_eq!(err(p), "ERR_BAD_BLOCKHASH");
    }

    #[test]
    fn vault_key_round_trips_to_its_address() {
        let key = format!("ed25519:{FROM}");
        assert_eq!(address(&vault_key(&key).unwrap()), FROM);
        assert!(vault_key("secp256k1:4NfTiv3UsGahebgTaHyD9vF8KYKMBnfd6kh94mK6xv8fGBiJB8TBtFMP5WWXz6B89Ac1fbpzPwAvoyQebemHFwx3").is_err());
    }
}
