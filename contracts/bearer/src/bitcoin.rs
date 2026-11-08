//! Bitcoin P2WPKH spends, encoded by hand: BIP143 sighashes, segwit serialization and
//! bech32/bech32m addresses. Exactly one shape exists (T7): inputs from the vault's own
//! P2WPKH address, SIGHASH_ALL, one payment output and change back to the same address.

use near_sdk::env;
use near_sdk::json_types::U64;
use near_sdk::near;

use crate::mpc::{decode_hex, secp256k1_key_bytes, EcdsaSignature};

/// Testnet4 (like testnet3 and signet) addresses start `tb1`. Mainnet `bc1` is refused.
pub const HRP: &str = "tb";
const MAINNET_HRP: &str = "bc";
const VERSION: u32 = 2;
/// Opt-in replace-by-fee, so a stuck withdrawal can be re-signed with a higher fee (brief 4.9).
const SEQUENCE: u32 = 0xffff_fffd;
const LOCKTIME: u32 = 0;
/// The only sighash type ever signed.
const SIGHASH_ALL: u8 = 0x01;
/// Bitcoin Core's dust limits at the default relay fee: P2WPKH outputs, then all others.
const DUST_P2WPKH: u64 = 294;
const DUST_OTHER: u64 = 330;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct BtcInput {
    /// Transaction id as explorers show it (big-endian hex).
    pub txid: String,
    pub vout: u32,
    pub value_sat: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct BtcWithdrawParams {
    /// Coins at the vault's own address. Their values are committed to by every signature.
    pub inputs: Vec<BtcInput>,
    /// `tb1…`, bech32 (segwit v0) or bech32m (v1+).
    pub to_address: String,
    pub amount_sat: U64,
    pub fee_sat: U64,
}

struct Outpoint {
    /// Internal byte order (reversed from how explorers show it).
    txid: [u8; 32],
    vout: u32,
    value: u64,
}

struct TxOut {
    value: u64,
    script: Vec<u8>,
}

/// A validated spend, ready to hash and, once signed, to serialize.
pub struct BtcSpend {
    inputs: Vec<Outpoint>,
    outputs: Vec<TxOut>,
    pubkey: [u8; 33],
    pubkey_hash: [u8; 20],
}

impl BtcWithdrawParams {
    /// Checks the parameters against the vault's key and builds the spend. Never panics, so the
    /// callback can rebuild it safely.
    pub fn build(&self, pubkey: [u8; 33], max_inputs: u8) -> Result<BtcSpend, String> {
        if self.inputs.is_empty() {
            return Err("ERR_NO_INPUTS".into());
        }
        if self.inputs.len() > max_inputs as usize {
            return Err("ERR_TOO_MANY_INPUTS".into());
        }
        let mut inputs: Vec<Outpoint> = Vec::with_capacity(self.inputs.len());
        let mut total: u64 = 0;
        for input in &self.inputs {
            let mut txid: [u8; 32] = decode_hex(&input.txid)
                .ok()
                .and_then(|b| b.try_into().ok())
                .ok_or("ERR_BAD_TXID")?;
            txid.reverse();
            if inputs.iter().any(|o| o.txid == txid && o.vout == input.vout) {
                return Err("ERR_DUPLICATE_INPUT".into());
            }
            if input.value_sat.0 == 0 {
                return Err("ERR_BAD_INPUT_VALUE".into());
            }
            total = total
                .checked_add(input.value_sat.0)
                .ok_or("ERR_VALUE_OVERFLOW")?;
            inputs.push(Outpoint {
                txid,
                vout: input.vout,
                value: input.value_sat.0,
            });
        }

        let to_script = output_script(&self.to_address)?;
        let dust = if to_script.len() == 22 && to_script[0] == 0 {
            DUST_P2WPKH
        } else {
            DUST_OTHER
        };
        if self.amount_sat.0 < dust {
            return Err("ERR_AMOUNT_BELOW_DUST".into());
        }
        if self.fee_sat.0 == 0 {
            return Err("ERR_FEE_TOO_LOW".into());
        }
        let spent = self
            .amount_sat
            .0
            .checked_add(self.fee_sat.0)
            .ok_or("ERR_VALUE_OVERFLOW")?;
        let change = total
            .checked_sub(spent)
            .ok_or("ERR_INSUFFICIENT_INPUTS")?;

        let pubkey_hash = hash160(&pubkey);
        let mut outputs = vec![TxOut {
            value: self.amount_sat.0,
            script: to_script,
        }];
        if change > 0 {
            if change < DUST_P2WPKH {
                return Err("ERR_CHANGE_BELOW_DUST".into());
            }
            // Change only ever goes back to the vault's own address.
            outputs.push(TxOut {
                value: change,
                script: p2wpkh_script(&pubkey_hash),
            });
        }
        Ok(BtcSpend {
            inputs,
            outputs,
            pubkey,
            pubkey_hash,
        })
    }
}

impl BtcSpend {
    /// BIP143 SIGHASH_ALL digest per input: the 32 bytes the MPC signs, in input order.
    pub fn sighashes(&self) -> Vec<[u8; 32]> {
        let mut prevouts = Vec::with_capacity(36 * self.inputs.len());
        let mut sequences = Vec::with_capacity(4 * self.inputs.len());
        for o in &self.inputs {
            prevouts.extend_from_slice(&o.txid);
            prevouts.extend_from_slice(&o.vout.to_le_bytes());
            sequences.extend_from_slice(&SEQUENCE.to_le_bytes());
        }
        let hash_prevouts = sha256d(&prevouts);
        let hash_sequence = sha256d(&sequences);
        let hash_outputs = sha256d(&self.outputs_bytes());
        let script_code = p2wpkh_script_code(&self.pubkey_hash);
        self.inputs
            .iter()
            .map(|o| {
                bip143_digest(&Bip143 {
                    version: VERSION,
                    hash_prevouts,
                    hash_sequence,
                    txid: o.txid,
                    vout: o.vout,
                    script_code: &script_code,
                    value: o.value,
                    sequence: SEQUENCE,
                    hash_outputs,
                    locktime: LOCKTIME,
                })
            })
            .collect()
    }

    /// The segwit transaction with one `[signature, pubkey]` witness per input, ready to broadcast.
    pub fn signed_raw(&self, sigs: &[EcdsaSignature]) -> Vec<u8> {
        let mut out = Vec::with_capacity(16 + 150 * self.inputs.len());
        out.extend_from_slice(&VERSION.to_le_bytes());
        out.extend_from_slice(&[0x00, 0x01]); // segwit marker and flag
        out.extend(varint(self.inputs.len() as u64));
        for o in &self.inputs {
            out.extend_from_slice(&o.txid);
            out.extend_from_slice(&o.vout.to_le_bytes());
            out.push(0x00); // empty scriptSig: P2WPKH puts everything in the witness
            out.extend_from_slice(&SEQUENCE.to_le_bytes());
        }
        out.extend(varint(self.outputs.len() as u64));
        out.extend(self.outputs_bytes());
        for sig in sigs {
            let mut der = der_signature(sig);
            der.push(SIGHASH_ALL);
            out.push(0x02); // two witness items
            out.extend(varint(der.len() as u64));
            out.extend(der);
            out.push(33);
            out.extend_from_slice(&self.pubkey);
        }
        out.extend_from_slice(&LOCKTIME.to_le_bytes());
        out
    }

    /// Serialized outputs without their count: what BIP143's hashOutputs covers.
    fn outputs_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(43 * self.outputs.len());
        for o in &self.outputs {
            out.extend_from_slice(&o.value.to_le_bytes());
            out.extend(varint(o.script.len() as u64));
            out.extend_from_slice(&o.script);
        }
        out
    }
}

