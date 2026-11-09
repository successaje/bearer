//! Bearer schedule: hand a sealed vault to someone on or after a chosen date.
//!
//! Escrow by transfer, like the market. The giver sends the vault here with `nft_transfer_call` on
//! the Bearer contract, naming the recipient and the date, and this contract holds it until then.
//! Nothing here calls `break_seal`, so the vault stays sealed and nobody can withdraw meanwhile,
//! the giver included (S6). Anyone may call `release` on or after the date. It first checks the
//! recipient's account exists: an NFT can be sent to a name nobody has registered yet, and
//! whoever registered it later would get the vault (S5). The giver chooses when scheduling
//! whether they may cancel before the date. Threats S1–S10 in docs/THREAT_MODEL.md.
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
/// Settles a move, including scheduling the deposit refund and its own callback.
const GAS_FOR_ON_MOVED: Gas = Gas::from_tgas(15);
/// After the recipient check: schedules the move and its settlement.
const GAS_FOR_ON_CHECKED: Gas = Gas::from_tgas(45);
const GAS_FOR_ON_PAYOUT: Gas = Gas::from_tgas(5);
/// `release` and `cancel` refuse less, so a handover can't run out of gas halfway (S8).
const GAS_FOR_RELEASE: Gas = Gas::from_tgas(80);
const GAS_FOR_CANCEL: Gas = Gas::from_tgas(50);
const GAS_FOR_VAULT_VIEW: Gas = Gas::from_tgas(10);
const GAS_FOR_ON_UNSCHEDULED_READ: Gas = Gas::from_tgas(30);
const GAS_FOR_RETURN_UNSCHEDULED: Gas = Gas::from_tgas(50);
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const SECOND: u64 = 1_000_000_000;
/// A date less than a minute away is more likely a mistake than a plan.
pub const MIN_LEAD_NS: u64 = 60 * SECOND;
/// About 100 years.
pub const MAX_LEAD_NS: u64 = 100 * 366 * 24 * 3600 * SECOND;
const MAX_VAULT_VIEW: usize = 16 * 1024;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Schedules,
    Deposits,
    Claimable,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ScheduleState {
    /// Held until the date.
    Waiting,
    /// On its way to the recipient: checking their account, then moving the vault.
    Releasing,
    /// The giver cancelled; on its way back to them.
    Cancelling,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Schedule {
    pub token_id: TokenId,
    pub giver: AccountId,
    pub recipient: AccountId,
    /// Nanoseconds since the Unix epoch. `release` works on or after it.
    pub release_at_ns: U64,
    /// Whether the giver may take the vault back before the date.
    pub cancellable: bool,
    pub scheduled_at_ns: U64,
    /// Taken from the giver's balance here; paid back with the release or the cancellation.
    pub deposit: NearToken,
    pub state: ScheduleState,
}

#[near(serializers = [json])]
pub struct ScheduleConfig {
    pub nft_contract: AccountId,
    pub schedule_deposit: NearToken,
    pub min_lead_ns: U64,
}

#[near(serializers = [json])]
struct ScheduleMsg {
    recipient: AccountId,
    release_at_ns: U64,
    cancellable: bool,
}

/// The parts of Bearer's `vault` view that `return_unscheduled` reads.
#[near(serializers = [json])]
struct VaultSummary {
    owner_id: AccountId,
    custody: Vec<CustodyEntry>,
}

#[near(serializers = [json])]
struct CustodyEntry {
    account_id: AccountId,
}

/// What a finished vault move means for its schedule, and who gets paid.
#[derive(Debug, PartialEq)]
pub enum Settlement {
    /// The vault reached the recipient: the schedule ends and the giver gets the deposit back.
    Released { recipient: AccountId, giver: AccountId, refund: NearToken },
    /// The vault is back with the giver: the schedule ends and they get the deposit back.
    Cancelled { giver: AccountId, refund: NearToken },
    /// The vault didn't move: the schedule waits again.
    StillWaiting,
    /// Nothing was in flight.
    Nothing,
}

/// Pure, so every branch is unit-tested without a chain.
pub fn settle(s: &Schedule, moved: bool) -> Settlement {
    match (&s.state, moved) {
        (ScheduleState::Releasing, true) => Settlement::Released {
            recipient: s.recipient.clone(),
            giver: s.giver.clone(),
            refund: s.deposit,
        },
        (ScheduleState::Cancelling, true) => Settlement::Cancelled {
            giver: s.giver.clone(),
            refund: s.deposit,
        },
        (ScheduleState::Releasing | ScheduleState::Cancelling, false) => Settlement::StillWaiting,
        (ScheduleState::Waiting, _) => Settlement::Nothing,
    }
}

/// NEP-297 event under the schedule's own standard.
fn emit(event: &str, data: Value) {
    let payload = json!({
        "standard": "bearer_schedule",
        "version": "1.0.0",
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{payload}"));
}

// The schedule implements the receiving side of NEP-171 and emits NEP-297 events.
#[near(
    contract_state,
    contract_metadata(standard(standard = "nep297", version = "1.0.0"))
)]
#[derive(PanicOnDefault)]
pub struct Scheduler {
    nft_contract: AccountId,
    schedule_deposit: NearToken,
    schedules: UnorderedMap<TokenId, Schedule>,
    /// Schedule balances not held by a schedule, per giver (S7).
    deposits: LookupMap<AccountId, NearToken>,
    /// Refunds that bounced, per account.
    claimable: LookupMap<AccountId, NearToken>,
}

#[near]
impl Scheduler {
    /// No owner, admin or upgrade methods exist (S10). Both settings are fixed here.
    #[init]
    pub fn new(nft_contract: AccountId, schedule_deposit: NearToken) -> Self {
        require!(!schedule_deposit.is_zero(), "ERR_CONFIG");
        Self {
            nft_contract,
            schedule_deposit,
            schedules: UnorderedMap::new(StorageKey::Schedules),
            deposits: LookupMap::new(StorageKey::Deposits),
            claimable: LookupMap::new(StorageKey::Claimable),
        }
    }

    /// Pays for schedules ahead of time: each holds `schedule_deposit` from this balance and
    /// returns it when the vault is released or the schedule cancelled (S7). Scheduling can't
    /// carry the deposit itself: `nft_transfer_call` forwards exactly 1 yoctoNEAR.
    #[payable]
    pub fn deposit_for_schedule(&mut self) -> NearToken {
        require!(
            env::attached_deposit() >= self.schedule_deposit,
            "ERR_DEPOSIT"
        );
        let account = env::predecessor_account_id();
        let balance = self
            .deposit_of(account.clone())
            .saturating_add(env::attached_deposit());
        self.deposits.insert(&account, &balance);
        balance
    }

    /// Returns the caller's schedule balance that no schedule holds.
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

    /// Hands the vault to its recipient. Anyone may call it on or after the date (S2, S3): the
    /// recipient was fixed at scheduling. Checks their account exists first (S5).
    /// Fails: `ERR_NOT_SCHEDULED`, `ERR_IN_PROGRESS`, `ERR_TOO_EARLY`, `ERR_GAS`.
    pub fn release(&mut self, token_id: TokenId) -> Promise {
        let mut s = self.schedule_or_panic(&token_id);
        require!(s.state == ScheduleState::Waiting, "ERR_IN_PROGRESS");
        require!(
            env::block_timestamp() >= s.release_at_ns.0,
            "ERR_TOO_EARLY"
        );
        require!(env::prepaid_gas() >= GAS_FOR_RELEASE, "ERR_GAS");
        s.state = ScheduleState::Releasing;
        self.schedules.insert(&token_id, &s);
        // A transfer to a named account that doesn't exist fails; one yoctoNEAR is the probe.
        Promise::new(s.recipient.clone()).transfer(ONE_YOCTO).then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_FOR_ON_CHECKED)
                .on_recipient_checked(token_id),
        )
    }

    /// The giver takes the vault back before the date, if they scheduled it as cancellable (S4).
    /// Attach 1 yoctoNEAR.
    /// Fails: `ERR_NOT_SCHEDULED`, `ERR_IN_PROGRESS`, `ERR_NOT_GIVER`, `ERR_NOT_CANCELLABLE`,
    /// `ERR_TOO_LATE`, `ERR_GAS`.
    #[payable]
    pub fn cancel(&mut self, token_id: TokenId) -> Promise {
        assert_one_yocto();
        let mut s = self.schedule_or_panic(&token_id);
        require!(s.state == ScheduleState::Waiting, "ERR_IN_PROGRESS");
        require!(env::predecessor_account_id() == s.giver, "ERR_NOT_GIVER");
        require!(s.cancellable, "ERR_NOT_CANCELLABLE");
        require!(
            env::block_timestamp() < s.release_at_ns.0,
            "ERR_TOO_LATE"
        );
        require!(env::prepaid_gas() >= GAS_FOR_CANCEL, "ERR_GAS");
        s.state = ScheduleState::Cancelling;
        self.schedules.insert(&token_id, &s);
        let giver = s.giver.clone();
        self.move_vault(token_id, giver)
    }

    /// Sends a refund that bounced earlier to the caller. Attach 1 yoctoNEAR.
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

    /// Sends back a vault that arrived by plain `nft_transfer` and so was never scheduled (S9). It
    /// goes to whoever held it before this contract, read from the vault's custody log. Anyone may
    /// call this; it does nothing for a scheduled vault or one this contract doesn't hold.
    pub fn return_unscheduled(&mut self, token_id: TokenId) -> Promise {
        require!(self.schedules.get(&token_id).is_none(), "ERR_SCHEDULED");
        require!(env::prepaid_gas() >= GAS_FOR_RETURN_UNSCHEDULED, "ERR_GAS");
        Promise::new(self.nft_contract.clone())
            .function_call(
                "vault".to_string(),
                serde_json::to_vec(&json!({ "token_id": token_id })).unwrap_or_default(),
                NearToken::from_yoctonear(0),
                GAS_FOR_VAULT_VIEW,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_ON_UNSCHEDULED_READ)
                    .on_unscheduled_read(token_id),
            )
    }

    /// Never panics (S8): a missing recipient puts the schedule back to waiting.
    #[private]
    pub fn on_recipient_checked(&mut self, token_id: TokenId) {
        let Some(mut s) = self.schedules.get(&token_id) else {
            return;
        };
        if s.state != ScheduleState::Releasing {
            return;
        }
        if env::promise_result_checked(0, 64).is_err() {
            s.state = ScheduleState::Waiting;
            self.schedules.insert(&token_id, &s);
            emit(
                "recipient_missing",
                json!({ "token_id": token_id, "recipient": s.recipient }),
            );
            return;
        }
        let recipient = s.recipient.clone();
        self.move_vault(token_id, recipient).detach();
    }

    /// Never panics (S8): whatever happened to the vault, the schedule ends in a known state.
    #[private]
    pub fn on_vault_moved(&mut self, token_id: TokenId) {
        let Some(s) = self.schedules.get(&token_id) else {
            return;
        };
        let moved = env::promise_result_checked(0, 64).is_ok();
        match settle(&s, moved) {
            Settlement::Released {
                recipient,
                giver,
                refund,
            } => {
                self.schedules.remove(&token_id);
                emit(
                    "released",
                    json!({ "token_id": token_id, "giver": giver, "recipient": recipient }),
                );
                self.pay(giver, refund).detach();
            }
            Settlement::Cancelled { giver, refund } => {
                self.schedules.remove(&token_id);
                emit("cancelled", json!({ "token_id": token_id, "giver": giver }));
                self.pay(giver, refund).detach();
            }
            Settlement::StillWaiting => {
                let event = if s.state == ScheduleState::Releasing {
                    "release_failed"
                } else {
                    "cancel_failed"
                };
                self.schedules.insert(
                    &token_id,
                    &Schedule {
                        state: ScheduleState::Waiting,
                        ..s
                    },
                );
                emit(event, json!({ "token_id": token_id }));
            }
            Settlement::Nothing => {}
        }
    }

    /// A refund that bounced (the account no longer exists) is kept for `claim`.
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

    /// Second half of `return_unscheduled`. Never panics.
    #[private]
    pub fn on_unscheduled_read(&mut self, token_id: TokenId) {
        if self.schedules.get(&token_id).is_some() {
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
                serde_json::to_vec(&json!({ "receiver_id": to, "token_id": token_id, "memo": "bearer schedule: never scheduled" }))
                    .unwrap_or_default(),
                ONE_YOCTO,
                GAS_FOR_NFT_TRANSFER,
            )
            .detach();
    }

    /* ---------- views ---------- */

    pub fn schedules(&self, from_index: Option<u64>, limit: Option<u64>) -> Vec<Schedule> {
        self.schedules
            .values()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50).min(100) as usize)
            .collect()
    }

    pub fn schedule(&self, token_id: TokenId) -> Option<Schedule> {
        self.schedules.get(&token_id)
    }

    pub fn schedule_count(&self) -> u64 {
        self.schedules.len()
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

    pub fn get_config(&self) -> ScheduleConfig {
        ScheduleConfig {
            nft_contract: self.nft_contract.clone(),
            schedule_deposit: self.schedule_deposit,
            min_lead_ns: U64(MIN_LEAD_NS),
        }
    }
}

