//! Bearer switch: a sealed vault that goes to someone else if its owner goes quiet.
//!
//! Escrow by transfer, like the market, the schedule and the lending contract. The owner sends a
//! sealed vault here with `nft_transfer_call`, naming a beneficiary and a check-in interval. While
//! they keep checking in, nothing happens; they can also change the beneficiary or the interval,
//! or take the vault back, at any time. Once a whole interval passes without a check-in, anyone
//! may `release` it, and it goes to the beneficiary, and only to them.
//!
//! Nothing here calls `break_seal`, so a vault stays sealed while it's held: nobody can take its
//! coins out meanwhile, the owner included, and coins can still be added to its addresses.
//! Settlement moves the vault first; callbacks never panic. Threats D1–D11 in docs/THREAT_MODEL.md.
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
/// Settles a move, including the deposit payout and its callback.
const GAS_FOR_ON_MOVED: Gas = Gas::from_tgas(20);
/// Moves the vault after the beneficiary's account is confirmed, and settles it.
const GAS_FOR_ON_CHECKED: Gas = Gas::from_tgas(50);
const GAS_FOR_ON_PAYOUT: Gas = Gas::from_tgas(5);
/// `release` refuses less, so the hand-over can't stop halfway (D5).
const GAS_FOR_RELEASE: Gas = Gas::from_tgas(80);
/// `take_back` refuses less (D5).
const GAS_FOR_TAKE_BACK: Gas = Gas::from_tgas(50);
const GAS_FOR_VAULT_VIEW: Gas = Gas::from_tgas(10);
const GAS_FOR_ON_UNARMED_READ: Gas = Gas::from_tgas(30);
const GAS_FOR_RETURN_UNARMED: Gas = Gas::from_tgas(50);
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const SECOND: u64 = 1_000_000_000;
/// Short enough to try the whole thing in one sitting; anything shorter is a mistake.
pub const MIN_INTERVAL_NS: u64 = 60 * SECOND;
/// About ten years.
pub const MAX_INTERVAL_NS: u64 = 10 * 366 * 24 * 3600 * SECOND;
/// `update` may name a longer beneficiary than the one armed with: up to a 64-byte account name.
/// The deposit has to cover that too, checked when the switch is armed (D6).
const MAX_ACCOUNT_LEN: u64 = 64;
/// A vault view is about 1.5 KB; this bounds what the custody read will accept.
const MAX_VAULT_VIEW: usize = 16 * 1024;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Switches,
    Deposits,
    Claimable,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SwitchState {
    /// Held, waiting. The owner checks in to push the hand-over back.
    Armed,
    /// The owner is taking it back; the vault is on its way to them.
    TakingBack,
    /// Nobody checked in in time: checking the beneficiary's account, then moving the vault.
    Releasing,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Switch {
    pub token_id: TokenId,
    pub owner: AccountId,
    pub beneficiary: AccountId,
    /// How long a silence hands the vault over.
    pub interval_ns: U64,
    /// The owner's last sign of life: arming, a check-in or an update.
    pub last_check_in_ns: U64,
    pub armed_at_ns: U64,
    /// Taken from the owner's balance here; paid back to them when the switch ends, either way.
    pub deposit: NearToken,
    pub state: SwitchState,
}

impl Switch {
    /// From this moment anyone may release the vault to the beneficiary.
    pub fn due_at_ns(&self) -> u64 {
        self.last_check_in_ns.0.saturating_add(self.interval_ns.0)
    }
}

#[near(serializers = [json])]
pub struct SwitchConfig {
    pub nft_contract: AccountId,
    pub switch_deposit: NearToken,
    pub min_interval_ns: U64,
    pub max_interval_ns: U64,
}

#[near(serializers = [json])]
struct ArmMsg {
    beneficiary: AccountId,
    interval_ns: U64,
}

/// The parts of Bearer's `vault` view that `return_unarmed` reads.
#[near(serializers = [json])]
struct VaultSummary {
    owner_id: AccountId,
    custody: Vec<CustodyEntry>,
}

#[near(serializers = [json])]
struct CustodyEntry {
    account_id: AccountId,
}

/// What a finished vault move means for its switch, and who gets the deposit.
#[derive(Debug, PartialEq)]
pub enum Settlement {
    /// The vault reached the beneficiary: the switch ends, the owner gets the deposit back.
    Released {
        owner: AccountId,
        beneficiary: AccountId,
        deposit: NearToken,
    },
    /// The vault is back with the owner: the switch ends, deposit back.
    TakenBack { owner: AccountId, deposit: NearToken },
    /// The vault didn't move: the switch is armed again, as it was.
    StillHeld,
    /// Nothing was in flight.
    Nothing,
}

/// Pure, so every branch is unit-tested without a chain.
pub fn settle(s: &Switch, moved: bool) -> Settlement {
    match (&s.state, moved) {
        (SwitchState::Releasing, true) => Settlement::Released {
            owner: s.owner.clone(),
            beneficiary: s.beneficiary.clone(),
            deposit: s.deposit,
        },
        (SwitchState::TakingBack, true) => Settlement::TakenBack {
            owner: s.owner.clone(),
            deposit: s.deposit,
        },
        (SwitchState::Releasing | SwitchState::TakingBack, false) => Settlement::StillHeld,
        (SwitchState::Armed, _) => Settlement::Nothing,
    }
}

/// NEP-297 event under the switch's own standard.
fn emit(event: &str, data: Value) {
    let payload = json!({
        "standard": "bearer_switch",
        "version": "1.0.0",
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{payload}"));
}

// The switch implements the receiving side of NEP-171 and emits NEP-297 events.
#[near(
    contract_state,
    contract_metadata(standard(standard = "nep297", version = "1.0.0"))
)]
#[derive(PanicOnDefault)]
pub struct Switches {
    nft_contract: AccountId,
    switch_deposit: NearToken,
    switches: UnorderedMap<TokenId, Switch>,
    /// Balances not held by a switch, per owner (D6).
    deposits: LookupMap<AccountId, NearToken>,
    /// Payouts that bounced, per account.
    claimable: LookupMap<AccountId, NearToken>,
}

#[near]
impl Switches {
    /// No owner, admin or upgrade methods exist (D9). Both settings are fixed here.
    #[init]
    pub fn new(nft_contract: AccountId, switch_deposit: NearToken) -> Self {
        require!(!switch_deposit.is_zero(), "ERR_CONFIG");
        Self {
            nft_contract,
            switch_deposit,
            switches: UnorderedMap::new(StorageKey::Switches),
            deposits: LookupMap::new(StorageKey::Deposits),
            claimable: LookupMap::new(StorageKey::Claimable),
        }
    }

    /// Pays for switches ahead of time. Each one holds `switch_deposit` from this balance and
    /// returns it when it ends (D6). Arming can't carry the deposit itself: `nft_transfer_call`
    /// forwards exactly 1 yoctoNEAR.
    #[payable]
    pub fn deposit_for_switch(&mut self) -> NearToken {
        require!(env::attached_deposit() >= self.switch_deposit, "ERR_DEPOSIT");
        let account = env::predecessor_account_id();
        let balance = self
            .deposit_of(account.clone())
            .saturating_add(env::attached_deposit());
        self.deposits.insert(&account, &balance);
        balance
    }

    /// Returns the caller's balance that no switch holds.
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

    /// "I'm still here": the owner restarts the clock. Allowed until the vault is actually handed
    /// over, even after the interval ran out (D10). Attach 1 yoctoNEAR.
    /// Fails: `ERR_NO_SWITCH`, `ERR_IN_PROGRESS`, `ERR_NOT_OWNER`.
    #[payable]
    pub fn check_in(&mut self, token_id: TokenId) -> U64 {
        assert_one_yocto();
        let mut s = self.owned_armed_or_panic(&token_id);
        s.last_check_in_ns = U64(env::block_timestamp());
        self.switches.insert(&token_id, &s);
        let due = U64(s.due_at_ns());
        emit(
            "checked_in",
            json!({ "token_id": token_id, "owner": s.owner, "due_at_ns": due }),
        );
        due
    }

    /// The owner names a new beneficiary or interval (or both). It counts as a check-in.
    /// Attach 1 yoctoNEAR.
    /// Fails: `ERR_NO_SWITCH`, `ERR_IN_PROGRESS`, `ERR_NOT_OWNER`, `ERR_BENEFICIARY`, `ERR_INTERVAL`.
    #[payable]
    pub fn update(
        &mut self,
        token_id: TokenId,
        beneficiary: Option<AccountId>,
        interval_ns: Option<U64>,
    ) -> U64 {
        assert_one_yocto();
        let mut s = self.owned_armed_or_panic(&token_id);
        if let Some(b) = beneficiary {
            self.check_beneficiary(&s.owner, &b);
            s.beneficiary = b;
        }
        if let Some(i) = interval_ns {
            check_interval(i);
            s.interval_ns = i;
        }
        s.last_check_in_ns = U64(env::block_timestamp());
        self.switches.insert(&token_id, &s);
        let due = U64(s.due_at_ns());
        emit(
            "updated",
            json!({ "token_id": token_id, "owner": s.owner, "beneficiary": s.beneficiary, "interval_ns": s.interval_ns, "due_at_ns": due }),
        );
        due
    }

    /// The owner takes the vault back, with its deposit, at any time before it's handed over.
    /// Attach 1 yoctoNEAR.
    /// Fails: `ERR_NO_SWITCH`, `ERR_IN_PROGRESS`, `ERR_NOT_OWNER`, `ERR_GAS`.
    #[payable]
    pub fn take_back(&mut self, token_id: TokenId) -> Promise {
        assert_one_yocto();
        let mut s = self.owned_armed_or_panic(&token_id);
        require!(env::prepaid_gas() >= GAS_FOR_TAKE_BACK, "ERR_GAS");
        s.state = SwitchState::TakingBack;
        self.switches.insert(&token_id, &s);
        let owner = s.owner.clone();
        self.move_vault(token_id, owner, "bearer switch: taken back")
    }

    /// Hands the vault to the beneficiary once a whole interval has passed without a check-in.
    /// Anyone may call it (D3, D4): the beneficiary was fixed by the owner. Checks their account
    /// exists first (D7).
    /// Fails: `ERR_NO_SWITCH`, `ERR_IN_PROGRESS`, `ERR_NOT_SILENT`, `ERR_GAS`.
    pub fn release(&mut self, token_id: TokenId) -> Promise {
        let mut s = self.switch_or_panic(&token_id);
        require!(s.state == SwitchState::Armed, "ERR_IN_PROGRESS");
        require!(env::block_timestamp() >= s.due_at_ns(), "ERR_NOT_SILENT");
        require!(env::prepaid_gas() >= GAS_FOR_RELEASE, "ERR_GAS");
        s.state = SwitchState::Releasing;
        self.switches.insert(&token_id, &s);
        // A transfer to a named account that doesn't exist fails; one yoctoNEAR is the probe.
        Promise::new(s.beneficiary.clone()).transfer(ONE_YOCTO).then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_FOR_ON_CHECKED)
                .on_beneficiary_checked(token_id),
        )
    }

    /// Sends money that bounced earlier to the caller. Attach 1 yoctoNEAR.
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

    /// Sends back a vault that arrived by plain `nft_transfer` and so was never armed (D8). It goes
    /// to whoever held it before this contract, read from the vault's custody log. Anyone may call
    /// this; it does nothing for an armed vault or one this contract doesn't hold.
    pub fn return_unarmed(&mut self, token_id: TokenId) -> Promise {
        require!(self.switches.get(&token_id).is_none(), "ERR_ARMED");
        require!(env::prepaid_gas() >= GAS_FOR_RETURN_UNARMED, "ERR_GAS");
        Promise::new(self.nft_contract.clone())
            .function_call(
                "vault".to_string(),
                serde_json::to_vec(&json!({ "token_id": token_id })).unwrap_or_default(),
                NearToken::from_yoctonear(0),
                GAS_FOR_VAULT_VIEW,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_ON_UNARMED_READ)
                    .on_unarmed_read(token_id),
            )
    }

    /// Second half of `release`. Never panics: a missing account puts the switch back as it was.
    #[private]
    pub fn on_beneficiary_checked(&mut self, token_id: TokenId) {
        let Some(mut s) = self.switches.get(&token_id) else {
            return;
        };
        if s.state != SwitchState::Releasing {
            return;
        }
        if env::promise_result_checked(0, 64).is_err() {
            s.state = SwitchState::Armed;
            self.switches.insert(&token_id, &s);
            emit(
                "beneficiary_missing",
                json!({ "token_id": token_id, "beneficiary": s.beneficiary }),
            );
            return;
        }
        let beneficiary = s.beneficiary.clone();
        self.move_vault(token_id, beneficiary, "bearer switch: released")
            .detach();
    }

    /// Never panics (D5): whatever happened to the vault, the switch ends in a known state.
    #[private]
    pub fn on_vault_moved(&mut self, token_id: TokenId) {
        let Some(s) = self.switches.get(&token_id) else {
            return;
        };
        let moved = env::promise_result_checked(0, 64).is_ok();
        match settle(&s, moved) {
            Settlement::Released {
                owner,
                beneficiary,
                deposit,
            } => {
                self.switches.remove(&token_id);
                emit(
                    "released",
                    json!({ "token_id": token_id, "owner": owner, "beneficiary": beneficiary }),
                );
                self.pay(owner, deposit).detach();
            }
            Settlement::TakenBack { owner, deposit } => {
                self.switches.remove(&token_id);
                emit(
                    "taken_back",
                    json!({ "token_id": token_id, "owner": owner }),
                );
                self.pay(owner, deposit).detach();
            }
            Settlement::StillHeld => {
                self.switches.insert(
                    &token_id,
                    &Switch {
                        state: SwitchState::Armed,
                        ..s
                    },
                );
                emit("move_failed", json!({ "token_id": token_id }));
            }
            Settlement::Nothing => {}
        }
    }

    /// A payout that bounced (the account no longer exists) is kept for `claim`.
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

    /// Second half of `return_unarmed`. Never panics.
    #[private]
    pub fn on_unarmed_read(&mut self, token_id: TokenId) {
        if self.switches.get(&token_id).is_some() {
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
                serde_json::to_vec(&json!({ "receiver_id": to, "token_id": token_id, "memo": "bearer switch: never armed" }))
                    .unwrap_or_default(),
                ONE_YOCTO,
                GAS_FOR_NFT_TRANSFER,
            )
            .detach();
    }

    /* ---------- views ---------- */

    pub fn switches(&self, from_index: Option<u64>, limit: Option<u64>) -> Vec<Switch> {
        self.switches
            .values()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50).min(100) as usize)
            .collect()
    }

    pub fn switch_for(&self, token_id: TokenId) -> Option<Switch> {
        self.switches.get(&token_id)
    }

    pub fn switch_count(&self) -> u64 {
        self.switches.len()
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

    pub fn get_config(&self) -> SwitchConfig {
        SwitchConfig {
            nft_contract: self.nft_contract.clone(),
            switch_deposit: self.switch_deposit,
            min_interval_ns: U64(MIN_INTERVAL_NS),
            max_interval_ns: U64(MAX_INTERVAL_NS),
        }
    }
}

