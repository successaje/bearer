//! Bearer lend: borrow NEAR against a sealed vault; repay to get it back, or the lender takes it.
//!
//! Escrow by transfer, like the market and the schedule. The borrower sends the vault here with
//! `nft_transfer_call` and a message naming the loan: how much they want, how much they'll pay
//! back and for how long. A lender who agrees calls `fund` with exactly that amount; it goes
//! straight to the borrower and the term starts. Before the due date only the borrower can
//! `repay`, which returns the vault to them and pays the lender. From the due date only the
//! lender can `foreclose`, which hands them the vault.
//!
//! Nothing here calls `break_seal`, so a pledged vault stays sealed: nobody can take its coins
//! out meanwhile, the borrower included. There is no price feed and no early liquidation; the
//! lender decides how much to lend against what the vault holds. Settlement moves the vault
//! first and money second, as in the market. Threats L1–L11 in docs/THREAT_MODEL.md.
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

const GAS_FOR_NFT_TRANSFER: Gas = Gas::from_tgas(20);
/// Settles a move, including up to two payouts and their callbacks.
const GAS_FOR_ON_MOVED: Gas = Gas::from_tgas(35);
const GAS_FOR_ON_PAYOUT: Gas = Gas::from_tgas(5);
/// `repay`, `foreclose` and `cancel_request` refuse less, so settlement can't stop halfway (L5).
const GAS_FOR_MOVE_AND_SETTLE: Gas = Gas::from_tgas(70);
const GAS_FOR_VAULT_VIEW: Gas = Gas::from_tgas(10);
const GAS_FOR_ON_UNREQUESTED_READ: Gas = Gas::from_tgas(30);
const GAS_FOR_RETURN_UNREQUESTED: Gas = Gas::from_tgas(50);
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const SECOND: u64 = 1_000_000_000;
/// Below this a loan is more likely a typo than an offer.
pub const MIN_PRINCIPAL: NearToken = NearToken::from_millinear(1);
/// A term under a minute is more likely a mistake than a loan.
pub const MIN_TERM_NS: u64 = 60 * SECOND;
/// About ten years.
pub const MAX_TERM_NS: u64 = 10 * 366 * 24 * 3600 * SECOND;
/// What funding adds to a loan's record: the lender's name (length and up to 64 bytes) and the
/// due date. The deposit has to cover the funded size, checked when the loan is requested (L6).
const FUNDING_BYTES: u64 = 4 + 64 + 8;
/// A vault view is about 1.5 KB; this bounds what the custody read will accept.
const MAX_VAULT_VIEW: usize = 16 * 1024;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Loans,
    Deposits,
    Claimable,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LoanState {
    /// Waiting for a lender. The borrower may take the vault back.
    Requested,
    /// The borrower took the request back; the vault is on its way to them.
    Cancelling,
    /// Funded: the borrower has the NEAR, and has until `due_at_ns` to repay.
    Active { lender: AccountId, due_at_ns: U64 },
    /// The borrower paid; the vault is on its way back to them.
    Repaying { lender: AccountId, due_at_ns: U64 },
    /// Past the due date; the vault is on its way to the lender.
    Foreclosing { lender: AccountId, due_at_ns: U64 },
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Loan {
    pub token_id: TokenId,
    pub borrower: AccountId,
    /// Exactly what `fund` must attach; it goes to the borrower.
    pub principal: NearToken,
    /// Exactly what `repay` must attach; it goes to the lender.
    pub repayment: NearToken,
    /// How long the borrower has to repay, counted from funding.
    pub term_ns: U64,
    /// Taken from the borrower's loan balance; paid back to them when the loan ends, either way.
    pub deposit: NearToken,
    pub requested_at_ns: U64,
    pub state: LoanState,
}

#[near(serializers = [json])]
pub struct LendConfig {
    pub nft_contract: AccountId,
    pub loan_deposit: NearToken,
    pub min_principal: NearToken,
    pub min_term_ns: U64,
    pub max_term_ns: U64,
}

#[near(serializers = [json])]
struct RequestMsg {
    principal: NearToken,
    repayment: NearToken,
    term_ns: U64,
}

/// The parts of Bearer's `vault` view that `return_unrequested` reads.
#[near(serializers = [json])]
struct VaultSummary {
    owner_id: AccountId,
    custody: Vec<CustodyEntry>,
}

#[near(serializers = [json])]
struct CustodyEntry {
    account_id: AccountId,
}

/// What a finished vault move means for its loan, and who gets paid.
#[derive(Debug, PartialEq)]
pub enum Settlement {
    /// The vault is back with the borrower: the loan ends, the lender gets the repayment and the
    /// borrower the deposit.
    Repaid {
        borrower: AccountId,
        lender: AccountId,
        repayment: NearToken,
        deposit: NearToken,
    },
    /// The vault didn't move: the loan stands again and the borrower gets the repayment back.
    RepayRefunded {
        borrower: AccountId,
        refund: NearToken,
        back_to: LoanState,
    },
    /// The vault reached the lender: the loan ends and the borrower gets the deposit back.
    Foreclosed {
        borrower: AccountId,
        lender: AccountId,
        deposit: NearToken,
    },
    /// The vault is back with the borrower before anyone lent: the request ends, deposit back.
    Cancelled { borrower: AccountId, deposit: NearToken },
    /// The vault didn't move and no money was taken: the loan stands as it was.
    StillHeld { back_to: LoanState },
    /// Nothing was in flight for this loan.
    Nothing,
}

/// Pure, so every branch is unit-tested without a chain.
pub fn settle(loan: &Loan, moved: bool) -> Settlement {
    match (&loan.state, moved) {
        (LoanState::Repaying { lender, .. }, true) => Settlement::Repaid {
            borrower: loan.borrower.clone(),
            lender: lender.clone(),
            repayment: loan.repayment,
            deposit: loan.deposit,
        },
        (LoanState::Repaying { lender, due_at_ns }, false) => Settlement::RepayRefunded {
            borrower: loan.borrower.clone(),
            refund: loan.repayment,
            back_to: LoanState::Active {
                lender: lender.clone(),
                due_at_ns: *due_at_ns,
            },
        },
        (LoanState::Foreclosing { lender, .. }, true) => Settlement::Foreclosed {
            borrower: loan.borrower.clone(),
            lender: lender.clone(),
            deposit: loan.deposit,
        },
        (LoanState::Foreclosing { lender, due_at_ns }, false) => Settlement::StillHeld {
            back_to: LoanState::Active {
                lender: lender.clone(),
                due_at_ns: *due_at_ns,
            },
        },
        (LoanState::Cancelling, true) => Settlement::Cancelled {
            borrower: loan.borrower.clone(),
            deposit: loan.deposit,
        },
        (LoanState::Cancelling, false) => Settlement::StillHeld {
            back_to: LoanState::Requested,
        },
        (LoanState::Requested | LoanState::Active { .. }, _) => Settlement::Nothing,
    }
}

/// NEP-297 event under the lending contract's own standard.
fn emit(event: &str, data: Value) {
    let payload = json!({
        "standard": "bearer_lend",
        "version": "1.0.0",
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{payload}"));
}

// The lending contract implements the receiving side of NEP-171 and emits NEP-297 events.
#[near(
    contract_state,
    contract_metadata(standard(standard = "nep297", version = "1.0.0"))
)]
#[derive(PanicOnDefault)]
pub struct Lend {
    nft_contract: AccountId,
    loan_deposit: NearToken,
    loans: UnorderedMap<TokenId, Loan>,
    /// Loan balances not held by a loan, per borrower (L6).
    deposits: LookupMap<AccountId, NearToken>,
    /// Payouts that bounced, per account (L4).
    claimable: LookupMap<AccountId, NearToken>,
}

#[near]
impl Lend {
    /// No owner, admin or upgrade methods exist (L10). Both settings are fixed here.
    #[init]
    pub fn new(nft_contract: AccountId, loan_deposit: NearToken) -> Self {
        require!(!loan_deposit.is_zero(), "ERR_CONFIG");
        Self {
            nft_contract,
            loan_deposit,
            loans: UnorderedMap::new(StorageKey::Loans),
            deposits: LookupMap::new(StorageKey::Deposits),
            claimable: LookupMap::new(StorageKey::Claimable),
        }
    }

    /// Pays for loan requests ahead of time. Each request holds `loan_deposit` from this balance
    /// and returns it when the loan ends (L6). The request can't carry the deposit itself:
    /// `nft_transfer_call` forwards exactly 1 yoctoNEAR.
    #[payable]
    pub fn deposit_for_loan(&mut self) -> NearToken {
        require!(env::attached_deposit() >= self.loan_deposit, "ERR_DEPOSIT");
        let account = env::predecessor_account_id();
        let balance = self
            .deposit_of(account.clone())
            .saturating_add(env::attached_deposit());
        self.deposits.insert(&account, &balance);
        balance
    }

    /// Returns the caller's loan balance that no loan holds.
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

    /// Lends against a requested vault: attach exactly its principal, and pass the repayment and
    /// term you agreed to, so a request swapped in the meantime is refused (L7). The principal
    /// goes straight to the borrower and the term starts now. The vault stays here, sealed.
    /// Fails: `ERR_NO_LOAN`, `ERR_NOT_REQUESTED`, `ERR_OWN_LOAN`, `ERR_WRONG_PRINCIPAL`,
    /// `ERR_TERMS_CHANGED`.
    #[payable]
    pub fn fund(&mut self, token_id: TokenId, repayment: NearToken, term_ns: U64) -> Promise {
        let mut loan = self.loan_or_panic(&token_id);
        require!(loan.state == LoanState::Requested, "ERR_NOT_REQUESTED");
        let lender = env::predecessor_account_id();
        require!(lender != loan.borrower, "ERR_OWN_LOAN");
        require!(
            env::attached_deposit() == loan.principal,
            "ERR_WRONG_PRINCIPAL"
        );
        require!(
            repayment == loan.repayment && term_ns == loan.term_ns,
            "ERR_TERMS_CHANGED"
        );
        let due_at_ns = U64(env::block_timestamp().saturating_add(loan.term_ns.0));
        loan.state = LoanState::Active {
            lender: lender.clone(),
            due_at_ns,
        };
        self.loans.insert(&token_id, &loan);
        emit(
            "funded",
            json!({ "token_id": token_id, "borrower": loan.borrower, "lender": lender, "principal": loan.principal, "repayment": loan.repayment, "due_at_ns": due_at_ns }),
        );
        self.pay(loan.borrower, loan.principal)
    }

    /// The borrower pays back and gets the vault: attach exactly the repayment, before the due
    /// date. The vault moves first; the lender is paid only once it has (L3). If it doesn't
    /// move, the repayment comes back and the loan stands.
    /// Fails: `ERR_NO_LOAN`, `ERR_NOT_ACTIVE`, `ERR_NOT_BORROWER`, `ERR_PAST_DUE`,
    /// `ERR_WRONG_REPAYMENT`, `ERR_GAS`.
    #[payable]
    pub fn repay(&mut self, token_id: TokenId) -> Promise {
        let mut loan = self.loan_or_panic(&token_id);
        let LoanState::Active { lender, due_at_ns } = loan.state.clone() else {
            env::panic_str("ERR_NOT_ACTIVE")
        };
        require!(
            env::predecessor_account_id() == loan.borrower,
            "ERR_NOT_BORROWER"
        );
        require!(env::block_timestamp() < due_at_ns.0, "ERR_PAST_DUE");
        require!(
            env::attached_deposit() == loan.repayment,
            "ERR_WRONG_REPAYMENT"
        );
        require!(env::prepaid_gas() >= GAS_FOR_MOVE_AND_SETTLE, "ERR_GAS");
        loan.state = LoanState::Repaying { lender, due_at_ns };
        self.loans.insert(&token_id, &loan);
        let borrower = loan.borrower.clone();
        self.move_vault(token_id, borrower, "bearer lend: repaid")
    }

    /// From the due date, the lender takes the vault. Attach 1 yoctoNEAR.
    /// Fails: `ERR_NO_LOAN`, `ERR_NOT_ACTIVE`, `ERR_NOT_LENDER`, `ERR_NOT_DUE`, `ERR_GAS`.
    #[payable]
    pub fn foreclose(&mut self, token_id: TokenId) -> Promise {
        assert_one_yocto();
        let mut loan = self.loan_or_panic(&token_id);
        let LoanState::Active { lender, due_at_ns } = loan.state.clone() else {
            env::panic_str("ERR_NOT_ACTIVE")
        };
        require!(env::predecessor_account_id() == lender, "ERR_NOT_LENDER");
        require!(env::block_timestamp() >= due_at_ns.0, "ERR_NOT_DUE");
        require!(env::prepaid_gas() >= GAS_FOR_MOVE_AND_SETTLE, "ERR_GAS");
        loan.state = LoanState::Foreclosing {
            lender: lender.clone(),
            due_at_ns,
        };
        self.loans.insert(&token_id, &loan);
        self.move_vault(token_id, lender, "bearer lend: foreclosed")
    }

    /// The borrower takes back a request nobody has funded yet, with its deposit. Attach
    /// 1 yoctoNEAR.
    /// Fails: `ERR_NO_LOAN`, `ERR_NOT_REQUESTED`, `ERR_NOT_BORROWER`, `ERR_GAS`.
    #[payable]
    pub fn cancel_request(&mut self, token_id: TokenId) -> Promise {
        assert_one_yocto();
        let mut loan = self.loan_or_panic(&token_id);
        require!(loan.state == LoanState::Requested, "ERR_NOT_REQUESTED");
        require!(
            env::predecessor_account_id() == loan.borrower,
            "ERR_NOT_BORROWER"
        );
        require!(env::prepaid_gas() >= GAS_FOR_MOVE_AND_SETTLE, "ERR_GAS");
        loan.state = LoanState::Cancelling;
        self.loans.insert(&token_id, &loan);
        let borrower = loan.borrower.clone();
        self.move_vault(token_id, borrower, "bearer lend: request cancelled")
    }

    /// Sends money that bounced earlier (L4) to the caller. Attach 1 yoctoNEAR.
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

    /// Sends back a vault that arrived by plain `nft_transfer` and so was never pledged (L9). It
    /// goes to whoever held it before this contract, read from the vault's custody log. Anyone
    /// may call this; it does nothing for a pledged vault or one this contract doesn't hold.
    pub fn return_unrequested(&mut self, token_id: TokenId) -> Promise {
        require!(self.loans.get(&token_id).is_none(), "ERR_PLEDGED");
        require!(
            env::prepaid_gas() >= GAS_FOR_RETURN_UNREQUESTED,
            "ERR_GAS"
        );
        Promise::new(self.nft_contract.clone())
            .function_call(
                "vault".to_string(),
                serde_json::to_vec(&json!({ "token_id": token_id })).unwrap_or_default(),
                NearToken::from_yoctonear(0),
                GAS_FOR_VAULT_VIEW,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_ON_UNREQUESTED_READ)
                    .on_unrequested_read(token_id),
            )
    }

    /// Never panics (L5): whatever happened to the vault, the loan ends in a known state.
    #[private]
    pub fn on_vault_moved(&mut self, token_id: TokenId) {
        let Some(loan) = self.loans.get(&token_id) else {
            return;
        };
        let moved = env::promise_result_checked(0, 64).is_ok();
        match settle(&loan, moved) {
            Settlement::Repaid {
                borrower,
                lender,
                repayment,
                deposit,
            } => {
                self.loans.remove(&token_id);
                emit(
                    "repaid",
                    json!({ "token_id": token_id, "borrower": borrower, "lender": lender, "repayment": repayment }),
                );
                self.pay(lender, repayment).detach();
                self.pay(borrower, deposit).detach();
            }
            Settlement::RepayRefunded {
                borrower,
                refund,
                back_to,
            } => {
                self.loans.insert(
                    &token_id,
                    &Loan {
                        state: back_to,
                        ..loan
                    },
                );
                emit(
                    "repay_failed",
                    json!({ "token_id": token_id, "borrower": borrower, "refund": refund }),
                );
                self.pay(borrower, refund).detach();
            }
            Settlement::Foreclosed {
                borrower,
                lender,
                deposit,
            } => {
                self.loans.remove(&token_id);
                emit(
                    "foreclosed",
                    json!({ "token_id": token_id, "borrower": borrower, "lender": lender }),
                );
                self.pay(borrower, deposit).detach();
            }
            Settlement::Cancelled { borrower, deposit } => {
                self.loans.remove(&token_id);
                emit(
                    "cancelled",
                    json!({ "token_id": token_id, "borrower": borrower }),
                );
                self.pay(borrower, deposit).detach();
            }
            Settlement::StillHeld { back_to } => {
                self.loans.insert(
                    &token_id,
                    &Loan {
                        state: back_to,
                        ..loan
                    },
                );
                emit("move_failed", json!({ "token_id": token_id }));
            }
            Settlement::Nothing => {}
        }
    }

    /// A payout that bounced (the account no longer exists) is kept for `claim` (L4).
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

    /// Second half of `return_unrequested`. Never panics.
    #[private]
    pub fn on_unrequested_read(&mut self, token_id: TokenId) {
        if self.loans.get(&token_id).is_some() {
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
        Promise::new(self.nft_contract.clone())
            .function_call(
                "nft_transfer".to_string(),
                serde_json::to_vec(&json!({ "receiver_id": to, "token_id": token_id, "memo": "bearer lend: never requested" }))
                    .unwrap_or_default(),
                ONE_YOCTO,
                GAS_FOR_NFT_TRANSFER,
            )
            .detach();
    }

    /* ---------- views ---------- */

    pub fn loans(&self, from_index: Option<u64>, limit: Option<u64>) -> Vec<Loan> {
        self.loans
            .values()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50).min(100) as usize)
            .collect()
    }

    pub fn loan(&self, token_id: TokenId) -> Option<Loan> {
        self.loans.get(&token_id)
    }

    pub fn loan_count(&self) -> u64 {
        self.loans.len()
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

    pub fn get_config(&self) -> LendConfig {
        LendConfig {
            nft_contract: self.nft_contract.clone(),
            loan_deposit: self.loan_deposit,
            min_principal: MIN_PRINCIPAL,
            min_term_ns: U64(MIN_TERM_NS),
            max_term_ns: U64(MAX_TERM_NS),
        }
    }
}

