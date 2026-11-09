//! NEAR-side assets held for a vault: NEAR itself, NEP-141 tokens and NEP-171 NFTs (v2).
//!
//! The contract holds them on the vault's behalf, so they follow the same rule as the vault's
//! Bitcoin, Base and Solana coins: they move with the vault while it is sealed, and only its owner
//! can take them out, after opening (H2, H3). Only the owner can load tokens and NFTs (H1), so
//! nobody can fill a vault with spam. Storage for each entry is paid from the vault's own NEAR (H6).
//! A withdrawal marks what it moves as pending first and restores it if the transfer fails (H4).

use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_contract_standards::non_fungible_token::core::NonFungibleTokenReceiver;
use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json};
use near_sdk::{
    assert_one_yocto, env, near, require, AccountId, Gas, NearToken, Promise, PromiseOrValue,
};

use crate::{events, Contract, ContractExt};

/// Bounded so a vault's holdings stay cheap to read and to write (H6).
pub const MAX_TOKENS: usize = 8;
pub const MAX_NFTS: usize = 16;
/// The smallest NEAR deposit: enough to pay for the vault's holdings record and a few entries.
pub const MIN_NEAR_DEPOSIT: NearToken = NearToken::from_millinear(10);

const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const GAS_FOR_FT_TRANSFER: Gas = Gas::from_tgas(15);
const GAS_FOR_NFT_TRANSFER: Gas = Gas::from_tgas(30);
const GAS_FOR_HOLDING_CALLBACK: Gas = Gas::from_tgas(10);
const GAS_MARGIN: Gas = Gas::from_tgas(10);

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct TokenHolding {
    /// The NEP-141 contract. Anyone can deploy one, so the UI names it rather than trusting a symbol.
    pub contract: AccountId,
    /// Available to withdraw.
    pub amount: U128,
    /// Sent but not yet confirmed by the token contract.
    pub pending: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct NftHolding {
    pub contract: AccountId,
    pub token_id: TokenId,
    /// A withdrawal of it is in flight.
    pub pending: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Holdings {
    /// NEAR held for the vault, net of what its entries' storage costs.
    pub near: NearToken,
    pub tokens: Vec<TokenHolding>,
    pub nfts: Vec<NftHolding>,
}

impl Contract {
    fn holdings_of(&self, token_id: &TokenId) -> Holdings {
        self.holdings.get(token_id).unwrap_or_default()
    }

    fn owner_of(&self, token_id: &TokenId) -> AccountId {
        self.tokens
            .owner_by_id
            .get(token_id)
            .unwrap_or_else(|| env::panic_str("ERR_NO_VAULT"))
    }

    /// The vault, after checking the caller owns it and has opened it (H2, H3).
    fn opened_for_owner(&self, token_id: &TokenId) {
        let vault = self.vault_for_owner(token_id);
        require!(!vault.is_sealed(), "ERR_VAULT_SEALED");
    }

    /// Writes the holdings and settles storage against the vault's NEAR: growth is charged, and
    /// refused if the vault can't pay; shrinkage is refunded to it (H6). Callbacks only ever keep
    /// or shrink an entry, so they never hit the refusal.
    fn save_holdings(&mut self, token_id: &TokenId, mut h: Holdings) {
        let before = env::storage_usage();
        self.holdings.insert(token_id, &h);
        let after = env::storage_usage();
        let byte = env::storage_byte_cost();
        if after > before {
            let cost = byte.saturating_mul(u128::from(after - before));
            require!(h.near >= cost, "ERR_VAULT_NEAR_BELOW_STORAGE");
            h.near = h.near.saturating_sub(cost);
            self.holdings.insert(token_id, &h);
        } else if before > after {
            h.near = h
                .near
                .saturating_add(byte.saturating_mul(u128::from(before - after)));
            self.holdings.insert(token_id, &h);
        }
    }

    fn require_gas(&self, transfer: Gas) {
        require!(
            env::prepaid_gas()
                >= transfer
                    .saturating_add(GAS_FOR_HOLDING_CALLBACK)
                    .saturating_add(GAS_MARGIN),
            "ERR_GAS"
        );
    }
}

#[near]
impl Contract {
    /// Adds NEAR to a vault. Anyone may: it can only help the holder. At least 0.01 NEAR; part of
    /// the first deposit pays for the vault's holdings record.
    #[payable]
    pub fn deposit_near(&mut self, token_id: TokenId) -> NearToken {
        self.vault_or_panic(&token_id);
        let amount = env::attached_deposit();
        require!(amount >= MIN_NEAR_DEPOSIT, "ERR_DEPOSIT");
        let mut h = self.holdings_of(&token_id);
        h.near = h.near.saturating_add(amount);
        self.save_holdings(&token_id, h);
        events::emit(
            "near_deposited",
            json!({ "token_id": token_id, "by": env::predecessor_account_id(), "amount": amount }),
        );
        self.holdings_of(&token_id).near
    }

    /// Everything the contract holds for a vault on NEAR.
    pub fn holdings(&self, token_id: TokenId) -> Holdings {
        self.holdings_of(&token_id)
    }

    /// Sends NEAR from an opened vault. Owner only; attach 1 yoctoNEAR.
    #[payable]
    pub fn withdraw_near(&mut self, token_id: TokenId, receiver_id: AccountId, amount: NearToken) -> Promise {
        assert_one_yocto();
        self.opened_for_owner(&token_id);
        self.require_gas(Gas::from_tgas(0));
        let mut h = self.holdings_of(&token_id);
        require!(!amount.is_zero() && h.near >= amount, "ERR_AMOUNT");
        h.near = h.near.saturating_sub(amount);
        self.holdings.insert(&token_id, &h);
        Promise::new(receiver_id.clone()).transfer(amount).then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_FOR_HOLDING_CALLBACK)
                .on_near_withdrawn(token_id, receiver_id, amount),
        )
    }

    /// Sends NEP-141 tokens from an opened vault. Owner only; attach 1 yoctoNEAR. The receiver must
    /// be registered with the token contract, or the transfer fails and the tokens stay in the vault.
    #[payable]
    pub fn withdraw_token(
        &mut self,
        token_id: TokenId,
        token_contract: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> Promise {
        assert_one_yocto();
        self.opened_for_owner(&token_id);
        self.require_gas(GAS_FOR_FT_TRANSFER);
        let mut h = self.holdings_of(&token_id);
        let entry = h
            .tokens
            .iter_mut()
            .find(|t| t.contract == token_contract)
            .unwrap_or_else(|| env::panic_str("ERR_NOT_HELD"));
        require!(amount.0 > 0 && entry.amount.0 >= amount.0, "ERR_AMOUNT");
        entry.amount = U128(entry.amount.0 - amount.0);
        entry.pending = U128(entry.pending.0 + amount.0);
        self.holdings.insert(&token_id, &h);
        Promise::new(token_contract.clone())
            .function_call(
                "ft_transfer".to_string(),
                serde_json::to_vec(&json!({ "receiver_id": receiver_id, "amount": amount, "memo": "bearer vault" }))
                    .unwrap_or_default(),
                ONE_YOCTO,
                GAS_FOR_FT_TRANSFER,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_HOLDING_CALLBACK)
                    .on_token_withdrawn(token_id, token_contract, receiver_id, amount),
            )
    }

    /// Sends a NEP-171 NFT from an opened vault. Owner only; attach 1 yoctoNEAR.
    #[payable]
    pub fn withdraw_nft(
        &mut self,
        token_id: TokenId,
        nft_contract: AccountId,
        nft_token_id: TokenId,
        receiver_id: AccountId,
    ) -> Promise {
        assert_one_yocto();
        self.opened_for_owner(&token_id);
        self.require_gas(GAS_FOR_NFT_TRANSFER);
        let mut h = self.holdings_of(&token_id);
        let entry = h
            .nfts
            .iter_mut()
            .find(|n| n.contract == nft_contract && n.token_id == nft_token_id)
            .unwrap_or_else(|| env::panic_str("ERR_NOT_HELD"));
        require!(!entry.pending, "ERR_PENDING");
        entry.pending = true;
        self.holdings.insert(&token_id, &h);
        Promise::new(nft_contract.clone())
            .function_call(
                "nft_transfer".to_string(),
                serde_json::to_vec(
                    &json!({ "receiver_id": receiver_id, "token_id": nft_token_id, "memo": "bearer vault" }),
                )
                .unwrap_or_default(),
                ONE_YOCTO,
                GAS_FOR_NFT_TRANSFER,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_HOLDING_CALLBACK)
                    .on_nft_withdrawn(token_id, nft_contract, nft_token_id, receiver_id),
            )
    }

    /// Never panics (H4): a failed transfer puts the NEAR back.
    #[private]
    pub fn on_near_withdrawn(&mut self, token_id: TokenId, receiver_id: AccountId, amount: NearToken) {
        let ok = env::promise_result_checked(0, 64).is_ok();
        if !ok {
            let mut h = self.holdings_of(&token_id);
            h.near = h.near.saturating_add(amount);
            self.holdings.insert(&token_id, &h);
        }
        events::emit(
            if ok { "near_withdrawn" } else { "near_withdrawal_failed" },
            json!({ "token_id": token_id, "to": receiver_id, "amount": amount }),
        );
    }

    /// Never panics (H4): a failed transfer puts the tokens back; an emptied entry is removed and
    /// its storage refunded to the vault's NEAR.
    #[private]
    pub fn on_token_withdrawn(&mut self, token_id: TokenId, token_contract: AccountId, receiver_id: AccountId, amount: U128) {
        let ok = env::promise_result_checked(0, 64).is_ok();
        let mut h = self.holdings_of(&token_id);
        if let Some(entry) = h.tokens.iter_mut().find(|t| t.contract == token_contract) {
            entry.pending = U128(entry.pending.0.saturating_sub(amount.0));
            if !ok {
                entry.amount = U128(entry.amount.0 + amount.0);
            }
        }
        h.tokens.retain(|t| t.amount.0 > 0 || t.pending.0 > 0);
        self.save_holdings(&token_id, h);
        events::emit(
            if ok { "token_withdrawn" } else { "token_withdrawal_failed" },
            json!({ "token_id": token_id, "contract": token_contract, "to": receiver_id, "amount": amount }),
        );
    }

    /// Never panics (H4): a failed transfer keeps the NFT in the vault.
    #[private]
    pub fn on_nft_withdrawn(&mut self, token_id: TokenId, nft_contract: AccountId, nft_token_id: TokenId, receiver_id: AccountId) {
        let ok = env::promise_result_checked(0, 64).is_ok();
        let mut h = self.holdings_of(&token_id);
        if ok {
            h.nfts.retain(|n| !(n.contract == nft_contract && n.token_id == nft_token_id));
        } else if let Some(entry) = h.nfts.iter_mut().find(|n| n.contract == nft_contract && n.token_id == nft_token_id) {
            entry.pending = false;
        }
        self.save_holdings(&token_id, h);
        events::emit(
            if ok { "nft_withdrawn" } else { "nft_withdrawal_failed" },
            json!({ "token_id": token_id, "contract": nft_contract, "nft_token_id": nft_token_id, "to": receiver_id }),
        );
    }
}