#[near]
impl NonFungibleTokenReceiver for Switches {
    /// Arms a switch for a vault the Bearer contract just moved here. `msg` is
    /// `{"beneficiary":"<account>","interval_ns":"<ns>"}`. Any panic sends the vault straight
    /// back to the owner (NEP-171 resolve).
    /// Fails: `ERR_WRONG_NFT_CONTRACT` (D1), `ERR_NO_APPROVALS`, `ERR_BAD_MSG`, `ERR_BENEFICIARY`,
    /// `ERR_INTERVAL`, `ERR_ALREADY_ARMED`, `ERR_NO_SWITCH_DEPOSIT`, `ERR_SWITCH_DEPOSIT_BELOW_STORAGE`.
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
        let ArmMsg {
            beneficiary,
            interval_ns,
        } = serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("ERR_BAD_MSG"));
        let owner = previous_owner_id;
        self.check_beneficiary(&owner, &beneficiary);
        check_interval(interval_ns);
        require!(
            self.switches.get(&token_id).is_none(),
            "ERR_ALREADY_ARMED"
        );

        let balance = self.deposit_of(owner.clone());
        require!(balance >= self.switch_deposit, "ERR_NO_SWITCH_DEPOSIT");
        let rest = balance.saturating_sub(self.switch_deposit);
        if rest.is_zero() {
            self.deposits.remove(&owner);
        } else {
            self.deposits.insert(&owner, &rest);
        }

        let now = U64(env::block_timestamp());
        let before = env::storage_usage();
        let headroom = MAX_ACCOUNT_LEN.saturating_sub(beneficiary.len() as u64);
        self.switches.insert(
            &token_id,
            &Switch {
                token_id: token_id.clone(),
                owner: owner.clone(),
                beneficiary: beneficiary.clone(),
                interval_ns,
                last_check_in_ns: now,
                armed_at_ns: now,
                deposit: self.switch_deposit,
                state: SwitchState::Armed,
            },
        );
        let used = env::storage_usage()
            .saturating_sub(before)
            .saturating_add(headroom);
        require!(
            env::storage_byte_cost().saturating_mul(used as u128) <= self.switch_deposit,
            "ERR_SWITCH_DEPOSIT_BELOW_STORAGE"
        );

        emit(
            "armed",
            json!({ "token_id": token_id, "owner": owner, "beneficiary": beneficiary, "interval_ns": interval_ns, "due_at_ns": U64(now.0.saturating_add(interval_ns.0)) }),
        );
        PromiseOrValue::Value(false)
    }
}

