//! Bearer market: list a sealed vault for a NEAR price; a buyer pays and receives it.
//!
//! Escrow by transfer. The seller sends the vault here with `nft_transfer_call` on the Bearer
//! contract, and this contract holds it until it sells or is delisted. Bearer has no NEP-178
//! approvals (its T6), so holding the token is the only way to sell it without the seller
//! online. A listed vault stays sealed: only its owner (this contract) could break the seal,
//! and nothing here calls `break_seal`.
//!
//! Settlement order: the vault moves first, then money moves. A vault that didn't move refunds
//! the buyer and the listing stands; a payout that bounces is kept for `claim`. No step assumes
//! an earlier cross-contract step will roll back. Threats M1–M9 in docs/THREAT_MODEL.md.
#![allow(deprecated)] // storage-measured collections, as in the Bearer contract

use near_contract_standards::non_fungible_token::core::NonFungibleTokenReceiver;
use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::collections::{LookupMap, UnorderedMap};
use near_sdk::json_types::U64;
use near_sdk::serde_json::{self, json, Value};
use near_sdk::{
    assert_one_yocto, env, near, require, AccountId, BorshStorageKey, Gas, NearToken,
    PanicOnDefault, Promise, PromiseOrValue,
};

/// Bearer's `nft_transfer` measured at 3.4 Tgas on testnet; the rest is headroom.
const GAS_FOR_NFT_TRANSFER: Gas = Gas::from_tgas(20);
/// The settlement callback, including scheduling one payout and its own callback.
const GAS_FOR_ON_MOVED: Gas = Gas::from_tgas(25);
const GAS_FOR_ON_PAYOUT: Gas = Gas::from_tgas(5);
/// `buy` and `delist` refuse less than this, so a settlement can't run out of gas halfway (M5).
const GAS_FOR_MOVE_AND_SETTLE: Gas = Gas::from_tgas(60);
const GAS_FOR_VAULT_VIEW: Gas = Gas::from_tgas(10);
const GAS_FOR_ON_UNLISTED_READ: Gas = Gas::from_tgas(30);
const GAS_FOR_RETURN_UNLISTED: Gas = Gas::from_tgas(50);
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
/// Below this a price is more likely a typo than an offer.
pub const MIN_PRICE: NearToken = NearToken::from_millinear(1);
/// A vault view is about 1.5 KB; this bounds what the custody read will accept.
const MAX_VAULT_VIEW: usize = 16 * 1024;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Listings,
    Deposits,
    Claimable,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ListingState {
    /// For sale.
    Listed,
    /// A buyer paid; the vault is on its way to them. Nobody else can buy or delist meanwhile.
    Selling { buyer: AccountId },
    /// The seller delisted; the vault is on its way back.
    Returning,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Listing {
    pub token_id: TokenId,
    pub seller: AccountId,
    /// Exactly what `buy` must attach.
    pub price: NearToken,
    /// Taken from the seller's listing balance; paid back with the sale or the delisting.
    pub deposit: NearToken,
    pub listed_at_ns: U64,
    pub state: ListingState,
}

#[near(serializers = [json])]
pub struct MarketConfig {
    pub nft_contract: AccountId,
    pub listing_deposit: NearToken,
    pub min_price: NearToken,
}

#[near(serializers = [json])]
struct ListMsg {
    price: NearToken,
}

/// The parts of Bearer's `vault` view that `return_unlisted` reads.
#[near(serializers = [json])]
struct VaultSummary {
    owner_id: AccountId,
    custody: Vec<CustodyEntry>,
}

#[near(serializers = [json])]
struct CustodyEntry {
    account_id: AccountId,
}

/// What a finished vault move means for its listing, and who gets paid.
#[derive(Debug, PartialEq)]
pub enum Settlement {
    /// The vault reached the buyer: the listing ends, the seller gets the price and the deposit.
    Sold { seller: AccountId, buyer: AccountId, payout: NearToken },
    /// The vault didn't move: the listing stands again and the buyer gets the price back.
    Refunded { buyer: AccountId, refund: NearToken },
    /// The vault is back with the seller: the listing ends, the seller gets the deposit back.
    Delisted { seller: AccountId, refund: NearToken },
    /// The vault didn't go back: the listing stands again.
    StillListed,
    /// Nothing was in flight for this listing.
    Nothing,
}

/// Pure, so every branch is unit-tested without a chain.
pub fn settle(listing: &Listing, moved: bool) -> Settlement {
    match (&listing.state, moved) {
        (ListingState::Selling { buyer }, true) => Settlement::Sold {
            seller: listing.seller.clone(),
            buyer: buyer.clone(),
            payout: listing.price.saturating_add(listing.deposit),
        },
        (ListingState::Selling { buyer }, false) => Settlement::Refunded {
            buyer: buyer.clone(),
            refund: listing.price,
        },
        (ListingState::Returning, true) => Settlement::Delisted {
            seller: listing.seller.clone(),
            refund: listing.deposit,
        },
        (ListingState::Returning, false) => Settlement::StillListed,
        (ListingState::Listed, _) => Settlement::Nothing,
    }
}

/// NEP-297 event under the market's own standard.
fn emit(event: &str, data: Value) {
    let payload = json!({
        "standard": "bearer_market",
        "version": "1.0.0",
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{payload}"));
}

// The market implements the receiving side of NEP-171 and emits NEP-297 events.
#[near(
    contract_state,
    contract_metadata(standard(standard = "nep297", version = "1.0.0"))
)]
#[derive(PanicOnDefault)]
pub struct Market {
    nft_contract: AccountId,
    listing_deposit: NearToken,
    listings: UnorderedMap<TokenId, Listing>,
    /// Listing balances not held by a listing, per seller (M6).
    deposits: LookupMap<AccountId, NearToken>,
    /// Payouts that bounced, per account (M4).
    claimable: LookupMap<AccountId, NearToken>,
}

#[near]
impl Market {
    /// No owner, admin or upgrade methods exist (M9). Both settings are fixed here.
    #[init]
    pub fn new(nft_contract: AccountId, listing_deposit: NearToken) -> Self {
        require!(!listing_deposit.is_zero(), "ERR_CONFIG");
        Self {
            nft_contract,
            listing_deposit,
            listings: UnorderedMap::new(StorageKey::Listings),
            deposits: LookupMap::new(StorageKey::Deposits),
            claimable: LookupMap::new(StorageKey::Claimable),
        }
    }

    /// Pays for listings ahead of time. Each listing holds `listing_deposit` from this balance
    /// and returns it when the vault sells or is delisted (M6). Listing can't carry the deposit
    /// itself: `nft_transfer_call` forwards exactly 1 yoctoNEAR.
    #[payable]
    pub fn deposit_for_listing(&mut self) -> NearToken {
        require!(
            env::attached_deposit() >= self.listing_deposit,
            "ERR_DEPOSIT"
        );
        let account = env::predecessor_account_id();
        let balance = self
            .deposit_of(account.clone())
            .saturating_add(env::attached_deposit());
        self.deposits.insert(&account, &balance);
        balance
    }

    /// Returns the caller's listing balance that no listing holds.
    #[payable]
    pub fn withdraw_deposit(&mut self) -> Promise {
        assert_one_yocto();
        let account = env::predecessor_account_id();
        let amount = self
            .deposits
            .remove(&account)
            .unwrap_or_else(|| env::panic_str("ERR_NOTHING_TO_WITHDRAW"));
        self.pay(account, amount)
    }

    /// Buys a listed vault: attach exactly its price. The vault moves to the caller first; the
    /// seller is paid only once it has (M3). If it doesn't move, the price comes back.
    /// Fails: `ERR_NOT_LISTED`, `ERR_SALE_PENDING`, `ERR_OWN_LISTING`, `ERR_WRONG_PRICE`, `ERR_GAS`.
    #[payable]
    pub fn buy(&mut self, token_id: TokenId) -> Promise {
        let mut listing = self.listing_or_panic(&token_id);
        require!(listing.state == ListingState::Listed, "ERR_SALE_PENDING");
        let buyer = env::predecessor_account_id();
        require!(buyer != listing.seller, "ERR_OWN_LISTING");
        require!(
            env::attached_deposit() == listing.price,
            "ERR_WRONG_PRICE"
        );
        require!(env::prepaid_gas() >= GAS_FOR_MOVE_AND_SETTLE, "ERR_GAS");
        listing.state = ListingState::Selling {
            buyer: buyer.clone(),
        };
        self.listings.insert(&token_id, &listing);
        self.move_vault(token_id, buyer)
    }

    /// The seller takes the vault back, with its listing deposit. Attach 1 yoctoNEAR.
    /// Fails: `ERR_NOT_LISTED`, `ERR_SALE_PENDING`, `ERR_NOT_SELLER`, `ERR_GAS`.
    #[payable]
    pub fn delist(&mut self, token_id: TokenId) -> Promise {
        assert_one_yocto();
        let mut listing = self.listing_or_panic(&token_id);
        require!(listing.state == ListingState::Listed, "ERR_SALE_PENDING");
        require!(
            env::predecessor_account_id() == listing.seller,
            "ERR_NOT_SELLER"
        );
        require!(env::prepaid_gas() >= GAS_FOR_MOVE_AND_SETTLE, "ERR_GAS");
        listing.state = ListingState::Returning;
        self.listings.insert(&token_id, &listing);
        let seller = listing.seller.clone();
        self.move_vault(token_id, seller)
    }

    /// Sends money that bounced earlier (M4) to the caller. Attach 1 yoctoNEAR.
    #[payable]
    pub fn claim(&mut self) -> Promise {
        assert_one_yocto();
        let account = env::predecessor_account_id();
        let amount = self
            .claimable
            .remove(&account)
            .unwrap_or_else(|| env::panic_str("ERR_NOTHING_TO_CLAIM"));
        self.pay(account, amount)
    }

    /// Sends back a vault that arrived by plain `nft_transfer` and so was never listed (M8). It
    /// goes to whoever held it before this contract, read from the vault's custody log. Anyone
    /// may call this; it does nothing for a listed vault or one this contract doesn't hold.
    pub fn return_unlisted(&mut self, token_id: TokenId) -> Promise {
        require!(self.listings.get(&token_id).is_none(), "ERR_LISTED");
        require!(env::prepaid_gas() >= GAS_FOR_RETURN_UNLISTED, "ERR_GAS");
        Promise::new(self.nft_contract.clone())
            .function_call(
                "vault".to_string(),
                serde_json::to_vec(&json!({ "token_id": token_id })).unwrap_or_default(),
                NearToken::from_yoctonear(0),
                GAS_FOR_VAULT_VIEW,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_ON_UNLISTED_READ)
                    .on_unlisted_read(token_id),
            )
    }

    /// Never panics (M5): whatever happened to the vault, the listing ends in a known state.
    #[private]
    pub fn on_vault_moved(&mut self, token_id: TokenId) {
        let Some(listing) = self.listings.get(&token_id) else {
            return;
        };
        let moved = env::promise_result_checked(0, 64).is_ok();
        let price = listing.price;
        match settle(&listing, moved) {
            Settlement::Sold {
                seller,
                buyer,
                payout,
            } => {
                self.listings.remove(&token_id);
                emit(
                    "sold",
                    json!({ "token_id": token_id, "seller": seller, "buyer": buyer, "price": price }),
                );
                self.pay(seller, payout).detach();
            }
            Settlement::Refunded { buyer, refund } => {
                self.listings.insert(
                    &token_id,
                    &Listing {
                        state: ListingState::Listed,
                        ..listing
                    },
                );
                emit(
                    "sale_failed",
                    json!({ "token_id": token_id, "buyer": buyer, "refund": refund }),
                );
                self.pay(buyer, refund).detach();
            }
            Settlement::Delisted { seller, refund } => {
                self.listings.remove(&token_id);
                emit(
                    "delisted",
                    json!({ "token_id": token_id, "seller": seller }),
                );
                self.pay(seller, refund).detach();
            }
            Settlement::StillListed => {
                self.listings.insert(
                    &token_id,
                    &Listing {
                        state: ListingState::Listed,
                        ..listing
                    },
                );
                emit("delist_failed", json!({ "token_id": token_id }));
            }
            Settlement::Nothing => {}
        }
    }

    /// A payout that bounced (the account no longer exists) is kept for `claim` (M4).
    #[private]
    pub fn on_payout(&mut self, account_id: AccountId, amount: NearToken) {
        if env::promise_result_checked(0, 64).is_ok() {
            return;
        }
        let total = self
            .claimable_of(account_id.clone())
            .saturating_add(amount);
        self.claimable.insert(&account_id, &total);
        emit(
            "payout_failed",
            json!({ "account_id": account_id, "amount": amount }),
        );
    }

    /// Second half of `return_unlisted`. Never panics.
    #[private]
    pub fn on_unlisted_read(&mut self, token_id: TokenId) {
        if self.listings.get(&token_id).is_some() {
            return;
        }
        let Ok(bytes) = env::promise_result_checked(0, MAX_VAULT_VIEW) else {
            return;
        };
        let Ok(Some(vault)) = serde_json::from_slice::<Option<VaultSummary>>(&bytes) else {
            return;
        };
        if vault.owner_id != env::current_account_id() {
            return;
        }
        // The last custody entry is this contract; the one before it sent the vault here.
        let Some(previous) = vault.custody.iter().rev().nth(1) else {
            return;
        };
        let to = previous.account_id.clone();
        emit("returned", json!({ "token_id": token_id, "to": to }));
        Promise::new(self.nft_contract.clone()).function_call(
            "nft_transfer".to_string(),
            serde_json::to_vec(&json!({ "receiver_id": to, "token_id": token_id, "memo": "bearer market: never listed" }))
                .unwrap_or_default(),
            ONE_YOCTO,
            GAS_FOR_NFT_TRANSFER,
        )
        .detach();
    }

    /* ---------- views ---------- */

    pub fn listings(&self, from_index: Option<u64>, limit: Option<u64>) -> Vec<Listing> {
        self.listings
            .values()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50).min(100) as usize)
            .collect()
    }

    pub fn listing(&self, token_id: TokenId) -> Option<Listing> {
        self.listings.get(&token_id)
    }

    pub fn listing_count(&self) -> u64 {
        self.listings.len()
    }

    pub fn deposit_of(&self, account_id: AccountId) -> NearToken {
        self.deposits
            .get(&account_id)
            .unwrap_or(NearToken::from_yoctonear(0))
    }

    pub fn claimable_of(&self, account_id: AccountId) -> NearToken {
        self.claimable
            .get(&account_id)
            .unwrap_or(NearToken::from_yoctonear(0))
    }

    pub fn get_config(&self) -> MarketConfig {
        MarketConfig {
            nft_contract: self.nft_contract.clone(),
            listing_deposit: self.listing_deposit,
            min_price: MIN_PRICE,
        }
    }
}