#[near]
impl FungibleTokenReceiver for Contract {
    /// Loads NEP-141 tokens into a vault: `ft_transfer_call` with `msg` = the vault's number. Only
    /// the vault's owner may (H1); any panic returns the tokens to the sender.
    /// Fails: `ERR_NO_VAULT`, `ERR_NOT_OWNER`, `ERR_TOO_MANY_TOKENS`, `ERR_VAULT_NEAR_BELOW_STORAGE`.
    fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        let token_id: TokenId = msg;
        require!(sender_id == self.owner_of(&token_id), "ERR_NOT_OWNER");
        require!(amount.0 > 0, "ERR_AMOUNT");
        let contract = env::predecessor_account_id();
        let mut h = self.holdings_of(&token_id);
        if let Some(entry) = h.tokens.iter_mut().find(|t| t.contract == contract) {
            entry.amount = U128(entry.amount.0 + amount.0);
        } else {
            require!(h.tokens.len() < MAX_TOKENS, "ERR_TOO_MANY_TOKENS");
            h.tokens.push(TokenHolding { contract: contract.clone(), amount, pending: U128(0) });
        }
        self.save_holdings(&token_id, h);
        events::emit(
            "token_deposited",
            json!({ "token_id": token_id, "contract": contract, "amount": amount }),
        );
        PromiseOrValue::Value(U128(0))
    }
}