#[near]
impl NonFungibleTokenReceiver for Scheduler {
    /// Schedules a vault the Bearer contract just moved here. `msg` is
    /// `{"recipient":"…","release_at_ns":"…","cancellable":true|false}`. Any panic sends the vault
    /// straight back to the giver (NEP-171 resolve).
    /// Fails: `ERR_WRONG_NFT_CONTRACT` (S1), `ERR_NO_APPROVALS`, `ERR_BAD_MSG`, `ERR_RECIPIENT`,
    /// `ERR_DATE_TOO_SOON`, `ERR_DATE_TOO_FAR`, `ERR_ALREADY_SCHEDULED`, `ERR_NO_SCHEDULE_DEPOSIT`,
    /// `ERR_SCHEDULE_DEPOSIT_BELOW_STORAGE`.
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
        let ScheduleMsg {
            recipient,
            release_at_ns,
            cancellable,
        } = serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("ERR_BAD_MSG"));
        let giver = previous_owner_id;
        require!(
            recipient != giver
                && recipient != env::current_account_id()
                && recipient != self.nft_contract,
            "ERR_RECIPIENT"
        );
        let now = env::block_timestamp();
        require!(
            release_at_ns.0 >= now.saturating_add(MIN_LEAD_NS),
            "ERR_DATE_TOO_SOON"
        );
        require!(
            release_at_ns.0 <= now.saturating_add(MAX_LEAD_NS),
            "ERR_DATE_TOO_FAR"
        );
        require!(
            self.schedules.get(&token_id).is_none(),
            "ERR_ALREADY_SCHEDULED"
        );

        let balance = self.deposit_of(giver.clone());
        require!(
            balance >= self.schedule_deposit,
            "ERR_NO_SCHEDULE_DEPOSIT"
        );
        let rest = balance.saturating_sub(self.schedule_deposit);
        if rest.is_zero() {
            self.deposits.remove(&giver);
        } else {
            self.deposits.insert(&giver, &rest);
        }

        let before = env::storage_usage();
        self.schedules.insert(
            &token_id,
            &Schedule {
                token_id: token_id.clone(),
                giver: giver.clone(),
                recipient: recipient.clone(),
                release_at_ns,
                cancellable,
                scheduled_at_ns: U64(now),
                deposit: self.schedule_deposit,
                state: ScheduleState::Waiting,
            },
        );
        let used = env::storage_usage().saturating_sub(before);
        require!(
            env::storage_byte_cost().saturating_mul(u128::from(used)) <= self.schedule_deposit,
            "ERR_SCHEDULE_DEPOSIT_BELOW_STORAGE"
        );

        emit(
            "scheduled",
            json!({ "token_id": token_id, "giver": giver, "recipient": recipient, "release_at_ns": release_at_ns, "cancellable": cancellable }),
        );
        PromiseOrValue::Value(false)
    }
}

