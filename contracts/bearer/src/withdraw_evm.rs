use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::json_types::U64;
use near_sdk::serde_json::{self, json};
use near_sdk::{env, near, require, Gas, NearToken, Promise};

use crate::bitcoin::BtcWithdrawParams;
use crate::evm::EvmWithdrawParams;
use crate::mpc::{encode_hex, parse_response, verify_ecdsa, Payload, SignArgs, SignRequest};
use crate::vault::{vault_path, ChainTag};
use crate::{events, withdrawal_key, Contract, ContractExt};

/// Gas forwarded to the signer's `sign` (it needs ≥ 10 Tgas; 15 worked on testnet).
pub const GAS_FOR_SIGN: Gas = Gas::from_tgas(15);
/// Gas reserved for the EVM callback (verify, assemble, store). Static, so it can't run out.
pub const GAS_FOR_EVM_CALLBACK: Gas = Gas::from_tgas(20);
/// Head-room for the withdrawal call itself.
pub(crate) const GAS_MARGIN: Gas = Gas::from_tgas(15);

/// Upper bound on what a signer response can be.
pub(crate) const MAX_SIGNATURE_RESPONSE: usize = 512;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum WithdrawalStatus {
    Pending,
    Signed,
    Failed,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
#[serde(tag = "chain", rename_all = "snake_case")]
pub enum WithdrawalParams {
    // Borsh tags by position: append new chains, never reorder.
    Evm(EvmWithdrawParams),
    Btc(BtcWithdrawParams),
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Withdrawal {
    pub index: u32,
    pub params: WithdrawalParams,
    pub path: String,
    /// What was signed, one hex hash per request.
    pub payload_hashes: Vec<String>,
    /// Hex of the signed transaction. Public, so anyone can broadcast it.
    pub signed_raw_tx: Option<String>,
    pub status: WithdrawalStatus,
    pub error: Option<String>,
    pub requested_at_ns: U64,
}

#[near]
impl Contract {
    /// Withdraws native ETH from an **opened** vault on an allowlisted EVM chain.
    ///
    /// Caller: the owner. Deposit: `withdraw_deposit + mpc_sign_deposit`. Gas: ≥ 50 Tgas.
    /// Builds an EIP-1559 transfer with empty calldata; asks the MPC signer to sign its hash;
    /// the callback verifies and stores the signed transaction.
    /// Fails: `ERR_DEPOSIT`, `ERR_GAS`, `ERR_NOT_OWNER`, `ERR_VAULT_SEALED`, `ERR_KEYS_PENDING`,
    /// `ERR_CHAIN_NOT_SUPPORTED`, `ERR_BAD_ADDRESS`, `ERR_GAS_LIMIT_TOO_LOW`.
    #[payable]
    pub fn withdraw_evm(&mut self, token_id: TokenId, params: EvmWithdrawParams) -> Promise {
        // 1. Deposit and gas first, before touching state.
        let required = self
            .config
            .withdraw_deposit
            .saturating_add(self.config.mpc_sign_deposit);
        require!(env::attached_deposit() >= required, "ERR_DEPOSIT");
        require!(
            env::prepaid_gas()
                >= GAS_FOR_SIGN
                    .saturating_add(GAS_FOR_EVM_CALLBACK)
                    .saturating_add(GAS_MARGIN),
            "ERR_GAS"
        );
        // 2. Owner, 3. opened (T1, T3).
        let mut vault = self.vault_for_owner(&token_id);
        require!(!vault.is_sealed(), "ERR_VAULT_SEALED");
        require!(vault.keys.is_some(), "ERR_KEYS_PENDING");
        // 4. Parameters.
        params.validate(&self.config.evm_chain_ids);

        let hash = params.signing_hash();
        let path = vault_path(&token_id, ChainTag::Evm);
        let index = vault.withdrawal_count;
        vault.withdrawal_count += 1;
        vault.signatures_requested += 1;
        self.vaults.insert(&token_id, &vault);

        let before = env::storage_usage();
        let record = Withdrawal {
            index,
            params: WithdrawalParams::Evm(params),
            path: path.clone(),
            payload_hashes: vec![encode_hex(&hash)],
            signed_raw_tx: None,
            status: WithdrawalStatus::Pending,
            error: None,
            requested_at_ns: U64(env::block_timestamp()),
        };
        self.withdrawals
            .insert(&withdrawal_key(&token_id, index), &record);
        // The signed tx (≈ 120 bytes, stored as hex) is added by the callback.
        let used = env::storage_usage() - before + 400;
        require!(
            env::storage_byte_cost().saturating_mul(used as u128) <= self.config.withdraw_deposit,
            "ERR_WITHDRAW_DEPOSIT_BELOW_STORAGE"
        );

        events::emit(
            "withdrawal_requested",
            json!({ "token_id": token_id, "index": index, "chain": "evm", "payload_hash": encode_hex(&hash) }),
        );

        let args = SignArgs {
            request: SignRequest {
                path,
                payload_v2: Payload::Ecdsa(encode_hex(&hash)),
                domain_id: ChainTag::Evm.domain_id(),
            },
        };
        Promise::new(self.signer_id.clone())
            .function_call(
                "sign".to_string(),
                serde_json::to_vec(&args).unwrap_or_default(),
                self.config.mpc_sign_deposit,
                GAS_FOR_SIGN,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_EVM_CALLBACK)
                    .with_attached_deposit(NearToken::from_yoctonear(0))
                    .on_evm_signed(token_id, index),
            )
    }

    /// Never panics: every failure ends as `Failed` with a reason (T9). The vault stays opened.
    #[private]
    pub fn on_evm_signed(&mut self, token_id: TokenId, index: u32) {
        let Some(record) = self.withdrawals.get(&withdrawal_key(&token_id, index)) else {
            return;
        };
        let Some(vault) = self.vaults.get(&token_id) else {
            return;
        };

        let outcome = (|| -> Result<String, String> {
            let bytes = env::promise_result_checked(0, MAX_SIGNATURE_RESPONSE)
                .map_err(|_| "ERR_SIGNER_FAILED".to_string())?;
            let response = parse_response(&bytes)?;
            let WithdrawalParams::Evm(params) = &record.params else {
                return Err("ERR_WRONG_CHAIN".to_string());
            };
            let hash = params.signing_hash();
            let keys = vault.keys.as_ref().ok_or("ERR_KEYS_PENDING")?;
            let sig = verify_ecdsa(&hash, response, keys.get(ChainTag::Evm))?;
            Ok(encode_hex(&params.signed_raw(&sig)))
        })();

        self.settle_withdrawal(&token_id, index, record, outcome);
    }
}

impl Contract {
    /// Stores a callback's result: the signed transaction, or the reason it failed (T9).
    pub(crate) fn settle_withdrawal(
        &mut self,
        token_id: &TokenId,
        index: u32,
        mut record: Withdrawal,
        outcome: Result<String, String>,
    ) {
        match outcome {
            Ok(raw) => {
                record.status = WithdrawalStatus::Signed;
                record.signed_raw_tx = Some(raw);
                events::emit(
                    "withdrawal_signed",
                    json!({ "token_id": token_id, "index": index }),
                );
            }
            Err(error) => {
                record.status = WithdrawalStatus::Failed;
                events::emit(
                    "withdrawal_failed",
                    json!({ "token_id": token_id, "index": index, "error": error }),
                );
                record.error = Some(error);
            }
        }
        self.withdrawals
            .insert(&withdrawal_key(token_id, index), &record);
    }
}
