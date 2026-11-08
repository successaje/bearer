//! Bearer: a transferable sealed vault.
//!
//! A vault is an NEP-171 token that controls native Bitcoin, Base and Solana addresses
//! through NEAR Chain Signatures. It can change hands only while `Sealed`. Its owner can
//! break the seal (`Opened`, forever) and only then request withdrawal signatures.
//! See docs/THREAT_MODEL.md for the invariants (I1–I5) and threats (T1–T17).
#![allow(deprecated)] // near-contract-standards still uses near_sdk::collections

mod bitcoin;
mod events;
mod evm;
mod mpc;
mod seal;
mod solana;
mod transfer;
mod vault;
mod withdraw_btc;
mod withdraw_evm;
mod withdraw_sol;

pub use evm::EvmWithdrawParams;
pub use vault::{ChainTag, Custody, DerivedKeys, Finish, Vault, VaultState};
pub use withdraw_evm::{Withdrawal, WithdrawalParams, WithdrawalStatus};

use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;
use near_contract_standards::non_fungible_token::events::NftMint;
use near_contract_standards::non_fungible_token::metadata::{
    NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata, NFT_METADATA_SPEC,
};
use near_contract_standards::non_fungible_token::{NonFungibleToken, Token, TokenId};
use near_sdk::borsh::BorshSerialize;
use near_sdk::collections::{LazyOption, LookupMap};
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::json;
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise,
};

use crate::mpc::{secp256k1_key_bytes, DerivedKeyArgs};
use crate::vault::{vault_path, MAX_NAME_LEN};

/// Gas for one `derived_public_key` call to the signer. Measured 5.29–5.37 Tgas on
/// `v1.signer-prod.testnet` 3.18.0 (2026-11-08, contracts/tests/spike), so 5 was too tight.
const GAS_FOR_DERIVED_KEY: Gas = Gas::from_tgas(8);
/// Gas reserved for `on_derived_keys` (measured 2.03 Tgas).
const GAS_FOR_KEYS_CALLBACK: Gas = Gas::from_tgas(10);
/// `create_vault`'s own work (measured 4.69 Tgas) plus margin.
const GAS_FOR_CREATE: Gas = Gas::from_tgas(10);

/// Storage reserved at creation for state that grows later without a deposit:
/// 15 more custody entries (≤ 64-byte account + 8 + 4 each), three derived keys,
/// and the `Opened` state. `nft_transfer` and `break_seal` carry only 1 yoctoNEAR.
const RESERVED_BYTES: u64 = 15 * 80 + 3 * 100 + 90;