fn check_interval(interval_ns: U64) {
    require!(
        interval_ns.0 >= MIN_INTERVAL_NS && interval_ns.0 <= MAX_INTERVAL_NS,
        "ERR_INTERVAL"
    );
}

impl Switches {
    fn switch_or_panic(&self, token_id: &TokenId) -> Switch {
        self.switches
            .get(token_id)
            .unwrap_or_else(|| env::panic_str("ERR_NO_SWITCH"))
    }

    /// The switch, if it's armed and the caller owns it (D3).
    fn owned_armed_or_panic(&self, token_id: &TokenId) -> Switch {
        let s = self.switch_or_panic(token_id);
        require!(s.state == SwitchState::Armed, "ERR_IN_PROGRESS");
        require!(env::predecessor_account_id() == s.owner, "ERR_NOT_OWNER");
        s
    }

    /// Someone else, and not an account that would hold the vault forever (D7).
    fn check_beneficiary(&self, owner: &AccountId, beneficiary: &AccountId) {
        require!(
            beneficiary != owner
                && *beneficiary != env::current_account_id()
                && *beneficiary != self.nft_contract,
            "ERR_BENEFICIARY"
        );
    }

    /// Bearer's own transfer gate checks, in the same receipt that moves the vault, that it is
    /// still sealed and still held here (D2). Settlement waits for its answer.
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
    const DEPOSIT: NearToken = NearToken::from_millinear(10);
    const NOW: u64 = 1_800_000_000 * SECOND;
    const DAY: u64 = 24 * 3600 * SECOND;
    const YEAR: u64 = 365 * DAY;