/* ---------- keys and scripts ---------- */

/// The vault's compressed key from its NEAR-style `secp256k1:…` derived key.
pub fn vault_pubkey(key: &str) -> Result<[u8; 33], String> {
    let raw = secp256k1_key_bytes(key)?;
    let mut out = [0u8; 33];
    out[0] = if raw[63] & 1 == 0 { 0x02 } else { 0x03 };
    out[1..].copy_from_slice(&raw[..32]);
    Ok(out)
}

/// The vault's `tb1q…` address.
pub fn p2wpkh_address(pubkey: &[u8; 33]) -> String {
    encode_segwit(HRP, 0, &hash160(pubkey))
}

pub fn hash160(data: &[u8]) -> [u8; 20] {
    env::ripemd160_array(env::sha256_array(data))
}

fn sha256d(data: &[u8]) -> [u8; 32] {
    env::sha256_array(env::sha256_array(data))
}

fn p2wpkh_script(pubkey_hash: &[u8; 20]) -> Vec<u8> {
    let mut s = vec![0x00, 0x14];
    s.extend_from_slice(pubkey_hash);
    s
}

/// BIP143 scriptCode for P2WPKH (length-prefixed P2PKH script).
fn p2wpkh_script_code(pubkey_hash: &[u8; 20]) -> Vec<u8> {
    let mut s = vec![0x19, 0x76, 0xa9, 0x14];
    s.extend_from_slice(pubkey_hash);
    s.extend_from_slice(&[0x88, 0xac]);
    s
}

