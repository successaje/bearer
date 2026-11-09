//! Sandbox-only: one contract that is both a NEP-141 token and a NEP-171 NFT collection, so the
//! vault holdings tests (v2) can load and withdraw both without a real token. Anyone can mint.
#![allow(deprecated)] // the standards' impl macros are deprecated but fine for a test double

use near_contract_standards::fungible_token::FungibleToken;
use near_contract_standards::non_fungible_token::metadata::TokenMetadata;
use near_contract_standards::non_fungible_token::{NonFungibleToken, Token, TokenId};
use near_contract_standards::storage_management::{StorageBalance, StorageBalanceBounds, StorageManagement};
use near_sdk::json_types::U128;
use near_sdk::{env, near, AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue};

#[derive(BorshStorageKey)]
#[near]
enum Key {
    Ft,
    NftOwners,
    NftMetadata,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockAssets {
    ft: FungibleToken,
    nft: NonFungibleToken,
}

#[near]
impl MockAssets {
    #[init]
    pub fn new() -> Self {
        Self {
            ft: FungibleToken::new(Key::Ft),
            nft: NonFungibleToken::new(Key::NftOwners, env::current_account_id(), Some(Key::NftMetadata), None::<Key>, None::<Key>),
        }
    }

    /// Registers the account if needed and credits it.
    pub fn ft_mint(&mut self, account_id: AccountId, amount: U128) {
        if !self.ft.accounts.contains_key(&account_id) {
            self.ft.internal_register_account(&account_id);
        }
        self.ft.internal_deposit(&account_id, amount.0);
    }

    #[payable]
    pub fn nft_mint(&mut self, token_id: TokenId, receiver_id: AccountId) -> Token {
        self.nft.internal_mint(token_id.clone(), receiver_id, Some(TokenMetadata { title: Some(format!("Mock #{token_id}")), ..Default::default() }))
    }
}

near_contract_standards::impl_fungible_token_core!(MockAssets, ft);
near_contract_standards::impl_non_fungible_token_core!(MockAssets, nft);

#[near]
impl StorageManagement for MockAssets {
    #[payable]
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        self.ft.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.ft.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.ft.storage_unregister(force)
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.ft.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.ft.storage_balance_of(account_id)
    }
}

// Silence an unused-import warning when the macros don't need it.
#[allow(dead_code)]
fn _uses(_: PromiseOrValue<U128>) {}