#[near]
impl NonFungibleTokenReceiver for Market {
    /// Lists a vault the Bearer contract just moved here. `msg` is `{"price":"<yoctoNEAR>"}`.
    /// Any panic sends the vault straight back to the seller (NEP-171 resolve).
    /// Fails: `ERR_WRONG_NFT_CONTRACT` (M1), `ERR_NO_APPROVALS`, `ERR_BAD_MSG`, `ERR_PRICE`,
    /// `ERR_ALREADY_LISTED`, `ERR_NO_LISTING_DEPOSIT`, `ERR_LISTING_DEPOSIT_BELOW_STORAGE`.
    fn nft_on_transfer(
        &mut self,
        sender_id: AccountId,
        previous_owner_id: AccountId,
        token_id: TokenId,
        msg: String,
    ) -> PromiseOrValue<bool> {
        require!(
            env::predecessor_account_id() == self.nft_contract,
            "ERR_WRONG_NFT_CONTRACT"
        );
        require!(sender_id == previous_owner_id, "ERR_NO_APPROVALS");
        let ListMsg { price } =
            serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("ERR_BAD_MSG"));
        require!(price >= MIN_PRICE, "ERR_PRICE");
        require!(
            self.listings.get(&token_id).is_none(),
            "ERR_ALREADY_LISTED"
        );