#[derive(BorshSerialize, BorshStorageKey)]
#[borsh(crate = "near_sdk::borsh")]
enum StorageKey {
    OwnerById,
    TokenMetadata,
    Enumeration,
    ContractMetadata,
    Vaults,
    Withdrawals,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Config {
    /// EVM chains the contract will sign for. Testnet: [84532] (Base Sepolia).
    pub evm_chain_ids: Vec<u64>,
    /// Upper bound on Bitcoin inputs per withdrawal (set from gas measurements).
    pub max_btc_inputs: u8,
    /// Attached to `create_vault`; covers the token, vault record and reserved growth.
    pub create_deposit: NearToken,
    /// Attached to each `withdraw_*`; covers one withdrawal record and its signed tx.
    pub withdraw_deposit: NearToken,
    /// Forwarded to the signer per sign request.
    pub mpc_sign_deposit: NearToken,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    tokens: NonFungibleToken,
    metadata: LazyOption<NFTContractMetadata>,
    signer_id: AccountId,
    next_token_id: u64,
    vaults: LookupMap<TokenId, Vault>,
    withdrawals: LookupMap<String, Withdrawal>,
    config: Config,
}

#[near(serializers = [json])]
pub struct Paths {
    pub btc: String,
    pub evm: String,
    pub sol: String,
}

#[near(serializers = [json])]
pub struct VaultView {
    pub token_id: TokenId,
    pub owner_id: AccountId,
    pub state: VaultState,
    pub signatures_requested: u32,
    pub withdrawal_count: u32,
    pub keys: Option<DerivedKeys>,
    /// `tb1q…` P2WPKH address derived from `keys.btc`, once keys are known.
    pub btc_address: Option<String>,
    /// `0x…` address derived from `keys.evm`, once keys are known.
    pub evm_address: Option<String>,
    /// Base58 Solana address (the Ed25519 key itself), once keys are known.
    pub sol_address: Option<String>,
    pub paths: Paths,
    pub custody: Vec<Custody>,
    pub created_at_ns: U64,
    pub name: Option<String>,
    pub finish: Finish,
}

#[near]
impl Contract {
    /// No owner, admin or upgrade methods exist (T11). `signer_id` and `config` are fixed here.
    #[init]
    /// `base_uri`: where wallets fetch each token's `media` (`{base_uri}/{token_id}.svg`), a page
    /// that draws the vault's current seal. Optional; without it tokens carry no media.
    pub fn new(signer_id: AccountId, config: Config, base_uri: Option<String>) -> Self {
        require!(config.max_btc_inputs > 0, "ERR_CONFIG");
        Self {
            tokens: NonFungibleToken::new(
                StorageKey::OwnerById,
                env::current_account_id(),
                Some(StorageKey::TokenMetadata),
                Some(StorageKey::Enumeration),
                None::<StorageKey>, // no NEP-178 approvals (T6)
            ),
            metadata: LazyOption::new(
                StorageKey::ContractMetadata,
                Some(&NFTContractMetadata {
                    spec: NFT_METADATA_SPEC.to_string(),
                    name: "Bearer vaults".to_string(),
                    symbol: "BEARER".to_string(),
                    icon: None,
                    base_uri,
                    reference: None,
                    reference_hash: None,
                }),
            ),
            signer_id,
            next_token_id: 1,
            vaults: LookupMap::new(StorageKey::Vaults),
            withdrawals: LookupMap::new(StorageKey::Withdrawals),
            config,
        }
    }

    /// Mints a sealed vault to the caller and asks the signer for its three derived keys.
    ///
    /// Deposit: exactly what `config.create_deposit` says (more is kept as storage reserve).
    /// Gas: at least 44 Tgas, so the three key requests and their callback can't run short.
    /// Fails: `ERR_DEPOSIT`, `ERR_GAS`, `ERR_NAME_TOO_LONG`.
    #[payable]
    pub fn create_vault(&mut self, name: Option<String>, finish: Finish) -> TokenId {
        require!(
            env::attached_deposit() >= self.config.create_deposit,
            "ERR_DEPOSIT"
        );
        require!(
            env::prepaid_gas()
                >= GAS_FOR_DERIVED_KEY
                    .saturating_mul(3)
                    .saturating_add(GAS_FOR_KEYS_CALLBACK)
                    .saturating_add(GAS_FOR_CREATE),
            "ERR_GAS"
        );
        let name = name.map(|n| n.trim().to_string()).filter(|n| !n.is_empty());
        if let Some(n) = &name {
            require!(n.len() <= MAX_NAME_LEN, "ERR_NAME_TOO_LONG");
        }

        let owner = env::predecessor_account_id();
        let now = env::block_timestamp();
        let token_id = self.next_token_id.to_string();
        self.next_token_id += 1;

        let before = env::storage_usage();
        // The media is a live image of the seal (brief 3.3 #9): wallets show it intact, then
        // broken once opened, with no further writes here.
        let has_media = self.metadata.get().is_some_and(|m| m.base_uri.is_some());
        let metadata = TokenMetadata {
            title: Some(format!("Bearer vault No. {:0>4}", token_id)),
            description: name.clone(),
            media: has_media.then(|| format!("{token_id}.svg")),
            extra: Some(json!({ "state": "sealed" }).to_string()),
            ..empty_metadata()
        };
        self.tokens.internal_mint_with_refund(
            token_id.clone(),
            owner.clone(),
            Some(metadata),
            None,
        );
        self.vaults.insert(
            &token_id,
            &Vault::new(owner.clone(), now, name, Finish::clone(&finish)),
        );
        let used = env::storage_usage() - before + RESERVED_BYTES;
        require!(
            env::storage_byte_cost().saturating_mul(used as u128) <= self.config.create_deposit,
            "ERR_CREATE_DEPOSIT_BELOW_STORAGE"
        );

        NftMint {
            owner_id: &owner,
            token_ids: &[&token_id],
            memo: None,
        }
        .emit();
        events::emit(
            "vault_created",
            json!({ "token_id": token_id, "owner_id": owner }),
        );

        self.request_derived_keys(&token_id).detach();
        token_id
    }

