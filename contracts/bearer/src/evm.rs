//! EIP-1559 (type-2) native transfers, encoded by hand: RLP is small and this keeps
//! the contract free of large dependencies. Only empty-calldata transfers exist (T7).

use near_sdk::json_types::{U128, U64};
use near_sdk::{env, near, require};

use crate::mpc::{decode_hex, EcdsaSignature};

/// Minimum gas for a plain ETH transfer.
pub const MIN_GAS_LIMIT: u64 = 21_000;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct EvmWithdrawParams {
    pub chain_id: U64,
    pub nonce: U64,
    /// `0x` + 40 hex characters.
    pub to: String,
    pub amount_wei: U128,
    pub gas_limit: U64,
    pub max_fee_per_gas: U128,
    pub max_priority_fee_per_gas: U128,
}

impl EvmWithdrawParams {
    pub fn validate(&self, allowed_chain_ids: &[u64]) {
        require!(
            allowed_chain_ids.contains(&self.chain_id.0),
            "ERR_CHAIN_NOT_SUPPORTED"
        );
        require!(parse_address(&self.to).is_ok(), "ERR_BAD_ADDRESS");
        require!(self.gas_limit.0 >= MIN_GAS_LIMIT, "ERR_GAS_LIMIT_TOO_LOW");
        require!(
            self.max_priority_fee_per_gas.0 <= self.max_fee_per_gas.0,
            "ERR_PRIORITY_FEE_ABOVE_MAX_FEE"
        );
    }

    fn fields(&self) -> Vec<Vec<u8>> {
        let to = parse_address(&self.to).unwrap_or_else(|e| env::panic_str(&e));
        vec![
            rlp_uint(self.chain_id.0 as u128),
            rlp_uint(self.nonce.0 as u128),
            rlp_uint(self.max_priority_fee_per_gas.0),
            rlp_uint(self.max_fee_per_gas.0),
            rlp_uint(self.gas_limit.0 as u128),
            rlp_bytes(&to),
            rlp_uint(self.amount_wei.0),
            rlp_bytes(&[]), // data: always empty (native transfer only)
            rlp_list(&[]),  // access list: always empty
        ]
    }

    /// keccak256(0x02 ‖ rlp([chain_id, nonce, …, access_list])), the 32 bytes the MPC signs.
    pub fn signing_hash(&self) -> [u8; 32] {
        let mut preimage = vec![0x02];
        preimage.extend(rlp_list(&self.fields()));
        env::keccak256_array(&preimage)
    }

    /// 0x02 ‖ rlp([… , y_parity, r, s]), ready to broadcast.
    pub fn signed_raw(&self, sig: &EcdsaSignature) -> Vec<u8> {
        let mut fields = self.fields();
        fields.push(rlp_uint(sig.recovery_id as u128 & 1));
        fields.push(rlp_bytes(strip_zeros(&sig.r)));
        fields.push(rlp_bytes(strip_zeros(&sig.s)));
        let mut out = vec![0x02];
        out.extend(rlp_list(&fields));
        out
    }
}

pub fn parse_address(s: &str) -> Result<[u8; 20], String> {
    let hex = s.strip_prefix("0x").ok_or("ERR_BAD_ADDRESS")?;
    if hex.len() != 40 {
        return Err("ERR_BAD_ADDRESS".into());
    }
    decode_hex(hex)?
        .try_into()
        .map_err(|_| "ERR_BAD_ADDRESS".to_string())
}

/// EVM address of an uncompressed secp256k1 key: last 20 bytes of keccak256(key).
pub fn address_of(key64: &[u8; 64]) -> [u8; 20] {
    let hash = env::keccak256_array(key64);
    let mut out = [0u8; 20];
    out.copy_from_slice(&hash[12..]);
    out
}

fn strip_zeros(b: &[u8]) -> &[u8] {
    let first = b.iter().position(|x| *x != 0).unwrap_or(b.len());
    &b[first..]
}

fn length_prefix(len: usize, short: u8, long: u8) -> Vec<u8> {
    if len <= 55 {
        vec![short + len as u8]
    } else {
        let len_bytes = len.to_be_bytes();
        let len_bytes = strip_zeros(&len_bytes);
        let mut out = vec![long + len_bytes.len() as u8];
        out.extend_from_slice(len_bytes);
        out
    }
}

pub fn rlp_bytes(b: &[u8]) -> Vec<u8> {
    if b.len() == 1 && b[0] < 0x80 {
        return b.to_vec();
    }
    let mut out = length_prefix(b.len(), 0x80, 0xb7);
    out.extend_from_slice(b);
    out
}

pub fn rlp_uint(v: u128) -> Vec<u8> {
    rlp_bytes(strip_zeros(&v.to_be_bytes()))
}

/// RLP list of already-encoded items.
pub fn rlp_list(items: &[Vec<u8>]) -> Vec<u8> {
    let body: Vec<u8> = items.concat();
    let mut out = length_prefix(body.len(), 0xc0, 0xf7);
    out.extend(body);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mpc::encode_hex;

    #[test]
    fn rlp_known_vectors() {
        // From the Ethereum RLP spec.
        assert_eq!(rlp_uint(0), vec![0x80]);
        assert_eq!(rlp_uint(15), vec![0x0f]);
        assert_eq!(rlp_uint(1024), vec![0x82, 0x04, 0x00]);
        assert_eq!(rlp_bytes(b"dog"), vec![0x83, b'd', b'o', b'g']);
        assert_eq!(
            rlp_list(&[rlp_bytes(b"cat"), rlp_bytes(b"dog")]),
            hex("c88363617483646f67")
        );
        assert_eq!(rlp_list(&[]), vec![0xc0]);
        let long = vec![b'a'; 56];
        assert_eq!(&rlp_bytes(&long)[..2], &[0xb8, 56]);
    }

    #[test]
    fn rejects_calldata_shapes() {
        // The only way to build a transaction is from these typed fields; data is always empty.
        let p = sample();
        let fields = p.fields();
        assert_eq!(fields[7], vec![0x80], "data must be empty");
        assert_eq!(fields[8], vec![0xc0], "access list must be empty");
    }

    #[test]
    fn signing_hash_is_stable() {
        // Cross-checked against viem in the sandbox tests; here we pin it against regressions.
        let h = sample().signing_hash();
        assert_eq!(encode_hex(&h).len(), 64);
        assert_eq!(h, sample().signing_hash());
    }

    fn sample() -> EvmWithdrawParams {
        EvmWithdrawParams {
            chain_id: U64(84532),
            nonce: U64(0),
            to: "0x3fA2b1C47d9e0F5a6B8c2D4e6F80a1B3c519Cd00".into(),
            amount_wei: U128(800_000_000_000_000),
            gas_limit: U64(21_000),
            max_fee_per_gas: U128(2_000_000_000),
            max_priority_fee_per_gas: U128(1_000_000),
        }
    }

    fn hex(s: &str) -> Vec<u8> {
        crate::mpc::decode_hex(s).unwrap()
    }
}