/// scriptPubKey for a testnet segwit address.
fn output_script(address: &str) -> Result<Vec<u8>, String> {
    let (hrp, version, program) = decode_segwit(address)?;
    if hrp == MAINNET_HRP {
        return Err("ERR_WRONG_NETWORK".into());
    }
    if hrp != HRP {
        return Err("ERR_BAD_ADDRESS".into());
    }
    let mut script = vec![if version == 0 { 0x00 } else { 0x50 + version }];
    script.push(program.len() as u8);
    script.extend(program);
    Ok(script)
}

fn varint(n: u64) -> Vec<u8> {
    match n {
        0..=0xfc => vec![n as u8],
        0xfd..=0xffff => {
            let mut v = vec![0xfd];
            v.extend_from_slice(&(n as u16).to_le_bytes());
            v
        }
        0x1_0000..=0xffff_ffff => {
            let mut v = vec![0xfe];
            v.extend_from_slice(&(n as u32).to_le_bytes());
            v
        }
        _ => {
            let mut v = vec![0xff];
            v.extend_from_slice(&n.to_le_bytes());
            v
        }
    }
}

/* ---------- BIP143 ---------- */

struct Bip143<'a> {
    version: u32,
    hash_prevouts: [u8; 32],
    hash_sequence: [u8; 32],
    txid: [u8; 32],
    vout: u32,
    script_code: &'a [u8],
    value: u64,
    sequence: u32,
    hash_outputs: [u8; 32],
    locktime: u32,
}

fn bip143_digest(p: &Bip143) -> [u8; 32] {
    let mut pre = Vec::with_capacity(160 + p.script_code.len());
    pre.extend_from_slice(&p.version.to_le_bytes());
    pre.extend_from_slice(&p.hash_prevouts);
    pre.extend_from_slice(&p.hash_sequence);
    pre.extend_from_slice(&p.txid);
    pre.extend_from_slice(&p.vout.to_le_bytes());
    pre.extend_from_slice(p.script_code);
    pre.extend_from_slice(&p.value.to_le_bytes());
    pre.extend_from_slice(&p.sequence.to_le_bytes());
    pre.extend_from_slice(&p.hash_outputs);
    pre.extend_from_slice(&p.locktime.to_le_bytes());
    pre.extend_from_slice(&(SIGHASH_ALL as u32).to_le_bytes());
    sha256d(&pre)
}

/* ---------- DER ---------- */

fn der_int(x: &[u8; 32]) -> Vec<u8> {
    let first = x.iter().position(|b| *b != 0).unwrap_or(31);
    let mut v = Vec::with_capacity(33);
    if x[first] & 0x80 != 0 {
        v.push(0x00);
    }
    v.extend_from_slice(&x[first..]);
    v
}

/// Strict DER (BIP66). `s` is already low (normalised in `verify_ecdsa`).
fn der_signature(sig: &EcdsaSignature) -> Vec<u8> {
    let r = der_int(&sig.r);
    let s = der_int(&sig.s);
    let mut out = vec![0x30, (4 + r.len() + s.len()) as u8, 0x02, r.len() as u8];
    out.extend(r);
    out.push(0x02);
    out.push(s.len() as u8);
    out.extend(s);
    out
}

/* ---------- bech32 / bech32m (BIP173, BIP350) ---------- */

const CHARSET: &[u8; 32] = b"qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_CONST: u32 = 1;
const BECH32M_CONST: u32 = 0x2bc8_30a3;