    /// Re-requests derived keys if the first attempt failed. Anyone may call it; it only
    /// fills keys that are missing (no stuck states).
    pub fn fetch_keys(&mut self, token_id: TokenId) -> Promise {
        let vault = self.vault_or_panic(&token_id);
        require!(vault.keys.is_none(), "ERR_KEYS_ALREADY_SET");
        self.request_derived_keys(&token_id)
    }

    #[private]
    pub fn on_derived_keys(&mut self, token_id: TokenId) {
        let mut keys = Vec::with_capacity(3);
        for i in 0..3 {
            let parsed = env::promise_result_checked(i, 200)
                .ok()
                .and_then(|bytes| near_sdk::serde_json::from_slice::<String>(&bytes).ok());
            match parsed {
                Some(k) => keys.push(k),
                None => {
                    events::emit("keys_failed", json!({ "token_id": token_id }));
                    return;
                }
            }
        }
        // Only store keys that parse; never panic in a callback.
        if secp256k1_key_bytes(&keys[0]).is_err() || secp256k1_key_bytes(&keys[1]).is_err() {
            events::emit("keys_failed", json!({ "token_id": token_id }));
            return;
        }
        if let Some(mut vault) = self.vaults.get(&token_id) {
            if vault.keys.is_none() {
                vault.keys = Some(DerivedKeys {
                    btc: keys[0].clone(),
                    evm: keys[1].clone(),
                    sol: keys[2].clone(),
                });
                self.vaults.insert(&token_id, &vault);
                events::emit("keys_set", json!({ "token_id": token_id }));
            }
        }
    }

    // ---------- views ----------

    pub fn vault(&self, token_id: TokenId) -> Option<VaultView> {
        let vault = self.vaults.get(&token_id)?;
        let owner_id = self.tokens.owner_by_id.get(&token_id)?;
        let btc_address = vault
            .keys
            .as_ref()
            .and_then(|k| bitcoin::vault_pubkey(&k.btc).ok())
            .map(|key| bitcoin::p2wpkh_address(&key));
        let evm_address = vault
            .keys
            .as_ref()
            .and_then(|k| secp256k1_key_bytes(&k.evm).ok())
            .map(|key| format!("0x{}", mpc::encode_hex(&evm::address_of(&key))));
        let sol_address = vault
            .keys
            .as_ref()
            .and_then(|k| solana::vault_key(&k.sol).ok())
            .map(|key| solana::address(&key));
        Some(VaultView {
            paths: Paths {
                btc: vault_path(&token_id, ChainTag::Btc),
                evm: vault_path(&token_id, ChainTag::Evm),
                sol: vault_path(&token_id, ChainTag::Sol),
            },
            token_id,
            owner_id,
            state: vault.state,
            signatures_requested: vault.signatures_requested,
            withdrawal_count: vault.withdrawal_count,
            keys: vault.keys,
            btc_address,
            evm_address,
            sol_address,
            custody: vault.custody,
            created_at_ns: vault.created_at_ns,
            name: vault.name,
            finish: vault.finish,
        })
    }