    fn ctx_at(predecessor: &str, deposit: u128, now: u64) -> VMContextBuilder {
        let mut c = VMContextBuilder::new();
        c.current_account_id(acc("switch.test"))
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

    fn switches() -> Switches {
        testing_env!(ctx("deployer.test", 0).build());
        Switches::new(acc("bearer.test"), DEPOSIT)
    }

    fn arm_msg(beneficiary: &str, interval_ns: u64) -> String {
        format!("{{\"beneficiary\":\"{beneficiary}\",\"interval_ns\":\"{interval_ns}\"}}")
    }

    /// alice arms vault 1 at NOW for mira, with a year between check-ins.
    fn armed(w: &mut Switches) {
        testing_env!(ctx("alice.test", DEPOSIT.as_yoctonear()).build());
        w.deposit_for_switch();
        testing_env!(ctx("bearer.test", 0).build());
        let _ = w.nft_on_transfer(acc("alice.test"), acc("alice.test"), "1".into(), arm_msg("mira.test", YEAR));
    }

    fn switch(state: SwitchState) -> Switch {
        Switch {
            token_id: "7".into(),
            owner: acc("alice.test"),
            beneficiary: acc("mira.test"),
            interval_ns: U64(YEAR),
            last_check_in_ns: U64(NOW),
            armed_at_ns: U64(NOW),
            deposit: DEPOSIT,
            state,
        }
    }

    fn panics(f: impl FnOnce()) -> String {
        let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).expect_err("should be refused");
        err.downcast_ref::<String>()
            .cloned()
            .or_else(|| err.downcast_ref::<&str>().map(|s| s.to_string()))
            .unwrap_or_default()
    }