fn polymod(values: &[u8]) -> u32 {
    const GEN: [u32; 5] = [0x3b6a_57b2, 0x2650_8e6d, 0x1ea1_19fa, 0x3d42_33dd, 0x2a14_62b3];
    let mut chk: u32 = 1;
    for v in values {
        let top = chk >> 25;
        chk = ((chk & 0x1ff_ffff) << 5) ^ *v as u32;
        for (i, g) in GEN.iter().enumerate() {
            if (top >> i) & 1 == 1 {
                chk ^= g;
            }
        }
    }
    chk
}

fn hrp_expand(hrp: &str) -> Vec<u8> {
    let mut v: Vec<u8> = hrp.bytes().map(|c| c >> 5).collect();
    v.push(0);
    v.extend(hrp.bytes().map(|c| c & 31));
    v
}

fn convert_bits(data: &[u8], from: u32, to: u32, pad: bool) -> Option<Vec<u8>> {
    let mut acc: u32 = 0;
    let mut bits: u32 = 0;
    let max = (1u32 << to) - 1;
    let mut out = Vec::new();
    for v in data {
        if (*v as u32) >> from != 0 {
            return None;
        }
        acc = (acc << from) | *v as u32;
        bits += from;
        while bits >= to {
            bits -= to;
            out.push(((acc >> bits) & max) as u8);
        }
    }
    if pad {
        if bits > 0 {
            out.push(((acc << (to - bits)) & max) as u8);
        }
    } else if bits >= from || ((acc << (to - bits)) & max) != 0 {
        return None;
    }
    Some(out)
}

/// Decodes a segwit address into `(hrp, witness version, program)`, enforcing BIP350's
/// checksum variant per version.
pub fn decode_segwit(address: &str) -> Result<(String, u8, Vec<u8>), String> {
    let bad = || "ERR_BAD_ADDRESS".to_string();
    if address.len() < 8 || address.len() > 90 {
        return Err(bad());
    }
    let has_lower = address.bytes().any(|c| c.is_ascii_lowercase());
    let has_upper = address.bytes().any(|c| c.is_ascii_uppercase());
    if has_lower && has_upper {
        return Err(bad());
    }
    let address = address.to_ascii_lowercase();
    let sep = address.rfind('1').ok_or_else(bad)?;
    let (hrp, data) = (&address[..sep], &address[sep + 1..]);
    if hrp.is_empty() || data.len() < 7 || hrp.bytes().any(|c| !(33..=126).contains(&c)) {
        return Err(bad());
    }
    let values: Vec<u8> = data
        .bytes()
        .map(|c| CHARSET.iter().position(|x| *x == c).map(|p| p as u8))
        .collect::<Option<_>>()
        .ok_or_else(bad)?;
    let mut check = hrp_expand(hrp);
    check.extend_from_slice(&values);
    let constant = polymod(&check);
    let version = values[0];
    let program = convert_bits(&values[1..values.len() - 6], 5, 8, false).ok_or_else(bad)?;
    let valid = match version {
        0 => constant == BECH32_CONST && (program.len() == 20 || program.len() == 32),
        1..=16 => constant == BECH32M_CONST && (2..=40).contains(&program.len()),
        _ => false,
    };
    if !valid {
        return Err(bad());
    }
    Ok((hrp.to_string(), version, program))
}