#[near]
impl NonFungibleTokenReceiver for Lend {
    /// Opens a loan request for a vault the Bearer contract just moved here. `msg` is
    /// `{"principal":"<yoctoNEAR>","repayment":"<yoctoNEAR>","term_ns":"<ns>"}`.
    /// Any panic sends the vault straight back to the borrower (NEP-171 resolve).
    /// Fails: `ERR_WRONG_NFT_CONTRACT` (L1), `ERR_NO_APPROVALS`, `ERR_BAD_MSG`, `ERR_PRINCIPAL`,
    /// `ERR_REPAYMENT`, `ERR_TERM`, `ERR_ALREADY_REQUESTED`, `ERR_NO_LOAN_DEPOSIT`,
    /// `ERR_LOAN_DEPOSIT_BELOW_STORAGE`.
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
        let RequestMsg {
            principal,
            repayment,
            term_ns,
        } = serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("ERR_BAD_MSG"));
        require!(principal >= MIN_PRINCIPAL, "ERR_PRINCIPAL");
        require!(repayment >= principal, "ERR_REPAYMENT");
        require!(
            term_ns.0 >= MIN_TERM_NS && term_ns.0 <= MAX_TERM_NS,
            "ERR_TERM"
        );
        require!(
            self.loans.get(&token_id).is_none(),
            "ERR_ALREADY_REQUESTED"
        );

        let borrower = previous_owner_id;
        let balance = self.deposit_of(borrower.clone());
        require!(balance >= self.loan_deposit, "ERR_NO_LOAN_DEPOSIT");
        let rest = balance.saturating_sub(self.loan_deposit);
        if rest.is_zero() {
            self.deposits.remove(&borrower);
        } else {
            self.deposits.insert(&borrower, &rest);
        }

        let before = env::storage_usage();
        self.loans.insert(
            &token_id,
            &Loan {
                token_id: token_id.clone(),
                borrower: borrower.clone(),
                principal,
                repayment,
                term_ns,
                deposit: self.loan_deposit,
                requested_at_ns: U64(env::block_timestamp()),
                state: LoanState::Requested,
            },
        );
        let used = env::storage_usage()
            .saturating_sub(before)
            .saturating_add(FUNDING_BYTES);
        require!(
            env::storage_byte_cost().saturating_mul(used as u128) <= self.loan_deposit,
            "ERR_LOAN_DEPOSIT_BELOW_STORAGE"
        );

        emit(
            "requested",
            json!({ "token_id": token_id, "borrower": borrower, "principal": principal, "repayment": repayment, "term_ns": term_ns }),
        );
        PromiseOrValue::Value(false)
    }
}