impl Scheduler {
    fn schedule_or_panic(&self, token_id: &TokenId) -> Schedule {
        self.schedules
            .get(token_id)
            .unwrap_or_else(|| env::panic_str("ERR_NOT_SCHEDULED"))
    }

    /// Bearer's own transfer gate checks, in the same receipt that moves the vault, that it is
    /// still sealed and still held here (S6). Settlement waits for its answer.
    fn move_vault(&self, token_id: TokenId, receiver_id: AccountId) -> Promise {
        let args = json!({ "receiver_id": receiver_id, "token_id": token_id, "memo": "bearer schedule" });
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

    const DEPOSIT: NearToken = NearToken::from_millinear(10);
    const NOW: u64 = 1_800_000_000 * SECOND;
    const DAY: u64 = 24 * 3600 * SECOND;

    fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }

    fn ctx(predecessor: &str, deposit: u128, now: u64) -> VMContextBuilder {
        let mut c = VMContextBuilder::new();
        c.current_account_id(acc("schedule.test"))
            .predecessor_account_id(acc(predecessor))
            .signer_account_id(acc(predecessor))
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .prepaid_gas(Gas::from_tgas(100))
            .block_timestamp(now)
            .account_balance(NearToken::from_near(10));
        c
    }

    fn scheduler() -> Scheduler {
        testing_env!(ctx("deployer.test", 0, NOW).build());
        Scheduler::new(acc("bearer.test"), DEPOSIT)
    }

