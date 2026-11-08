use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::json_types::U64;
use near_sdk::serde_json::{self, json};
use near_sdk::{env, near, require, Gas, NearToken, Promise};

use crate::mpc::{encode_hex, parse_response, Payload, SignArgs, SignRequest, SignatureResponse};
use crate::solana::{self, SolWithdrawParams};
use crate::vault::{vault_path, ChainTag};
use crate::withdraw_evm::{
    Withdrawal, WithdrawalParams, WithdrawalStatus, GAS_FOR_SIGN, GAS_MARGIN,
    MAX_SIGNATURE_RESPONSE,
};
use crate::{events, withdrawal_key, Contract, ContractExt};

/// Gas reserved for the Solana callback (one Ed25519 check, then assembly).
pub const GAS_FOR_SOL_CALLBACK: Gas = Gas::from_tgas(15);
/// The callback stores the signed transaction as hex: ≈ 215 bytes, doubled.
const SIGNED_BYTES: u64 = 440;

#[near]
impl Contract {
    /// Withdraws SOL from an **opened** vault with one SystemProgram transfer.
    ///
    /// Caller: the owner. Deposit: `withdraw_deposit + mpc_sign_deposit`. Gas: ≥ 45 Tgas.
    /// Builds the legacy message (the vault pays the fee), asks the MPC signer for an Ed25519
    /// signature over it, and the callback checks that signature against the vault's key.
    /// `recent_blockhash` must be fresh: a signed transaction expires with it, and a new
    /// withdrawal simply uses a newer one.
    /// Fails: `ERR_DEPOSIT`, `ERR_GAS`, `ERR_NOT_OWNER`, `ERR_VAULT_SEALED`, `ERR_KEYS_PENDING`,
    /// `ERR_BAD_BLOCKHASH`, `ERR_BAD_ADDRESS`, `ERR_AMOUNT_ZERO`.
    #[payable]
    pub fn withdraw_sol(&mut self, token_id: TokenId, params: SolWithdrawParams) -> Promise {
        // 1. Deposit and gas first, before touching state.
        let required = self
            .config
            .withdraw_deposit
            .saturating_add(self.config.mpc_sign_deposit);
        require!(env::attached_deposit() >= required, "ERR_DEPOSIT");
        require!(
            env::prepaid_gas()
                >= GAS_FOR_SIGN
                    .saturating_add(GAS_FOR_SOL_CALLBACK)
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
        // 4. Parameters (T7): one transfer, recent blockhash, nothing else.
        let from = solana::vault_key(&keys.sol).unwrap_or_else(|e| env::panic_str(&e));
        let message = params
            .message(&from)
            .unwrap_or_else(|e| env::panic_str(&e));

        let path = vault_path(&token_id, ChainTag::Sol);
        let index = vault.withdrawal_count;
        vault.withdrawal_count += 1;
        vault.signatures_requested += 1;
        self.vaults.insert(&token_id, &vault);

        let before = env::storage_usage();
        let record = Withdrawal {
            index,
            params: WithdrawalParams::Sol(params),
            path: path.clone(),
            // The signer signs the message itself; its SHA-256 identifies it here, and the
            // message is part of `signed_raw_tx` once signed.
            payload_hashes: vec![encode_hex(&env::sha256_array(&message))],
            signed_raw_tx: None,
            status: WithdrawalStatus::Pending,
            error: None,
            requested_at_ns: U64(env::block_timestamp()),
        };
        self.withdrawals
            .insert(&withdrawal_key(&token_id, index), &record);
        let used = env::storage_usage() - before + SIGNED_BYTES;
        require!(
            env::storage_byte_cost().saturating_mul(used as u128) <= self.config.withdraw_deposit,
            "ERR_WITHDRAW_DEPOSIT_BELOW_STORAGE"
        );

        events::emit(
            "withdrawal_requested",
            json!({ "token_id": token_id, "index": index, "chain": "sol", "payload_hash": record.payload_hashes[0] }),
        );

        let args = SignArgs {
            request: SignRequest {
                path,
                payload_v2: Payload::Eddsa(encode_hex(&message)),
                domain_id: ChainTag::Sol.domain_id(),
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
                    .with_static_gas(GAS_FOR_SOL_CALLBACK)
                    .with_attached_deposit(NearToken::from_yoctonear(0))
                    .on_sol_signed(token_id, index),
            )
    }

    /// Never panics: every failure ends as `Failed` with a reason (T9). The vault stays opened.
    #[private]
    pub fn on_sol_signed(&mut self, token_id: TokenId, index: u32) {
        let Some(record) = self.withdrawals.get(&withdrawal_key(&token_id, index)) else {
            return;
        };
        let Some(vault) = self.vaults.get(&token_id) else {
            return;
        };

        let outcome = (|| -> Result<String, String> {
            let WithdrawalParams::Sol(params) = &record.params else {
                return Err("ERR_WRONG_CHAIN".to_string());
            };
            let keys = vault.keys.as_ref().ok_or("ERR_KEYS_PENDING")?;
            let from = solana::vault_key(&keys.sol)?;
            let message = params.message(&from)?;
            let bytes = env::promise_result_checked(0, MAX_SIGNATURE_RESPONSE)
                .map_err(|_| "ERR_SIGNER_FAILED".to_string())?;
            let SignatureResponse::Ed25519 { signature } = parse_response(&bytes)? else {
                return Err("ERR_WRONG_SCHEME".to_string());
            };
            let signature: [u8; 64] = signature
                .try_into()
                .map_err(|_| "ERR_BAD_SIGNATURE_RESPONSE".to_string())?;
            // T17: the signature must be the vault's own key over exactly this message.
            if !solana::verify(&signature, &message, &from) {
                return Err("ERR_SIGNATURE_WRONG_KEY".to_string());
            }
            Ok(encode_hex(&solana::signed_raw(&message, &signature)))
        })();

        self.settle_withdrawal(&token_id, index, record, outcome);
    }
}