impl Lend {
    fn loan_or_panic(&self, token_id: &TokenId) -> Loan {
        self.loans
            .get(token_id)
            .unwrap_or_else(|| env::panic_str("ERR_NO_LOAN"))
    }

    /// Bearer's own transfer gate checks, in the same receipt that moves the vault, that it is
    /// still sealed and still held here (L2). Settlement waits for its answer.
    fn move_vault(&self, token_id: TokenId, receiver_id: AccountId, memo: &str) -> Promise {
        let args = json!({ "receiver_id": receiver_id, "token_id": token_id, "memo": memo });
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
    const NOW: u64 = 1_800_000_000 * SECOND;
    const DAY: u64 = 24 * 3600 * SECOND;

    fn ctx_at(predecessor: &str, deposit: u128, now: u64) -> VMContextBuilder {
        let mut c = VMContextBuilder::new();
        c.current_account_id(acc("lend.test"))
            .predecessor_account_id(acc(predecessor))
            .signer_account_id(acc(predecessor))
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .prepaid_gas(Gas::from_tgas(100))
            .block_timestamp(now)
            .account_balance(NearToken::from_near(10));
        c
    }

    fn ctx(predecessor: &str, deposit: u128) -> VMContextBuilder {
        ctx_at(predecessor, deposit, NOW)
    }

    fn lend() -> Lend {
        testing_env!(ctx("deployer.test", 0).build());
        Lend::new(acc("bearer.test"), DEPOSIT)
    }

    fn terms(principal: u128, repayment: u128, term_ns: u64) -> String {
        format!("{{\"principal\":\"{principal}\",\"repayment\":\"{repayment}\",\"term_ns\":\"{term_ns}\"}}")
    }

    /// alice asks for 2 NEAR against vault 1, repaying 2.1 NEAR within 30 days.
    fn requested(l: &mut Lend) {
        testing_env!(ctx("alice.test", DEPOSIT.as_yoctonear()).build());
        l.deposit_for_loan();
        testing_env!(ctx("bearer.test", 0).build());
        let _ = l.nft_on_transfer(
            acc("alice.test"),
            acc("alice.test"),
            "1".into(),
            terms(2 * NEAR, 21 * NEAR / 10, 30 * DAY),
        );
    }

    /// The same loan, funded by bob at NOW.
    fn funded(l: &mut Lend) {
        requested(l);
        testing_env!(ctx("bob.test", 2 * NEAR).build());
        let _ = l.fund("1".into(), NearToken::from_yoctonear(21 * NEAR / 10), U64(30 * DAY));
    }

    fn loan(state: LoanState) -> Loan {
        Loan {
            token_id: "7".into(),
            borrower: acc("alice.test"),
            principal: NearToken::from_near(2),
            repayment: NearToken::from_yoctonear(21 * NEAR / 10),
            term_ns: U64(30 * DAY),
            deposit: DEPOSIT,
            requested_at_ns: U64(NOW),
            state,
        }
    }

    #[test]
    fn settle_every_branch() {
        let due = U64(NOW + 30 * DAY);
        let active = LoanState::Active { lender: acc("bob.test"), due_at_ns: due };
        let repaying = LoanState::Repaying { lender: acc("bob.test"), due_at_ns: due };
        let foreclosing = LoanState::Foreclosing { lender: acc("bob.test"), due_at_ns: due };
        assert_eq!(
            settle(&loan(repaying.clone()), true),
            Settlement::Repaid {
                borrower: acc("alice.test"),
                lender: acc("bob.test"),
                repayment: NearToken::from_yoctonear(21 * NEAR / 10),
                deposit: DEPOSIT,
            }
        );
        assert_eq!(
            settle(&loan(repaying), false),
            Settlement::RepayRefunded {
                borrower: acc("alice.test"),
                refund: NearToken::from_yoctonear(21 * NEAR / 10),
                back_to: active.clone(),
            }
        );
        assert_eq!(
            settle(&loan(foreclosing.clone()), true),
            Settlement::Foreclosed { borrower: acc("alice.test"), lender: acc("bob.test"), deposit: DEPOSIT }
        );
        assert_eq!(settle(&loan(foreclosing), false), Settlement::StillHeld { back_to: active.clone() });
        assert_eq!(
            settle(&loan(LoanState::Cancelling), true),
            Settlement::Cancelled { borrower: acc("alice.test"), deposit: DEPOSIT }
        );
        assert_eq!(
            settle(&loan(LoanState::Cancelling), false),
            Settlement::StillHeld { back_to: LoanState::Requested }
        );
        assert_eq!(settle(&loan(LoanState::Requested), true), Settlement::Nothing);
        assert_eq!(settle(&loan(active), true), Settlement::Nothing);
    }

    #[test]
    #[should_panic(expected = "ERR_WRONG_NFT_CONTRACT")]
    fn only_bearer_can_request() {
        let mut l = lend();
        testing_env!(ctx("fake-nft.test", 0).build());
        let _ = l.nft_on_transfer(acc("eve.test"), acc("eve.test"), "1".into(), terms(2 * NEAR, 2 * NEAR, DAY));
    }

    #[test]
    #[should_panic(expected = "ERR_NO_LOAN_DEPOSIT")]
    fn request_needs_a_deposit() {
        let mut l = lend();
        testing_env!(ctx("bearer.test", 0).build());
        let _ = l.nft_on_transfer(acc("alice.test"), acc("alice.test"), "1".into(), terms(2 * NEAR, 2 * NEAR, DAY));
    }

    #[test]
    #[should_panic(expected = "ERR_BAD_MSG")]
    fn request_needs_terms() {
        let mut l = lend();
        testing_env!(ctx("alice.test", DEPOSIT.as_yoctonear()).build());
        l.deposit_for_loan();
        testing_env!(ctx("bearer.test", 0).build());
        let _ = l.nft_on_transfer(acc("alice.test"), acc("alice.test"), "1".into(), r#"{"principal":"1"}"#.into());
    }

    fn request_panics(msg: String) -> String {
        let mut l = lend();
        testing_env!(ctx("alice.test", DEPOSIT.as_yoctonear()).build());
        l.deposit_for_loan();
        testing_env!(ctx("bearer.test", 0).build());
        let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = l.nft_on_transfer(acc("alice.test"), acc("alice.test"), "1".into(), msg);
        }))
        .expect_err("request should be refused");
        err.downcast_ref::<String>()
            .cloned()
            .or_else(|| err.downcast_ref::<&str>().map(|s| s.to_string()))
            .unwrap_or_default()
    }

    #[test]
    fn request_terms_are_checked() {
        assert!(request_panics(terms(1, 1, DAY)).contains("ERR_PRINCIPAL"));
        assert!(request_panics(terms(2 * NEAR, 2 * NEAR - 1, DAY)).contains("ERR_REPAYMENT"));
        assert!(request_panics(terms(2 * NEAR, 2 * NEAR, MIN_TERM_NS - 1)).contains("ERR_TERM"));
        assert!(request_panics(terms(2 * NEAR, 2 * NEAR, MAX_TERM_NS + 1)).contains("ERR_TERM"));
    }

    #[test]
    fn request_holds_the_deposit_and_covers_its_storage() {
        let mut l = lend();
        requested(&mut l);
        let x = l.loan("1".into()).unwrap();
        assert_eq!(x.borrower, acc("alice.test"));
        assert_eq!(x.principal, NearToken::from_near(2));
        assert_eq!(x.deposit, DEPOSIT);
        assert_eq!(x.state, LoanState::Requested);
        assert!(l.deposit_of(acc("alice.test")).is_zero());
    }

    #[test]
    fn funding_fits_in_the_bytes_the_deposit_reserved() {
        let requested = near_sdk::borsh::to_vec(&loan(LoanState::Requested)).unwrap().len();
        let longest_lender = acc(&"a".repeat(64));
        let funded = near_sdk::borsh::to_vec(&loan(LoanState::Repaying {
            lender: longest_lender,
            due_at_ns: U64(u64::MAX),
        }))
        .unwrap()
        .len();
        assert!((funded - requested) as u64 <= FUNDING_BYTES);
    }

    #[test]
    #[should_panic(expected = "ERR_WRONG_PRINCIPAL")]
    fn fund_needs_the_exact_principal() {
        let mut l = lend();
        requested(&mut l);
        testing_env!(ctx("bob.test", 2 * NEAR - 1).build());
        let _ = l.fund("1".into(), NearToken::from_yoctonear(21 * NEAR / 10), U64(30 * DAY));
    }

    #[test]
    #[should_panic(expected = "ERR_TERMS_CHANGED")]
    fn fund_refuses_changed_terms() {
        let mut l = lend();
        requested(&mut l);
        testing_env!(ctx("bob.test", 2 * NEAR).build());
        let _ = l.fund("1".into(), NearToken::from_near(2), U64(30 * DAY));
    }

    #[test]
    #[should_panic(expected = "ERR_OWN_LOAN")]
    fn borrower_cannot_fund_own_loan() {
        let mut l = lend();
        requested(&mut l);
        testing_env!(ctx("alice.test", 2 * NEAR).build());
        let _ = l.fund("1".into(), NearToken::from_yoctonear(21 * NEAR / 10), U64(30 * DAY));
    }

    #[test]
    fn fund_starts_the_term_and_locks_the_loan() {
        let mut l = lend();
        funded(&mut l);
        assert_eq!(
            l.loan("1".into()).unwrap().state,
            LoanState::Active { lender: acc("bob.test"), due_at_ns: U64(NOW + 30 * DAY) }
        );
        testing_env!(ctx("carol.test", 2 * NEAR).build());
        let second = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            l.fund("1".into(), NearToken::from_yoctonear(21 * NEAR / 10), U64(30 * DAY)).detach()
        }));
        assert!(second.is_err());
        testing_env!(ctx("alice.test", 1).build());
        let cancel = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| l.cancel_request("1".into()).detach()));
        assert!(cancel.is_err());
    }

    #[test]
    #[should_panic(expected = "ERR_NOT_BORROWER")]
    fn only_the_borrower_can_repay() {
        let mut l = lend();
        funded(&mut l);
        testing_env!(ctx("carol.test", 21 * NEAR / 10).build());
        let _ = l.repay("1".into());
    }

    #[test]
    #[should_panic(expected = "ERR_WRONG_REPAYMENT")]
    fn repay_needs_the_exact_repayment() {
        let mut l = lend();
        funded(&mut l);
        testing_env!(ctx("alice.test", 2 * NEAR).build());
        let _ = l.repay("1".into());
    }

    #[test]
    #[should_panic(expected = "ERR_PAST_DUE")]
    fn no_repaying_on_or_after_the_due_date() {
        let mut l = lend();
        funded(&mut l);
        testing_env!(ctx_at("alice.test", 21 * NEAR / 10, NOW + 30 * DAY).build());
        let _ = l.repay("1".into());
    }

    #[test]
    #[should_panic(expected = "ERR_GAS")]
    fn repay_needs_gas_for_the_whole_settlement() {
        let mut l = lend();
        funded(&mut l);
        let mut c = ctx("alice.test", 21 * NEAR / 10);
        c.prepaid_gas(Gas::from_tgas(50));
        testing_env!(c.build());
        let _ = l.repay("1".into());
    }

    #[test]
    #[should_panic(expected = "ERR_NOT_DUE")]
    fn foreclose_waits_for_the_due_date() {
        let mut l = lend();
        funded(&mut l);
        testing_env!(ctx_at("bob.test", 1, NOW + 30 * DAY - 1).build());
        let _ = l.foreclose("1".into());
    }

    #[test]
    #[should_panic(expected = "ERR_NOT_LENDER")]
    fn only_the_lender_can_foreclose() {
        let mut l = lend();
        funded(&mut l);
        testing_env!(ctx_at("carol.test", 1, NOW + 30 * DAY).build());
        let _ = l.foreclose("1".into());
    }

    #[test]
    #[should_panic(expected = "ERR_NOT_BORROWER")]
    fn only_the_borrower_can_cancel() {
        let mut l = lend();
        requested(&mut l);
        testing_env!(ctx("eve.test", 1).build());
        let _ = l.cancel_request("1".into());
    }

    #[test]
    fn failed_repay_restores_the_loan() {
        let mut l = lend();
        funded(&mut l);
        testing_env!(ctx("alice.test", 21 * NEAR / 10).build());
        let _ = l.repay("1".into());
        assert!(matches!(l.loan("1".into()).unwrap().state, LoanState::Repaying { .. }));
        testing_env_with_promise_results(ctx("lend.test", 0).build(), PromiseResult::Failed);
        l.on_vault_moved("1".into());
        assert_eq!(
            l.loan("1".into()).unwrap().state,
            LoanState::Active { lender: acc("bob.test"), due_at_ns: U64(NOW + 30 * DAY) }
        );
    }

    #[test]
    fn successful_repay_ends_the_loan() {
        let mut l = lend();
        funded(&mut l);
        testing_env!(ctx("alice.test", 21 * NEAR / 10).build());
        let _ = l.repay("1".into());
        testing_env_with_promise_results(ctx("lend.test", 0).build(), PromiseResult::Successful(vec![]));
        l.on_vault_moved("1".into());
        assert!(l.loan("1".into()).is_none());
    }

    #[test]
    fn failed_foreclosure_keeps_the_loan_for_another_try() {
        let mut l = lend();
        funded(&mut l);
        testing_env!(ctx_at("bob.test", 1, NOW + 31 * DAY).build());
        let _ = l.foreclose("1".into());
        testing_env_with_promise_results(ctx("lend.test", 0).build(), PromiseResult::Failed);
        l.on_vault_moved("1".into());
        assert!(matches!(l.loan("1".into()).unwrap().state, LoanState::Active { .. }));
    }

    #[test]
    fn bounced_payout_becomes_claimable() {
        let mut l = lend();
        testing_env_with_promise_results(ctx("lend.test", 0).build(), PromiseResult::Failed);
        l.on_payout(acc("gone.test"), NearToken::from_near(2));
        l.on_payout(acc("gone.test"), DEPOSIT);
        assert_eq!(l.claimable_of(acc("gone.test")), NearToken::from_near(2).saturating_add(DEPOSIT));
        testing_env_with_promise_results(ctx("lend.test", 0).build(), PromiseResult::Successful(vec![]));
        l.on_payout(acc("here.test"), NearToken::from_near(1));
        assert!(l.claimable_of(acc("here.test")).is_zero());
    }
}