    #[test]
    fn settle_every_branch() {
        assert_eq!(
            settle(&switch(SwitchState::Releasing), true),
            Settlement::Released { owner: acc("alice.test"), beneficiary: acc("mira.test"), deposit: DEPOSIT }
        );
        assert_eq!(
            settle(&switch(SwitchState::TakingBack), true),
            Settlement::TakenBack { owner: acc("alice.test"), deposit: DEPOSIT }
        );
        assert_eq!(settle(&switch(SwitchState::Releasing), false), Settlement::StillHeld);
        assert_eq!(settle(&switch(SwitchState::TakingBack), false), Settlement::StillHeld);
        assert_eq!(settle(&switch(SwitchState::Armed), true), Settlement::Nothing);
    }

    #[test]
    #[should_panic(expected = "ERR_WRONG_NFT_CONTRACT")]
    fn only_bearer_can_arm() {
        let mut w = switches();
        testing_env!(ctx("fake-nft.test", 0).build());
        let _ = w.nft_on_transfer(acc("eve.test"), acc("eve.test"), "1".into(), arm_msg("mira.test", YEAR));
    }

    #[test]
    #[should_panic(expected = "ERR_NO_SWITCH_DEPOSIT")]
    fn arming_needs_a_deposit() {
        let mut w = switches();
        testing_env!(ctx("bearer.test", 0).build());
        let _ = w.nft_on_transfer(acc("alice.test"), acc("alice.test"), "1".into(), arm_msg("mira.test", YEAR));
    }