    fn msg(recipient: &str, at: u64, cancellable: bool) -> String {
        format!("{{\"recipient\":\"{recipient}\",\"release_at_ns\":\"{at}\",\"cancellable\":{cancellable}}}")
    }

    /// alice schedules vault 1 for bob, a day from NOW.
    fn scheduled(cancellable: bool) -> Scheduler {
        let mut s = scheduler();
        testing_env!(ctx("alice.test", DEPOSIT.as_yoctonear(), NOW).build());
        s.deposit_for_schedule();
        testing_env!(ctx("bearer.test", 0, NOW).build());
        let _ = s.nft_on_transfer(acc("alice.test"), acc("alice.test"), "1".into(), msg("bob.test", NOW + DAY, cancellable));
        s
    }

    fn sched(state: ScheduleState) -> Schedule {
        Schedule {
            token_id: "1".into(),
            giver: acc("alice.test"),
            recipient: acc("bob.test"),
            release_at_ns: U64(NOW + DAY),
            cancellable: true,
            scheduled_at_ns: U64(NOW),
            deposit: DEPOSIT,
            state,
        }
    }

    #[test]
    fn settle_every_branch() {
        assert_eq!(
            settle(&sched(ScheduleState::Releasing), true),
            Settlement::Released { recipient: acc("bob.test"), giver: acc("alice.test"), refund: DEPOSIT }
        );
        assert_eq!(
            settle(&sched(ScheduleState::Cancelling), true),
            Settlement::Cancelled { giver: acc("alice.test"), refund: DEPOSIT }
        );
        assert_eq!(settle(&sched(ScheduleState::Releasing), false), Settlement::StillWaiting);
        assert_eq!(settle(&sched(ScheduleState::Cancelling), false), Settlement::StillWaiting);
        assert_eq!(settle(&sched(ScheduleState::Waiting), true), Settlement::Nothing);
    }