    pub fn withdrawals(
        &self,
        token_id: TokenId,
        from_index: Option<u32>,
        limit: Option<u32>,
    ) -> Vec<Withdrawal> {
        let Some(vault) = self.vaults.get(&token_id) else {
            return vec![];
        };
        let from = from_index.unwrap_or(0);
        let to = from
            .saturating_add(limit.unwrap_or(20))
            .min(vault.withdrawal_count);
        (from..to)
            .filter_map(|i| self.withdrawals.get(&withdrawal_key(&token_id, i)))
            .collect()
    }

    pub fn get_config(&self) -> Config {
        self.config.clone()
    }

    pub fn signer_id(&self) -> AccountId {
        self.signer_id.clone()
    }

    // ---------- internals ----------

    fn request_derived_keys(&self, token_id: &TokenId) -> Promise {
        let me = env::current_account_id();
        let call = |chain: ChainTag| {
            let args = DerivedKeyArgs {
                path: vault_path(token_id, chain),
                predecessor: me.clone(),
                domain_id: chain.domain_id(),
            };
            Promise::new(self.signer_id.clone()).function_call(
                "derived_public_key".to_string(),
                near_sdk::serde_json::to_vec(&args).unwrap_or_default(),
                NearToken::from_yoctonear(0),
                GAS_FOR_DERIVED_KEY,
            )
        };
        call(ChainTag::Btc)
            .and(call(ChainTag::Evm))
            .and(call(ChainTag::Sol))
            .then(
                Self::ext(me.clone())
                    .with_static_gas(GAS_FOR_KEYS_CALLBACK)
                    .on_derived_keys(token_id.clone()),
            )
    }

    pub(crate) fn vault_or_panic(&self, token_id: &TokenId) -> Vault {
        self.vaults
            .get(token_id)
            .unwrap_or_else(|| env::panic_str("ERR_NO_VAULT"))
    }

    /// The vault, after checking the caller owns it (T1).
    pub(crate) fn vault_for_owner(&self, token_id: &TokenId) -> Vault {
        let vault = self.vault_or_panic(token_id);
        let owner = self
            .tokens
            .owner_by_id
            .get(token_id)
            .unwrap_or_else(|| env::panic_str("ERR_NO_VAULT"));
        require!(env::predecessor_account_id() == owner, "ERR_NOT_OWNER");
        vault
    }

    pub(crate) fn set_token_state_extra(&mut self, token_id: &TokenId, state: &str) {
        if let Some(by_id) = self.tokens.token_metadata_by_id.as_mut() {
            if let Some(mut md) = by_id.get(token_id) {
                md.extra = Some(json!({ "state": state }).to_string());
                by_id.insert(token_id, &md);
            }
        }
    }
}

pub(crate) fn withdrawal_key(token_id: &str, idx: u32) -> String {
    format!("{token_id}:{idx}")
}

fn empty_metadata() -> TokenMetadata {
    TokenMetadata {
        title: None,
        description: None,
        media: None,
        media_hash: None,
        copies: None,
        issued_at: None,
        expires_at: None,
        starts_at: None,
        updated_at: None,
        extra: None,
        reference: None,
        reference_hash: None,
    }
}

#[near]
impl NonFungibleTokenMetadataProvider for Contract {
    fn nft_metadata(&self) -> NFTContractMetadata {
        self.metadata
            .get()
            .unwrap_or_else(|| env::panic_str("ERR_NO_METADATA"))
    }
}

#[near]
impl NonFungibleTokenEnumeration for Contract {
    fn nft_total_supply(&self) -> U128 {
        self.tokens.nft_total_supply()
    }

    fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.tokens.nft_tokens(from_index, limit)
    }

    fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        self.tokens.nft_supply_for_owner(account_id)
    }

    fn nft_tokens_for_owner(
        &self,
        account_id: AccountId,
        from_index: Option<U128>,
        limit: Option<u64>,
    ) -> Vec<Token> {
        self.tokens
            .nft_tokens_for_owner(account_id, from_index, limit)
    }
}