        let seller = previous_owner_id;
        let balance = self.deposit_of(seller.clone());
        require!(
            balance >= self.listing_deposit,
            "ERR_NO_LISTING_DEPOSIT"
        );
        let rest = balance.saturating_sub(self.listing_deposit);
        if rest.is_zero() {
            self.deposits.remove(&seller);
        } else {
            self.deposits.insert(&seller, &rest);
        }

        let before = env::storage_usage();
        self.listings.insert(
            &token_id,
            &Listing {
                token_id: token_id.clone(),
                seller: seller.clone(),
                price,
                deposit: self.listing_deposit,
                listed_at_ns: U64(env::block_timestamp()),
                state: ListingState::Listed,
            },
        );
        let used = env::storage_usage().saturating_sub(before);
        require!(
            env::storage_byte_cost().saturating_mul(used as u128) <= self.listing_deposit,
            "ERR_LISTING_DEPOSIT_BELOW_STORAGE"
        );

        emit(
            "listed",
            json!({ "token_id": token_id, "seller": seller, "price": price }),
        );
        PromiseOrValue::Value(false)
    }
}

impl Market {
    fn listing_or_panic(&self, token_id: &TokenId) -> Listing {
        self.listings
            .get(token_id)
            .unwrap_or_else(|| env::panic_str("ERR_NOT_LISTED"))
    }