    #[test]
    fn schedule_holds_the_deposit_and_covers_its_storage() {
        let s = scheduled(true);
        let x = s.schedule("1".into()).unwrap();
        assert_eq!(x.recipient, acc("bob.test"));
        assert_eq!(x.release_at_ns, U64(NOW + DAY));
        assert_eq!(x.state, ScheduleState::Waiting);
        assert!(s.deposit_of(acc("alice.test")).is_zero());
    }

    #[test]
    #[should_panic(expected = "ERR_WRONG_NFT_CONTRACT")]
    fn only_bearer_can_schedule() {
        let mut s = scheduler();
        testing_env!(ctx("fake.test", 0, NOW).build());
        let _ = s.nft_on_transfer(acc("eve.test"), acc("eve.test"), "1".into(), msg("bob.test", NOW + DAY, true));
    }

    #[test]
    #[should_panic(expected = "ERR_NO_SCHEDULE_DEPOSIT")]
    fn scheduling_needs_a_deposit() {
        let mut s = scheduler();
        testing_env!(ctx("bearer.test", 0, NOW).build());
        let _ = s.nft_on_transfer(acc("alice.test"), acc("alice.test"), "1".into(), msg("bob.test", NOW + DAY, true));
    }

    #[test]
    #[should_panic(expected = "ERR_DATE_TOO_SOON")]
    fn date_must_be_in_the_future() {
        let mut s = scheduler();
        testing_env!(ctx("bearer.test", 0, NOW).build());
        let _ = s.nft_on_transfer(acc("alice.test"), acc("alice.test"), "1".into(), msg("bob.test", NOW + 10 * SECOND, true));
    }