#[near]
impl NonFungibleTokenReceiver for Contract {
    /// Loads a NEP-171 NFT into a vault: `nft_transfer_call` with `msg` = the vault's number. Only
    /// the vault's owner may (H1), and not a Bearer vault itself (H5); any panic returns the NFT.
    /// Fails: `ERR_NO_NESTED_VAULTS`, `ERR_NO_VAULT`, `ERR_NOT_OWNER`, `ERR_TOO_MANY_NFTS`,
    /// `ERR_VAULT_NEAR_BELOW_STORAGE`.
    fn nft_on_transfer(
        &mut self,
        sender_id: AccountId,
        previous_owner_id: AccountId,
        token_id: TokenId,
        msg: String,
    ) -> PromiseOrValue<bool> {
        let contract = env::predecessor_account_id();
        require!(contract != env::current_account_id(), "ERR_NO_NESTED_VAULTS");
        let vault_id: TokenId = msg;
        let owner = self.owner_of(&vault_id);
        require!(sender_id == owner && previous_owner_id == owner, "ERR_NOT_OWNER");
        let mut h = self.holdings_of(&vault_id);
        require!(h.nfts.len() < MAX_NFTS, "ERR_TOO_MANY_NFTS");
        h.nfts.push(NftHolding { contract: contract.clone(), token_id: token_id.clone(), pending: false });
        self.save_holdings(&vault_id, h);
        events::emit(
            "nft_deposited",
            json!({ "token_id": vault_id, "contract": contract, "nft_token_id": token_id }),
        );
        PromiseOrValue::Value(false)
    }
}