    /// Bearer's own transfer gate checks, in the same receipt that moves the vault, that it is
    /// still sealed and still held here (M2). Settlement waits for its answer.
    fn move_vault(&self, token_id: TokenId, receiver_id: AccountId) -> Promise {
        let args = json!({ "receiver_id": receiver_id, "token_id": token_id, "memo": "bearer market" });
        Promise::new(self.nft_contract.clone())
            .function_call(
                "nft_transfer".to_string(),
                serde_json::to_vec(&args).unwrap_or_default(),
                ONE_YOCTO,
                GAS_FOR_NFT_TRANSFER,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_ON_MOVED)
                    .on_vault_moved(token_id),
            )
    }

    fn pay(&self, account_id: AccountId, amount: NearToken) -> Promise {
        Promise::new(account_id.clone()).transfer(amount).then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_FOR_ON_PAYOUT)
                .on_payout(account_id, amount),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{testing_env_with_promise_results, VMContextBuilder};
    use near_sdk::{testing_env, PromiseResult};

    fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }
    const NEAR: u128 = 10u128.pow(24);
    const DEPOSIT: NearToken = NearToken::from_millinear(10);

    fn ctx(predecessor: &str, deposit: u128) -> VMContextBuilder {
        let mut c = VMContextBuilder::new();
        c.current_account_id(acc("market.test"))
            .predecessor_account_id(acc(predecessor))
            .signer_account_id(acc(predecessor))
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .prepaid_gas(Gas::from_tgas(100))
            .account_balance(NearToken::from_near(10));
        c
    }

    fn market() -> Market {
        testing_env!(ctx("deployer.test", 0).build());
        Market::new(acc("bearer.test"), DEPOSIT)
    }

    fn listed(m: &mut Market, seller: &str, token: &str, price: u128) {
        testing_env!(ctx(seller, DEPOSIT.as_yoctonear()).build());
        m.deposit_for_listing();
        testing_env!(ctx("bearer.test", 0).build());
        let msg = format!("{{\"price\":\"{price}\"}}");
        let _ = m.nft_on_transfer(acc(seller), acc(seller), token.to_string(), msg);
    }

    fn listing(seller: &str, state: ListingState) -> Listing {
        Listing {
            token_id: "7".into(),
            seller: acc(seller),
            price: NearToken::from_near(2),
            deposit: DEPOSIT,
            listed_at_ns: U64(0),
            state,
        }
    }

    #[test]
    fn settle_every_branch() {
        let buyer = ListingState::Selling { buyer: acc("bob.test") };
        assert_eq!(
            settle(&listing("alice.test", buyer.clone()), true),
            Settlement::Sold {
                seller: acc("alice.test"),
                buyer: acc("bob.test"),
                payout: NearToken::from_near(2).saturating_add(DEPOSIT),
            }
        );
        assert_eq!(
            settle(&listing("alice.test", buyer), false),
            Settlement::Refunded { buyer: acc("bob.test"), refund: NearToken::from_near(2) }
        );
        assert_eq!(
            settle(&listing("alice.test", ListingState::Returning), true),
            Settlement::Delisted { seller: acc("alice.test"), refund: DEPOSIT }
        );
        assert_eq!(settle(&listing("alice.test", ListingState::Returning), false), Settlement::StillListed);
        assert_eq!(settle(&listing("alice.test", ListingState::Listed), true), Settlement::Nothing);
    }

    #[test]
    #[should_panic(expected = "ERR_WRONG_NFT_CONTRACT")]
    fn only_bearer_can_list() {
        let mut m = market();
        testing_env!(ctx("fake-nft.test", 0).build());
        let _ = m.nft_on_transfer(acc("eve.test"), acc("eve.test"), "1".into(), r#"{"price":"1000000000000000000000"}"#.into());
    }

    #[test]
    #[should_panic(expected = "ERR_NO_LISTING_DEPOSIT")]
    fn listing_needs_a_deposit() {
        let mut m = market();
        testing_env!(ctx("bearer.test", 0).build());
        let _ = m.nft_on_transfer(acc("alice.test"), acc("alice.test"), "1".into(), r#"{"price":"1000000000000000000000"}"#.into());
    }

    #[test]
    #[should_panic(expected = "ERR_BAD_MSG")]
    fn listing_needs_a_price() {
        let mut m = market();
        testing_env!(ctx("alice.test", DEPOSIT.as_yoctonear()).build());
        m.deposit_for_listing();
        testing_env!(ctx("bearer.test", 0).build());
        let _ = m.nft_on_transfer(acc("alice.test"), acc("alice.test"), "1".into(), "2 NEAR".into());
    }

    #[test]
    #[should_panic(expected = "ERR_PRICE")]
    fn price_below_minimum() {
        let mut m = market();
        listed(&mut m, "alice.test", "1", 1);
    }

    #[test]
    fn listing_holds_the_deposit_and_covers_its_storage() {
        let mut m = market();
        listed(&mut m, "alice.test", "1", 2 * NEAR);
        let l = m.listing("1".into()).unwrap();
        assert_eq!(l.seller, acc("alice.test"));
        assert_eq!(l.price, NearToken::from_near(2));
        assert_eq!(l.deposit, DEPOSIT);
        assert_eq!(l.state, ListingState::Listed);
        assert!(m.deposit_of(acc("alice.test")).is_zero());
    }

    #[test]
    #[should_panic(expected = "ERR_WRONG_PRICE")]
    fn buy_needs_the_exact_price() {
        let mut m = market();
        listed(&mut m, "alice.test", "1", 2 * NEAR);
        testing_env!(ctx("bob.test", 2 * NEAR - 1).build());
        let _ = m.buy("1".into());
    }

    #[test]
    #[should_panic(expected = "ERR_OWN_LISTING")]
    fn seller_cannot_buy_own_listing() {
        let mut m = market();
        listed(&mut m, "alice.test", "1", 2 * NEAR);
        testing_env!(ctx("alice.test", 2 * NEAR).build());
        let _ = m.buy("1".into());
    }

    #[test]
    #[should_panic(expected = "ERR_GAS")]
    fn buy_needs_gas_for_the_whole_settlement() {
        let mut m = market();
        listed(&mut m, "alice.test", "1", 2 * NEAR);
        let mut c = ctx("bob.test", 2 * NEAR);
        c.prepaid_gas(Gas::from_tgas(40));
        testing_env!(c.build());
        let _ = m.buy("1".into());
    }

    #[test]
    fn second_buyer_is_refused_while_a_sale_is_pending() {
        let mut m = market();
        listed(&mut m, "alice.test", "1", 2 * NEAR);
        testing_env!(ctx("bob.test", 2 * NEAR).build());
        let _ = m.buy("1".into());
        assert_eq!(m.listing("1".into()).unwrap().state, ListingState::Selling { buyer: acc("bob.test") });
        testing_env!(ctx("carol.test", 2 * NEAR).build());
        let second = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| m.buy("1".into()).detach()));
        assert!(second.is_err());
    }

    #[test]
    #[should_panic(expected = "ERR_NOT_SELLER")]
    fn only_the_seller_can_delist() {
        let mut m = market();
        listed(&mut m, "alice.test", "1", 2 * NEAR);
        testing_env!(ctx("eve.test", 1).build());
        let _ = m.delist("1".into());
    }

    #[test]
    fn failed_move_restores_the_listing() {
        let mut m = market();
        listed(&mut m, "alice.test", "1", 2 * NEAR);
        testing_env!(ctx("bob.test", 2 * NEAR).build());
        let _ = m.buy("1".into());
        testing_env_with_promise_results(ctx("market.test", 0).build(), PromiseResult::Failed);
        m.on_vault_moved("1".into());
        assert_eq!(m.listing("1".into()).unwrap().state, ListingState::Listed);
    }

    #[test]
    fn successful_move_ends_the_listing() {
        let mut m = market();
        listed(&mut m, "alice.test", "1", 2 * NEAR);
        testing_env!(ctx("bob.test", 2 * NEAR).build());
        let _ = m.buy("1".into());
        testing_env_with_promise_results(ctx("market.test", 0).build(), PromiseResult::Successful(vec![]));
        m.on_vault_moved("1".into());
        assert!(m.listing("1".into()).is_none());
    }

    #[test]
    fn bounced_payout_becomes_claimable() {
        let mut m = market();
        testing_env_with_promise_results(ctx("market.test", 0).build(), PromiseResult::Failed);
        m.on_payout(acc("gone.test"), NearToken::from_near(2));
        m.on_payout(acc("gone.test"), DEPOSIT);
        assert_eq!(m.claimable_of(acc("gone.test")), NearToken::from_near(2).saturating_add(DEPOSIT));
        testing_env_with_promise_results(ctx("market.test", 0).build(), PromiseResult::Successful(vec![]));
        m.on_payout(acc("here.test"), NearToken::from_near(1));
        assert!(m.claimable_of(acc("here.test")).is_zero());
    }
}