    #[test]
    #[should_panic(expected = "ERR_RECIPIENT")]
    fn recipient_cannot_be_the_giver() {
        let mut s = scheduler();
        testing_env!(ctx("bearer.test", 0, NOW).build());
        let _ = s.nft_on_transfer(acc("alice.test"), acc("alice.test"), "1".into(), msg("alice.test", NOW + DAY, true));
    }

    #[test]
    #[should_panic(expected = "ERR_TOO_EARLY")]
    fn release_waits_for_the_date() {
        let mut s = scheduled(true);
        testing_env!(ctx("bob.test", 0, NOW + DAY - SECOND).build());
        let _ = s.release("1".into());
    }

    #[test]
    fn anyone_can_release_on_the_date() {
        let mut s = scheduled(false);
        testing_env!(ctx("carol.test", 0, NOW + DAY).build());
        let _ = s.release("1".into());
        assert_eq!(s.schedule("1".into()).unwrap().state, ScheduleState::Releasing);
    }

    #[test]
    #[should_panic(expected = "ERR_NOT_CANCELLABLE")]
    fn irrevocable_schedule_cannot_be_cancelled() {
        let mut s = scheduled(false);
        testing_env!(ctx("alice.test", 1, NOW + 1).build());
        let _ = s.cancel("1".into());
    }

    #[test]
    #[should_panic(expected = "ERR_NOT_GIVER")]
    fn only_the_giver_can_cancel() {
        let mut s = scheduled(true);
        testing_env!(ctx("bob.test", 1, NOW + 1).build());
        let _ = s.cancel("1".into());
    }

    #[test]
    #[should_panic(expected = "ERR_TOO_LATE")]
    fn no_cancelling_after_the_date() {
        let mut s = scheduled(true);
        testing_env!(ctx("alice.test", 1, NOW + DAY).build());
        let _ = s.cancel("1".into());
    }

    #[test]
    fn missing_recipient_keeps_the_vault_waiting() {
        let mut s = scheduled(true);
        testing_env!(ctx("carol.test", 0, NOW + DAY).build());
        let _ = s.release("1".into());
        testing_env_with_promise_results(ctx("schedule.test", 0, NOW + DAY).build(), PromiseResult::Failed);
        s.on_recipient_checked("1".into());
        assert_eq!(s.schedule("1".into()).unwrap().state, ScheduleState::Waiting);
    }

    #[test]
    fn released_vault_ends_the_schedule() {
        let mut s = scheduled(true);
        testing_env!(ctx("carol.test", 0, NOW + DAY).build());
        let _ = s.release("1".into());
        testing_env_with_promise_results(ctx("schedule.test", 0, NOW + DAY).build(), PromiseResult::Successful(vec![]));
        s.on_vault_moved("1".into());
        assert!(s.schedule("1".into()).is_none());
    }

    #[test]
    fn failed_move_keeps_the_schedule() {
        let mut s = scheduled(true);
        testing_env!(ctx("carol.test", 0, NOW + DAY).build());
        let _ = s.release("1".into());
        testing_env_with_promise_results(ctx("schedule.test", 0, NOW + DAY).build(), PromiseResult::Failed);
        s.on_vault_moved("1".into());
        assert_eq!(s.schedule("1".into()).unwrap().state, ScheduleState::Waiting);
    }
}