    #[test]
    fn arming_terms_are_checked() {
        let attempt = |msg: String| {
            let mut w = switches();
            testing_env!(ctx("alice.test", DEPOSIT.as_yoctonear()).build());
            w.deposit_for_switch();
            testing_env!(ctx("bearer.test", 0).build());
            panics(|| {
                let _ = w.nft_on_transfer(acc("alice.test"), acc("alice.test"), "1".into(), msg);
            })
        };
        assert!(attempt(r#"{"beneficiary":"mira.test"}"#.into()).contains("ERR_BAD_MSG"));
        assert!(attempt(arm_msg("alice.test", YEAR)).contains("ERR_BENEFICIARY"));
        assert!(attempt(arm_msg("switch.test", YEAR)).contains("ERR_BENEFICIARY"));
        assert!(attempt(arm_msg("bearer.test", YEAR)).contains("ERR_BENEFICIARY"));
        assert!(attempt(arm_msg("mira.test", MIN_INTERVAL_NS - 1)).contains("ERR_INTERVAL"));
        assert!(attempt(arm_msg("mira.test", MAX_INTERVAL_NS + 1)).contains("ERR_INTERVAL"));
    }

    #[test]
    fn arming_holds_the_deposit_and_starts_the_clock() {
        let mut w = switches();
        armed(&mut w);
        let s = w.switch_for("1".into()).unwrap();
        assert_eq!(s.owner, acc("alice.test"));
        assert_eq!(s.beneficiary, acc("mira.test"));
        assert_eq!(s.deposit, DEPOSIT);
        assert_eq!(s.state, SwitchState::Armed);
        assert_eq!(s.due_at_ns(), NOW + YEAR);
        assert!(w.deposit_of(acc("alice.test")).is_zero());
    }

    #[test]
    fn a_longer_beneficiary_fits_in_the_bytes_the_deposit_reserved() {
        let short = near_sdk::borsh::to_vec(&switch(SwitchState::Armed)).unwrap().len();
        let mut long = switch(SwitchState::TakingBack);
        long.beneficiary = acc(&"a".repeat(64));
        let long = near_sdk::borsh::to_vec(&long).unwrap().len();
        assert!((long - short) as u64 <= MAX_ACCOUNT_LEN - "mira.test".len() as u64);
    }

    #[test]
    fn check_in_pushes_the_due_date_back() {
        let mut w = switches();
        armed(&mut w);
        testing_env!(ctx_at("alice.test", 1, NOW + 200 * DAY).build());
        assert_eq!(w.check_in("1".into()).0, NOW + 200 * DAY + YEAR);
    }

    #[test]
    fn the_owner_can_still_check_in_after_the_due_date_until_it_is_released() {
        let mut w = switches();
        armed(&mut w);
        testing_env!(ctx_at("alice.test", 1, NOW + 2 * YEAR).build());
        assert_eq!(w.check_in("1".into()).0, NOW + 3 * YEAR);
    }

    #[test]
    fn only_the_owner_checks_in_updates_or_takes_back() {
        let mut w = switches();
        armed(&mut w);
        testing_env!(ctx("mira.test", 1).build());
        assert!(panics(|| {
            w.check_in("1".into());
        })
        .contains("ERR_NOT_OWNER"));
        assert!(panics(|| {
            w.update("1".into(), Some(acc("mira.test")), None);
        })
        .contains("ERR_NOT_OWNER"));
        assert!(panics(|| w.take_back("1".into()).detach()).contains("ERR_NOT_OWNER"));
    }

    #[test]
    fn update_changes_the_beneficiary_and_interval_and_counts_as_a_check_in() {
        let mut w = switches();
        armed(&mut w);
        testing_env!(ctx_at("alice.test", 1, NOW + DAY).build());
        let due = w.update("1".into(), Some(acc("kofi.test")), Some(U64(30 * DAY)));
        assert_eq!(due.0, NOW + DAY + 30 * DAY);
        let s = w.switch_for("1".into()).unwrap();
        assert_eq!(s.beneficiary, acc("kofi.test"));
        assert_eq!(s.interval_ns, U64(30 * DAY));
        testing_env!(ctx("alice.test", 1).build());
        assert!(panics(|| {
            w.update("1".into(), Some(acc("alice.test")), None);
        })
        .contains("ERR_BENEFICIARY"));
    }

    #[test]
    #[should_panic(expected = "ERR_NOT_SILENT")]
    fn nobody_can_release_before_a_whole_interval_of_silence() {
        let mut w = switches();
        armed(&mut w);
        testing_env!(ctx_at("anyone.test", 0, NOW + YEAR - 1).build());
        let _ = w.release("1".into());
    }

    #[test]
    #[should_panic(expected = "ERR_NOT_SILENT")]
    fn a_check_in_stops_a_release_that_would_have_been_due() {
        let mut w = switches();
        armed(&mut w);
        testing_env!(ctx_at("alice.test", 1, NOW + YEAR - DAY).build());
        w.check_in("1".into());
        testing_env!(ctx_at("anyone.test", 0, NOW + YEAR).build());
        let _ = w.release("1".into());
    }

    #[test]
    fn anyone_can_release_once_it_is_due_and_it_locks_the_switch() {
        let mut w = switches();
        armed(&mut w);
        testing_env!(ctx_at("anyone.test", 0, NOW + YEAR).build());
        let _ = w.release("1".into());
        assert_eq!(w.switch_for("1".into()).unwrap().state, SwitchState::Releasing);
        testing_env!(ctx_at("alice.test", 1, NOW + YEAR).build());
        assert!(panics(|| {
            w.check_in("1".into());
        })
        .contains("ERR_IN_PROGRESS"));
    }

    #[test]
    #[should_panic(expected = "ERR_GAS")]
    fn release_needs_gas_for_the_whole_hand_over() {
        let mut w = switches();
        armed(&mut w);
        let mut c = ctx_at("anyone.test", 0, NOW + YEAR);
        c.prepaid_gas(Gas::from_tgas(60));
        testing_env!(c.build());
        let _ = w.release("1".into());
    }

    #[test]
    fn a_missing_beneficiary_puts_the_switch_back() {
        let mut w = switches();
        armed(&mut w);
        testing_env!(ctx_at("anyone.test", 0, NOW + YEAR).build());
        let _ = w.release("1".into());
        testing_env_with_promise_results(ctx("switch.test", 0).build(), PromiseResult::Failed);
        w.on_beneficiary_checked("1".into());
        assert_eq!(w.switch_for("1".into()).unwrap().state, SwitchState::Armed);
    }

    #[test]
    fn a_completed_release_ends_the_switch() {
        let mut w = switches();
        armed(&mut w);
        testing_env!(ctx_at("anyone.test", 0, NOW + YEAR).build());
        let _ = w.release("1".into());
        testing_env_with_promise_results(ctx("switch.test", 0).build(), PromiseResult::Successful(vec![]));
        w.on_vault_moved("1".into());
        assert!(w.switch_for("1".into()).is_none());
    }

    #[test]
    fn a_failed_take_back_keeps_the_switch_armed() {
        let mut w = switches();
        armed(&mut w);
        testing_env!(ctx("alice.test", 1).build());
        let _ = w.take_back("1".into());
        assert_eq!(w.switch_for("1".into()).unwrap().state, SwitchState::TakingBack);
        testing_env_with_promise_results(ctx("switch.test", 0).build(), PromiseResult::Failed);
        w.on_vault_moved("1".into());
        assert_eq!(w.switch_for("1".into()).unwrap().state, SwitchState::Armed);
    }

    #[test]
    fn bounced_payout_becomes_claimable() {
        let mut w = switches();
        testing_env_with_promise_results(ctx("switch.test", 0).build(), PromiseResult::Failed);
        w.on_payout(acc("gone.test"), DEPOSIT);
        assert_eq!(w.claimable_of(acc("gone.test")), DEPOSIT);
        testing_env_with_promise_results(ctx("switch.test", 0).build(), PromiseResult::Successful(vec![]));
        w.on_payout(acc("here.test"), DEPOSIT);
        assert!(w.claimable_of(acc("here.test")).is_zero());
    }
}