pub fn encode_segwit(hrp: &str, version: u8, program: &[u8]) -> String {
    let mut data = vec![version];
    data.extend(convert_bits(program, 8, 5, true).unwrap_or_default());
    let mut check = hrp_expand(hrp);
    check.extend_from_slice(&data);
    check.extend_from_slice(&[0; 6]);
    let constant = if version == 0 { BECH32_CONST } else { BECH32M_CONST };
    let pm = polymod(&check) ^ constant;
    data.extend((0..6).map(|i| ((pm >> (5 * (5 - i))) & 31) as u8));
    let mut out = String::with_capacity(hrp.len() + 1 + data.len());
    out.push_str(hrp);
    out.push('1');
    out.extend(data.iter().map(|d| CHARSET[*d as usize] as char));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mpc::encode_hex;

    fn h<const N: usize>(s: &str) -> [u8; N] {
        decode_hex(s).unwrap().try_into().unwrap()
    }

    #[test]
    fn bip143_native_p2wpkh_vector() {
        // BIP143 "Native P2WPKH" example, input 1.
        let prevouts = decode_hex(concat!(
            "fff7f7881a8099afa6940d42d1e7f6362bec38171ea3edf433541db4e4ad969f00000000",
            "ef51e1b804cc89d182d279655c3aa89e815b1b309fe287d9b2b55d57b90ec68a01000000"
        ))
        .unwrap();
        let hash_prevouts = sha256d(&prevouts);
        assert_eq!(
            encode_hex(&hash_prevouts),
            "96b827c8483d4e9b96712b6713a7b68d6e8003a781feba36c31143470b4efd37"
        );
        let hash_sequence = sha256d(&decode_hex("eeffffffffffffff").unwrap());
        assert_eq!(
            encode_hex(&hash_sequence),
            "52b0a642eea2fb7ae638c36f6252b6750293dbe574a806984b8e4d8548339a3b"
        );
        let hash_outputs = sha256d(
            &decode_hex(concat!(
                "202cb206000000001976a9148280b37df378db99f66f85c95a783a76ac7a6d5988ac",
                "9093510d000000001976a9143bde42dbee7e4dbe6a21b2d50ce2f0167faa815988ac"
            ))
            .unwrap(),
        );
        assert_eq!(
            encode_hex(&hash_outputs),
            "863ef3e1a92afbfdb97f31ad0fc7683ee943e9abcf2501590ff8f6551f47e5e5"
        );
        let pubkey: [u8; 33] =
            h("025476c2e83188368da1ff3e292e7acafcdb3566bb0ad253f62fc70f07aeee6357");
        let pkh = hash160(&pubkey);
        assert_eq!(encode_hex(&pkh), "1d0f172a0ecb48aee1be1f2687d2963ae33f71a1");
        let digest = bip143_digest(&Bip143 {
            version: 1,
            hash_prevouts,
            hash_sequence,
            txid: h("ef51e1b804cc89d182d279655c3aa89e815b1b309fe287d9b2b55d57b90ec68a"),
            vout: 1,
            script_code: &p2wpkh_script_code(&pkh),
            value: 600_000_000,
            sequence: 0xffff_ffff,
            hash_outputs,
            locktime: 0x11,
        });
        assert_eq!(
            encode_hex(&digest),
            "c37af31116d1b27caf68aae9e3ac82f1477929014d5b917657d0eb49478cb670"
        );
    }

    #[test]
    fn hash160_of_generator_key() {
        // BIP173: the key behind tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx.
        let g: [u8; 33] = h("0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798");
        assert_eq!(encode_hex(&hash160(&g)), "751e76e8199196d454941c45d1b3a323f1433bd6");
        assert_eq!(p2wpkh_address(&g), "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx");
    }

    #[test]
    fn segwit_addresses() {
        let (hrp, v, p) = decode_segwit("tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx").unwrap();
        assert_eq!((hrp.as_str(), v), ("tb", 0));
        assert_eq!(encode_hex(&p), "751e76e8199196d454941c45d1b3a323f1433bd6");
        // BIP350 taproot testnet vector (bech32m).
        let (_, v, p) =
            decode_segwit("tb1pqqqqp399et2xygdj5xreqhjjvcmzhxw4aywxecjdzew6hylgvsesf3hn0c").unwrap();
        assert_eq!(v, 1);
        assert_eq!(
            encode_hex(&p),
            "000000c4a5cad46221b2a187905e5266362b99d5e91c6ce24d165dab93e86433"
        );
        // Upper case is fine; mixed case and a broken checksum are not.
        assert!(decode_segwit("TB1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KXPJZSX").is_ok());
        assert!(decode_segwit("tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzSX").is_err());
        assert!(decode_segwit("tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsy").is_err());
        // v0 with a bech32m checksum is invalid (BIP350).
        let v0m = {
            let mut d = vec![0u8];
            d.extend(convert_bits(&p[..20], 8, 5, true).unwrap());
            let mut c = hrp_expand("tb");
            c.extend(&d);
            c.extend([0; 6]);
            let pm = polymod(&c) ^ BECH32M_CONST;
            d.extend((0..6).map(|i| ((pm >> (5 * (5 - i))) & 31) as u8));
            format!("tb1{}", d.iter().map(|x| CHARSET[*x as usize] as char).collect::<String>())
        };
        assert!(decode_segwit(&v0m).is_err());
        // Mainnet is recognised and refused when building a script.
        assert_eq!(
            output_script("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4").unwrap_err(),
            "ERR_WRONG_NETWORK"
        );
        assert_eq!(
            encode_hex(&output_script("tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx").unwrap()),
            "0014751e76e8199196d454941c45d1b3a323f1433bd6"
        );
    }

    #[test]
    fn strict_der() {
        let mut r = [0u8; 32];
        r[0] = 0x80; // high bit set: needs a 0x00 pad
        let mut s = [0u8; 32];
        s[31] = 1; // leading zeros stripped
        let der = der_signature(&EcdsaSignature { r, s, recovery_id: 0 });
        assert_eq!(&der[..4], &[0x30, 4 + 33 + 1, 0x02, 33]);
        assert_eq!(der[4], 0x00);
        assert_eq!(&der[der.len() - 3..], &[0x02, 1, 1]);
    }

    fn params(inputs: &[(u64, u32)], amount: u64, fee: u64) -> BtcWithdrawParams {
        BtcWithdrawParams {
            inputs: inputs
                .iter()
                .map(|(v, vout)| BtcInput {
                    txid: "aa".repeat(32),
                    vout: *vout,
                    value_sat: U64(*v),
                })
                .collect(),
            to_address: "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx".into(),
            amount_sat: U64(amount),
            fee_sat: U64(fee),
        }
    }

    const KEY: &str = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";

    #[test]
    fn builds_payment_and_change_to_the_vault() {
        let spend = params(&[(10_000, 0), (5_000, 1)], 9_000, 500).build(h(KEY), 4).unwrap();
        assert_eq!(spend.outputs.len(), 2);
        assert_eq!(spend.outputs[1].value, 5_500);
        assert_eq!(spend.outputs[1].script, p2wpkh_script(&hash160(&h::<33>(KEY))));
        assert_eq!(spend.sighashes().len(), 2);
        // Spending everything leaves no change output.
        let exact = params(&[(10_000, 0)], 9_500, 500).build(h(KEY), 4).unwrap();
        assert_eq!(exact.outputs.len(), 1);
    }

    #[test]
    fn rejects_bad_spends() {
        let err = |p: BtcWithdrawParams| p.build(h(KEY), 4).err().unwrap();
        assert_eq!(err(params(&[], 1_000, 100)), "ERR_NO_INPUTS");
        assert_eq!(
            err(params(&[(1, 0), (1, 1), (1, 2), (1, 3), (1, 4)], 1_000, 100)),
            "ERR_TOO_MANY_INPUTS"
        );
        assert_eq!(err(params(&[(5_000, 0), (5_000, 0)], 1_000, 100)), "ERR_DUPLICATE_INPUT");
        assert_eq!(err(params(&[(5_000, 0)], 293, 100)), "ERR_AMOUNT_BELOW_DUST");
        assert_eq!(err(params(&[(5_000, 0)], 1_000, 0)), "ERR_FEE_TOO_LOW");
        assert_eq!(err(params(&[(5_000, 0)], 4_901, 100)), "ERR_INSUFFICIENT_INPUTS");
        assert_eq!(err(params(&[(5_000, 0)], 4_800, 100)), "ERR_CHANGE_BELOW_DUST");
        let mut p = params(&[(5_000, 0)], 1_000, 100);
        p.inputs[0].txid = "zz".into();
        assert_eq!(err(p), "ERR_BAD_TXID");
        let mut p = params(&[(5_000, 0)], 1_000, 100);
        p.to_address = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4".into();
        assert_eq!(err(p), "ERR_WRONG_NETWORK");
    }

    #[test]
    fn varints() {
        assert_eq!(varint(0xfc), vec![0xfc]);
        assert_eq!(varint(0xfd), vec![0xfd, 0xfd, 0x00]);
        assert_eq!(varint(0x1_0000), vec![0xfe, 0x00, 0x00, 0x01, 0x00]);
    }
}
