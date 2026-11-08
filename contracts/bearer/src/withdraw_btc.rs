use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::json_types::U64;
use near_sdk::serde_json::{self, json};
use near_sdk::{env, near, require, Gas, NearToken, Promise};

use crate::bitcoin::{vault_pubkey, BtcWithdrawParams};
use crate::mpc::{encode_hex, parse_response, verify_ecdsa, Payload, SignArgs, SignRequest};
use crate::vault::{vault_path, ChainTag};
use crate::withdraw_evm::{
    Withdrawal, WithdrawalParams, WithdrawalStatus, GAS_FOR_SIGN, GAS_MARGIN,
    MAX_SIGNATURE_RESPONSE,
};
use crate::{events, withdrawal_key, Contract, ContractExt};

/// Gas reserved for the Bitcoin callback: one signature check per input, then assembly.
pub const GAS_FOR_BTC_CALLBACK: Gas = Gas::from_tgas(30);
/// Storage the callback adds when it stores the signed transaction as hex: ≈ 150 bytes per
/// input (outpoint, sequence, witness) and ≈ 100 for version, outputs and locktime, doubled.
const SIGNED_BYTES_PER_INPUT: u64 = 320;
const SIGNED_BYTES_FIXED: u64 = 220;

#[near]
impl Contract {
    /// Withdraws bitcoin from an **opened** vault's P2WPKH address.
    ///
    /// Caller: the owner. Deposit: `withdraw_deposit + mpc_sign_deposit` per input (the record
    /// grows with each one). Gas: ≥ 15 Tgas per input + 45 Tgas.
    /// Spends 1..=`max_btc_inputs` of the vault's coins to `to_address`, with any change back to
    /// the vault's own address, SIGHASH_ALL only. One sign request per input, joined into a
    /// single callback that verifies every signature before assembling the transaction.
    /// Fails: `ERR_NO_INPUTS`, `ERR_TOO_MANY_INPUTS`, `ERR_DEPOSIT`, `ERR_GAS`, `ERR_NOT_OWNER`,
    /// `ERR_VAULT_SEALED`, `ERR_KEYS_PENDING`, `ERR_BAD_TXID`, `ERR_DUPLICATE_INPUT`,
    /// `ERR_BAD_ADDRESS`, `ERR_WRONG_NETWORK`, `ERR_AMOUNT_BELOW_DUST`, `ERR_FEE_TOO_LOW`,
    /// `ERR_INSUFFICIENT_INPUTS`, `ERR_CHANGE_BELOW_DUST`.
    #[payable]
    pub fn withdraw_btc(&mut self, token_id: TokenId, params: BtcWithdrawParams) -> Promise {
        let n = params.inputs.len();
        require!(n >= 1, "ERR_NO_INPUTS");
        require!(
            n <= self.config.max_btc_inputs as usize,
            "ERR_TOO_MANY_INPUTS"
        );
        // 1. Deposit and gas first, before touching state.
        let required = self
            .config
            .withdraw_deposit
            .saturating_add(self.config.mpc_sign_deposit)
            .saturating_mul(n as u128);
        require!(env::attached_deposit() >= required, "ERR_DEPOSIT");
        require!(
            env::prepaid_gas()
                >= GAS_FOR_SIGN
                    .saturating_mul(n as u64)
                    .saturating_add(GAS_FOR_BTC_CALLBACK)
                    .saturating_add(GAS_MARGIN),
            "ERR_GAS"
        );
        // 2. Owner, 3. opened (T1, T3).
        let mut vault = self.vault_for_owner(&token_id);
        require!(!vault.is_sealed(), "ERR_VAULT_SEALED");
        let keys = vault
            .keys
            .as_ref()
            .unwrap_or_else(|| env::panic_str("ERR_KEYS_PENDING"));
        // 4. Parameters: inputs, destination, amounts, change (T7).
        let pubkey = vault_pubkey(&keys.btc).unwrap_or_else(|e| env::panic_str(&e));
        let spend = params
            .build(pubkey, self.config.max_btc_inputs)
            .unwrap_or_else(|e| env::panic_str(&e));
        let hashes = spend.sighashes();

        let path = vault_path(&token_id, ChainTag::Btc);
        let index = vault.withdrawal_count;
        vault.withdrawal_count += 1;
        vault.signatures_requested += n as u32;
        self.vaults.insert(&token_id, &vault);

        let before = env::storage_usage();
        let record = Withdrawal {
            index,
            params: WithdrawalParams::Btc(params),
            path: path.clone(),
            payload_hashes: hashes.iter().map(|h| encode_hex(h)).collect(),
            signed_raw_tx: None,
            status: WithdrawalStatus::Pending,
            error: None,
            requested_at_ns: U64(env::block_timestamp()),
        };
        self.withdrawals
            .insert(&withdrawal_key(&token_id, index), &record);
        let used = env::storage_usage() - before
            + SIGNED_BYTES_FIXED
            + SIGNED_BYTES_PER_INPUT * n as u64;
        require!(
            env::storage_byte_cost().saturating_mul(used as u128)
                <= self.config.withdraw_deposit.saturating_mul(n as u128),
            "ERR_WITHDRAW_DEPOSIT_BELOW_STORAGE"
        );

        events::emit(
            "withdrawal_requested",
            json!({ "token_id": token_id, "index": index, "chain": "btc", "payload_hashes": record.payload_hashes }),
        );

        let sign = |hash: &[u8; 32]| {
            let args = SignArgs {
                request: SignRequest {
                    path: path.clone(),
                    payload_v2: Payload::Ecdsa(encode_hex(hash)),
                    domain_id: ChainTag::Btc.domain_id(),
                },
            };
            Promise::new(self.signer_id.clone()).function_call(
                "sign".to_string(),
                serde_json::to_vec(&args).unwrap_or_default(),
                self.config.mpc_sign_deposit,
                GAS_FOR_SIGN,
            )
        };
        // One request per input, joined so a single callback sees every signature.
        let joined = hashes[1..]
            .iter()
            .fold(sign(&hashes[0]), |all, hash| all.and(sign(hash)));
        joined.then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_FOR_BTC_CALLBACK)
                .with_attached_deposit(NearToken::from_yoctonear(0))
                .on_btc_signed(token_id, index),
        )
    }

    /// Never panics: every failure ends as `Failed` with a reason (T9). The vault stays opened.
    #[private]
    pub fn on_btc_signed(&mut self, token_id: TokenId, index: u32) {
        let Some(record) = self.withdrawals.get(&withdrawal_key(&token_id, index)) else {
            return;
        };
        let Some(vault) = self.vaults.get(&token_id) else {
            return;
        };
        let max_inputs = self.config.max_btc_inputs;

        let outcome = (|| -> Result<String, String> {
            let WithdrawalParams::Btc(params) = &record.params else {
                return Err("ERR_WRONG_CHAIN".to_string());
            };
            let keys = vault.keys.as_ref().ok_or("ERR_KEYS_PENDING")?;
            // Rebuilt from the stored parameters, so what is assembled is exactly what was hashed.
            let spend = params.build(vault_pubkey(&keys.btc)?, max_inputs)?;
            let hashes = spend.sighashes();
            if env::promise_results_count() as usize != hashes.len() {
                return Err("ERR_SIGNATURE_COUNT".to_string());
            }
            let mut sigs = Vec::with_capacity(hashes.len());
            for (i, hash) in hashes.iter().enumerate() {
                let bytes = env::promise_result_checked(i as u64, MAX_SIGNATURE_RESPONSE)
                    .map_err(|_| format!("ERR_SIGNER_FAILED: input {i}"))?;
                sigs.push(verify_ecdsa(hash, parse_response(&bytes)?, &keys.btc)?);
            }
            Ok(encode_hex(&spend.signed_raw(&sigs)))
        })();

        self.settle_withdrawal(&token_id, index, record, outcome);
    }
}
