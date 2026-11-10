//! Staking a vault's NEAR with one NEAR staking pool (v2).
//!
//! The pool is fixed when the contract is created and nothing can change it (Y1), so staked NEAR is
//! only ever at that pool or back in the vault. Each vault owns shares of the contract's stake, so
//! rewards stay with the vault and move with it when it changes hands (Y3, Y5). Only the vault's
//! owner can stake or unstake (Y2), sealed or opened: no signature is involved, and unstaked NEAR
//! comes back into the vault, where the holdings rules apply (Y4).
//!
//! The pool restarts its unlock wait for the whole account on every `unstake`, so requests are
//! batched (Y6): the contract calls the pool's `unstake` only when nothing is unlocking, and
//! withdraws a batch before unstaking the next. A request waits at most two unlock periods.
//! One pool call is in flight at a time (Y7); callbacks never panic and always release it.

use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json};
use near_sdk::{
    assert_one_yocto, env, near, require, AccountId, Gas, NearToken, Promise, PromiseOrValue,
};

use crate::holdings::Holdings;
use crate::{events, Contract, ContractExt};

/// The standard staking pool's `NUM_EPOCHS_TO_UNLOCK`.
pub const UNLOCK_EPOCHS: u64 = 4;
/// The smallest stake, so rounding at the pool stays negligible.
pub const MIN_STAKE: NearToken = NearToken::from_millinear(100);

const NO_DEPOSIT: NearToken = NearToken::from_yoctonear(0);
/// `ping` then `get_account_staked_balance`, in one receipt.
const GAS_FOR_PRICE: Gas = Gas::from_tgas(40);
const GAS_FOR_POOL_CALL: Gas = Gas::from_tgas(75);
const GAS_FOR_STAKING_CALLBACK: Gas = Gas::from_tgas(10);
/// A callback that may start one more pool call: its own work, the call, and that call's callback.
const GAS_FOR_CHAINED_CALLBACK: Gas = Gas::from_tgas(10 + 75 + 10 + 10);
const GAS_MARGIN: Gas = Gas::from_tgas(15);

/// The contract's position at the pool and the unstaking batches (Y6).
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct StakingState {
    /// The one staking pool, fixed at creation (Y1). `None`: staking is off.
    pub pool: Option<AccountId>,
    /// Shares held by all vaults. One share is worth (stake at the pool − `queued`) / `total_shares`.
    pub total_shares: U128,
    /// NEAR asked for in the batch now collecting requests. Still staked at the pool.
    pub queued: NearToken,
    /// The batch now collecting requests.
    pub batch: u64,
    /// NEAR unstaked at the pool for batch `batch - 1`, waiting to unlock. Zero if none.
    pub unbonding: NearToken,
    /// The epoch that batch was unstaked in; it unlocks `UNLOCK_EPOCHS` later.
    pub unbonding_epoch: u64,
    /// Every batch up to this one has been withdrawn from the pool into the contract.
    pub withdrawn_through: u64,
    /// A pool call is in flight (Y7).
    pub busy: bool,
    /// The contract's stake at the pool when last read, and the epoch it was read in.
    pub last_pool_stake: NearToken,
    pub last_pool_stake_epoch: u64,
}

impl StakingState {
    pub fn new(pool: Option<AccountId>) -> Self {
        Self {
            pool,
            total_shares: U128(0),
            queued: NearToken::from_yoctonear(0),
            batch: 1,
            unbonding: NearToken::from_yoctonear(0),
            unbonding_epoch: 0,
            withdrawn_through: 0,
            busy: false,
            last_pool_stake: NearToken::from_yoctonear(0),
            last_pool_stake_epoch: 0,
        }
    }
}

/// One unstake request. A zero amount is an empty slot.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Unstaking {
    pub amount: NearToken,
    pub batch: u64,
}

const EMPTY: Unstaking = Unstaking { amount: NearToken::from_yoctonear(0), batch: 0 };

/// A vault's staking record. Fixed size, so its storage is paid once, when it's created (Y9).
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct VaultStake {
    pub shares: U128,
    /// At most one request in the collecting batch and one unlocking: two slots are enough.
    pub unstaking: [Unstaking; 2],
}

impl VaultStake {
    fn empty() -> Self {
        Self { shares: U128(0), unstaking: [EMPTY; 2] }
    }

    fn is_empty(&self) -> bool {
        self.shares.0 == 0 && self.unstaking.iter().all(|u| u.amount.is_zero())
    }
}

/// A vault's stake as `stake_of` shows it.
#[near(serializers = [json])]
pub struct VaultStakeView {
    pub shares: U128,
    /// The shares' worth at the last pool reading; the pool's own view gives the current worth.
    pub staked_estimate: NearToken,
    /// Asked for; waits for the batch to be unstaked at the pool.
    pub queued: NearToken,
    /// Unstaked at the pool, unlocking at `unlocks_at_epoch`.
    pub unbonding: NearToken,
    pub unlocks_at_epoch: Option<u64>,
    /// Back from the pool. Already counted in `holdings(token_id).near`.
    pub ready: NearToken,
}

/// `a * b / c` in 256 bits, rounded down or up. `None` if `c` is zero or the result overflows.
pub(crate) fn mul_div(a: u128, b: u128, c: u128, round_up: bool) -> Option<u128> {
    if c == 0 {
        return None;
    }
    const MASK: u128 = u64::MAX as u128;
    let (a1, a0) = (a >> 64, a & MASK);
    let (b1, b0) = (b >> 64, b & MASK);
    let (p00, p01, p10, p11) = (a0 * b0, a0 * b1, a1 * b0, a1 * b1);
    let mid = (p00 >> 64) + (p01 & MASK) + (p10 & MASK);
    let lo = (p00 & MASK) | (mid << 64);
    let hi = p11 + (p01 >> 64) + (p10 >> 64) + (mid >> 64);
    if hi >= c {
        return None;
    }
    let (mut rem, mut q) = (hi, 0u128);
    for i in (0..128).rev() {
        let carry = rem >> 127;
        rem = (rem << 1) | ((lo >> i) & 1);
        q <<= 1;
        if carry == 1 || rem >= c {
            rem = rem.wrapping_sub(c);
            q |= 1;
        }
    }
    if round_up && rem > 0 {
        q.checked_add(1)
    } else {
        Some(q)
    }
}

/// Shares for staking `amount` when the vaults together own `owned` at the pool. Rounded down, so
/// a new stake never takes from earlier ones (Y5).
pub(crate) fn shares_for(amount: u128, total_shares: u128, owned: u128) -> u128 {
    if total_shares == 0 || owned == 0 {
        amount
    } else {
        mul_div(amount, total_shares, owned, false).unwrap_or(0)
    }
}

/// Shares to burn for unstaking `amount`. Rounded up, so the other vaults never lose (Y5).
pub(crate) fn shares_to_burn(amount: u128, total_shares: u128, owned: u128) -> Option<u128> {
    mul_div(amount, total_shares, owned, true)
}

/// What `shares` are worth, rounded down.
pub(crate) fn value_of(shares: u128, total_shares: u128, owned: u128) -> u128 {
    mul_div(shares, owned, total_shares, false).unwrap_or(0)
}

/// Empties the slots whose batch has been withdrawn and returns their NEAR.
pub(crate) fn take_withdrawn(stake: &mut VaultStake, withdrawn_through: u64) -> NearToken {
    let mut back = NearToken::from_yoctonear(0);
    for slot in stake.unstaking.iter_mut() {
        if !slot.amount.is_zero() && slot.batch <= withdrawn_through {
            back = back.saturating_add(slot.amount);
            *slot = EMPTY;
        }
    }
    back
}

/// Adds a request to the batch's slot, or an empty one. `false` if neither exists.
pub(crate) fn add_request(stake: &mut VaultStake, amount: NearToken, batch: u64) -> bool {
    if let Some(slot) = stake.unstaking.iter_mut().find(|s| !s.amount.is_zero() && s.batch == batch) {
        slot.amount = slot.amount.saturating_add(amount);
        return true;
    }
    if let Some(slot) = stake.unstaking.iter_mut().find(|s| s.amount.is_zero()) {
        *slot = Unstaking { amount, batch };
        return true;
    }
    false
}

impl Contract {
    fn pool(&self) -> AccountId {
        self.staking.pool.clone().unwrap_or_else(|| env::panic_str("ERR_NO_STAKING"))
    }

    fn stake_record(&self, token_id: &TokenId) -> VaultStake {
        self.stakes.get(token_id).unwrap_or_else(VaultStake::empty)
    }

    /// Writes the vault's stake record and settles its storage against the vault's NEAR, like
    /// `save_holdings` (Y9): a new record is charged and refused if the vault can't pay, an
    /// emptied one is removed and refunded. Not while a pool call is in flight: the vault being
    /// staked has an empty record until its shares arrive. Callbacks only ever keep or remove one.
    fn save_stake(&mut self, token_id: &TokenId, h: &mut Holdings, stake: &VaultStake) {
        let before = env::storage_usage();
        if stake.is_empty() && !self.staking.busy {
            self.stakes.remove(token_id);
        } else {
            self.stakes.insert(token_id, stake);
        }
        let after = env::storage_usage();
        let byte = env::storage_byte_cost();
        if after > before {
            let cost = byte.saturating_mul(u128::from(after - before));
            require!(h.near >= cost, "ERR_VAULT_NEAR_BELOW_STORAGE");
            h.near = h.near.saturating_sub(cost);
        } else {
            h.near = h.near.saturating_add(byte.saturating_mul(u128::from(before - after)));
        }
    }

    /// Moves NEAR back from withdrawn batches into the vault's NEAR, and writes both records.
    pub(crate) fn settle_unstaked(&mut self, token_id: &TokenId) -> Holdings {
        let mut h = self.holdings.get(token_id).unwrap_or_default();
        let Some(mut stake) = self.stakes.get(token_id) else {
            return h;
        };
        let back = take_withdrawn(&mut stake, self.staking.withdrawn_through);
        if back.is_zero() {
            return h;
        }
        h.near = h.near.saturating_add(back);
        self.save_stake(token_id, &mut h, &stake);
        self.holdings.insert(token_id, &h);
        h
    }

    /// NEAR back from the pool for this vault but not yet moved into its record.
    pub(crate) fn ready_unstaked(&self, token_id: &TokenId) -> NearToken {
        self.stakes
            .get(token_id)
            .map(|mut s| take_withdrawn(&mut s, self.staking.withdrawn_through))
            .unwrap_or(NearToken::from_yoctonear(0))
    }

    fn require_idle(&self, gas: Gas) {
        require!(!self.staking.busy, "ERR_STAKING_BUSY");
        require!(env::prepaid_gas() >= gas.saturating_add(GAS_MARGIN), "ERR_GAS");
    }

    /// The pool's `ping`, then the contract's stake there, in one receipt.
    fn read_pool_stake(&self) -> Promise {
        Promise::new(self.pool())
            .function_call("ping".to_string(), b"{}".to_vec(), NO_DEPOSIT, Gas::from_tgas(25))
            .function_call(
                "get_account_staked_balance".to_string(),
                serde_json::to_vec(&json!({ "account_id": env::current_account_id() })).unwrap_or_default(),
                NO_DEPOSIT,
                Gas::from_tgas(10),
            )
    }

    /// The stake the pool reported, if the read succeeded.
    fn pool_stake_result(&mut self) -> Option<u128> {
        let bytes = env::promise_result_checked(0, 128).ok()?;
        let staked = serde_json::from_slice::<U128>(&bytes).ok()?.0;
        self.staking.last_pool_stake = NearToken::from_yoctonear(staked);
        self.staking.last_pool_stake_epoch = env::epoch_height();
        Some(staked)
    }

    /// NEAR at the pool that belongs to share holders: the stake minus what's queued to leave.
    fn owned_at_pool(&self, staked: u128) -> u128 {
        staked.saturating_sub(self.staking.queued.as_yoctonear())
    }

    /// Unstakes the collecting batch at the pool. Called only when nothing is unlocking (Y6).
    fn unstake_batch(&mut self) -> Promise {
        let amount = self.staking.queued;
        Promise::new(self.pool())
            .function_call(
                "unstake".to_string(),
                serde_json::to_vec(&json!({ "amount": U128(amount.as_yoctonear()) })).unwrap_or_default(),
                NO_DEPOSIT,
                GAS_FOR_POOL_CALL,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_STAKING_CALLBACK)
                    .on_batch_unstaked(amount),
            )
    }
}

#[near]
impl Contract {
    /// The pool, the batches and the contract's last-read stake.
    pub fn staking(&self) -> StakingState {
        self.staking.clone()
    }

    pub fn stake_of(&self, token_id: TokenId) -> Option<VaultStakeView> {
        let s = self.stakes.get(&token_id)?;
        let st = &self.staking;
        let zero = NearToken::from_yoctonear(0);
        let (mut queued, mut unbonding, mut ready) = (zero, zero, zero);
        for slot in s.unstaking.iter().filter(|u| !u.amount.is_zero()) {
            if slot.batch <= st.withdrawn_through {
                ready = ready.saturating_add(slot.amount);
            } else if slot.batch == st.batch {
                queued = queued.saturating_add(slot.amount);
            } else {
                unbonding = unbonding.saturating_add(slot.amount);
            }
        }
        let owned = self.owned_at_pool(st.last_pool_stake.as_yoctonear());
        Some(VaultStakeView {
            shares: s.shares,
            staked_estimate: NearToken::from_yoctonear(value_of(s.shares.0, st.total_shares.0, owned)),
            queued,
            unbonding,
            unlocks_at_epoch: (!unbonding.is_zero()).then(|| st.unbonding_epoch + UNLOCK_EPOCHS),
            ready,
        })
    }

    /// Stakes `amount` of the vault's NEAR with the pool. Owner only, sealed or opened (Y2); attach
    /// 1 yoctoNEAR and at least 200 Tgas. The first stake also pays the vault's staking record (Y9).
    /// Fails: `ERR_NO_STAKING`, `ERR_NOT_OWNER`, `ERR_STAKING_BUSY`, `ERR_MIN_STAKE`, `ERR_AMOUNT`, `ERR_GAS`.
    #[payable]
    pub fn stake(&mut self, token_id: TokenId, amount: NearToken) -> Promise {
        assert_one_yocto();
        self.vault_for_owner(&token_id);
        self.pool();
        self.require_idle(GAS_FOR_PRICE.saturating_add(GAS_FOR_CHAINED_CALLBACK));
        require!(amount >= MIN_STAKE, "ERR_MIN_STAKE");
        let mut h = self.settle_unstaked(&token_id);
        // Busy first, so the record is kept with no shares yet: its storage is charged now (Y9).
        self.staking.busy = true;
        let stake = self.stake_record(&token_id);
        self.save_stake(&token_id, &mut h, &stake);
        require!(h.near >= amount, "ERR_AMOUNT");
        h.near = h.near.saturating_sub(amount);
        self.holdings.insert(&token_id, &h);
        self.read_pool_stake().then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_FOR_CHAINED_CALLBACK)
                .on_stake_priced(token_id, amount),
        )
    }

    /// Never panics (Y7): prices the shares, then deposits and stakes at the pool. If the read
    /// failed, the NEAR goes back into the vault.
    #[private]
    pub fn on_stake_priced(&mut self, token_id: TokenId, amount: NearToken) -> PromiseOrValue<()> {
        let shares = self
            .pool_stake_result()
            .map(|staked| shares_for(amount.as_yoctonear(), self.staking.total_shares.0, self.owned_at_pool(staked)))
            .unwrap_or(0);
        if shares == 0 {
            self.refund_stake(&token_id, amount);
            return PromiseOrValue::Value(());
        }
        PromiseOrValue::Promise(
            Promise::new(self.pool())
                .function_call("deposit_and_stake".to_string(), b"{}".to_vec(), amount, GAS_FOR_POOL_CALL)
                .then(
                    Self::ext(env::current_account_id())
                        .with_static_gas(GAS_FOR_STAKING_CALLBACK)
                        .on_staked(token_id, amount, U128(shares)),
                ),
        )
    }

    /// Never panics (Y7): credits the shares, or puts the NEAR back if the pool refused it.
    #[private]
    pub fn on_staked(&mut self, token_id: TokenId, amount: NearToken, shares: U128) {
        if env::promise_result_checked(0, 64).is_err() {
            self.refund_stake(&token_id, amount);
            return;
        }
        let mut stake = self.stake_record(&token_id);
        stake.shares = U128(stake.shares.0 + shares.0);
        self.stakes.insert(&token_id, &stake);
        self.staking.total_shares = U128(self.staking.total_shares.0 + shares.0);
        // Keeps `stake_of`'s estimate current until the next reading (the pool may keep a few yocto).
        self.staking.last_pool_stake = self.staking.last_pool_stake.saturating_add(amount);
        self.staking.busy = false;
        events::emit("staked", json!({ "token_id": token_id, "amount": amount, "shares": shares }));
    }

    /// Asks to unstake `amount` of the vault's staked NEAR, or all of it. Owner only, sealed or
    /// opened (Y2, Y3); attach 1 yoctoNEAR and at least 200 Tgas. The NEAR comes back into the vault once
    /// its batch unlocks and is withdrawn (`process_unstaking`).
    /// Fails: `ERR_NO_STAKING`, `ERR_NOT_OWNER`, `ERR_STAKING_BUSY`, `ERR_NOT_STAKED`, `ERR_GAS`;
    /// an amount above the stake is refused in the callback (`unstake_failed`).
    #[payable]
    pub fn unstake(&mut self, token_id: TokenId, amount: Option<NearToken>) -> Promise {
        assert_one_yocto();
        self.vault_for_owner(&token_id);
        self.pool();
        self.require_idle(GAS_FOR_PRICE.saturating_add(GAS_FOR_CHAINED_CALLBACK));
        self.settle_unstaked(&token_id);
        require!(self.stake_record(&token_id).shares.0 > 0, "ERR_NOT_STAKED");
        require!(amount.is_none_or(|a| !a.is_zero()), "ERR_AMOUNT");
        self.staking.busy = true;
        self.read_pool_stake().then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_FOR_CHAINED_CALLBACK)
                .on_unstake_priced(token_id, amount),
        )
    }

    /// Never panics (Y7): burns the vault's shares at the fresh price and queues the NEAR. If
    /// nothing is unlocking, unstakes the batch at the pool right away (Y6).
    #[private]
    pub fn on_unstake_priced(&mut self, token_id: TokenId, amount: Option<NearToken>) -> PromiseOrValue<()> {
        let mut stake = self.stake_record(&token_id);
        let total = self.staking.total_shares.0;
        let planned = self.pool_stake_result().and_then(|staked| {
            let owned = self.owned_at_pool(staked);
            let (burn, near) = match amount {
                None => (stake.shares.0, value_of(stake.shares.0, total, owned)),
                Some(a) => (shares_to_burn(a.as_yoctonear(), total, owned)?, a.as_yoctonear()),
            };
            (burn > 0 && burn <= stake.shares.0 && near > 0).then_some((burn, NearToken::from_yoctonear(near)))
        });
        let Some((burn, near)) = planned else {
            self.staking.busy = false;
            events::emit("unstake_failed", json!({ "token_id": token_id, "amount": amount }));
            return PromiseOrValue::Value(());
        };
        let batch = self.staking.batch;
        if !add_request(&mut stake, near, batch) {
            self.staking.busy = false;
            events::emit("unstake_failed", json!({ "token_id": token_id, "amount": amount }));
            return PromiseOrValue::Value(());
        }
        stake.shares = U128(stake.shares.0 - burn);
        self.stakes.insert(&token_id, &stake);
        self.staking.total_shares = U128(total - burn);
        self.staking.queued = self.staking.queued.saturating_add(near);
        events::emit("unstake_requested", json!({ "token_id": token_id, "amount": near, "batch": batch }));
        if self.staking.unbonding.is_zero() {
            return PromiseOrValue::Promise(self.unstake_batch());
        }
        self.staking.busy = false;
        PromiseOrValue::Value(())
    }

    /// Moves unstaking along; anyone may call it. Once the unlocking batch has unlocked, withdraws
    /// it from the pool (its NEAR goes back into each vault), then unstakes the next batch.
    /// Fails: `ERR_NO_STAKING`, `ERR_STAKING_BUSY`, `ERR_NOT_UNLOCKED`, `ERR_NOTHING_TO_DO`, `ERR_GAS`.
    pub fn process_unstaking(&mut self) -> Promise {
        let pool = self.pool();
        self.require_idle(GAS_FOR_POOL_CALL.saturating_add(GAS_FOR_CHAINED_CALLBACK));
        if self.staking.unbonding.is_zero() {
            require!(!self.staking.queued.is_zero(), "ERR_NOTHING_TO_DO");
            self.staking.busy = true;
            return self.unstake_batch();
        }
        require!(
            env::epoch_height() >= self.staking.unbonding_epoch + UNLOCK_EPOCHS,
            "ERR_NOT_UNLOCKED"
        );
        self.staking.busy = true;
        Promise::new(pool)
            .function_call("withdraw_all".to_string(), b"{}".to_vec(), NO_DEPOSIT, GAS_FOR_POOL_CALL)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_CHAINED_CALLBACK)
                    .on_batch_withdrawn(),
            )
    }

    /// Never panics (Y7): records the unlocking batch, or leaves it queued if the pool refused.
    #[private]
    pub fn on_batch_unstaked(&mut self, amount: NearToken) {
        let ok = env::promise_result_checked(0, 64).is_ok();
        if ok {
            self.staking.unbonding = amount;
            self.staking.unbonding_epoch = env::epoch_height();
            self.staking.queued = self.staking.queued.saturating_sub(amount);
            self.staking.batch += 1;
            self.staking.last_pool_stake = self.staking.last_pool_stake.saturating_sub(amount);
        }
        self.staking.busy = false;
        events::emit(
            if ok { "batch_unstaked" } else { "batch_unstake_failed" },
            json!({ "amount": amount, "batch": self.staking.batch - u64::from(ok) }),
        );
    }

    /// Never panics (Y7): marks the batch withdrawn, then unstakes the next one if any.
    #[private]
    pub fn on_batch_withdrawn(&mut self) -> PromiseOrValue<()> {
        let ok = env::promise_result_checked(0, 64).is_ok();
        events::emit(
            if ok { "batch_withdrawn" } else { "batch_withdraw_failed" },
            json!({ "amount": self.staking.unbonding, "batch": self.staking.batch - 1 }),
        );
        if ok {
            self.staking.withdrawn_through = self.staking.batch - 1;
            self.staking.unbonding = NearToken::from_yoctonear(0);
            if !self.staking.queued.is_zero() {
                return PromiseOrValue::Promise(self.unstake_batch());
            }
        }
        self.staking.busy = false;
        PromiseOrValue::Value(())
    }
}

impl Contract {
    /// Puts NEAR that didn't reach the pool back into the vault, and drops an unused record.
    fn refund_stake(&mut self, token_id: &TokenId, amount: NearToken) {
        self.staking.busy = false;
        let mut h = self.holdings.get(token_id).unwrap_or_default();
        h.near = h.near.saturating_add(amount);
        let stake = self.stake_record(token_id);
        self.save_stake(token_id, &mut h, &stake);
        self.holdings.insert(token_id, &h);
        events::emit("stake_failed", json!({ "token_id": token_id, "amount": amount }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Config, Finish};
    use near_sdk::test_utils::{testing_env_with_promise_results, VMContextBuilder};
    use near_sdk::{testing_env, PromiseResult};

    const NEAR: u128 = 10u128.pow(24);

    fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }

    fn ctx(predecessor: &str, deposit: u128, epoch: u64) -> VMContextBuilder {
        let mut c = VMContextBuilder::new();
        c.current_account_id(acc("bearer.test"))
            .predecessor_account_id(acc(predecessor))
            .signer_account_id(acc(predecessor))
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .prepaid_gas(Gas::from_tgas(300))
            .epoch_height(epoch)
            .account_balance(NearToken::from_near(100));
        c
    }

    fn as_owner(who: &str) {
        testing_env!(ctx(who, 1, 10).build());
    }

    /// The contract calling itself back with the pool's answer.
    fn callback(result: PromiseResult, epoch: u64) {
        testing_env_with_promise_results(ctx("bearer.test", 0, epoch).build(), result);
    }

    fn pool_says(staked: u128) -> PromiseResult {
        PromiseResult::Successful(format!("\"{staked}\"").into_bytes())
    }

    fn contract(pool: Option<&str>) -> Contract {
        testing_env!(ctx("deployer.test", 0, 10).build());
        Contract::new(
            acc("signer.test"),
            Config {
                evm_chain_ids: vec![84532],
                max_btc_inputs: 4,
                create_deposit: NearToken::from_millinear(50),
                withdraw_deposit: NearToken::from_millinear(10),
                mpc_sign_deposit: NearToken::from_yoctonear(1),
            },
            None,
            pool.map(acc),
        )
    }

    /// A sealed vault of `owner`'s holding `near` NEAR.
    fn vault(c: &mut Contract, owner: &str, near: u128) -> TokenId {
        testing_env!(ctx(owner, 50 * 10u128.pow(21), 10).build());
        let id = c.create_vault(None, Finish::Obsidian);
        testing_env!(ctx(owner, near * NEAR, 10).build());
        c.deposit_near(id.clone());
        id
    }

    /// Stakes `amount` NEAR from the vault, with the pool reporting `pool_stake` beforehand.
    fn staked(c: &mut Contract, owner: &str, id: &TokenId, amount: u128, pool_stake: u128) {
        as_owner(owner);
        let _ = c.stake(id.clone(), NearToken::from_near(amount));
        callback(pool_says(pool_stake), 10);
        let shares = match c.on_stake_priced(id.clone(), NearToken::from_near(amount)) {
            PromiseOrValue::Promise(_) => shares_for(amount * NEAR, c.staking.total_shares.0, pool_stake - c.staking.queued.as_yoctonear()),
            PromiseOrValue::Value(()) => panic!("stake not sent to the pool"),
        };
        callback(PromiseResult::Successful(vec![]), 10);
        c.on_staked(id.clone(), NearToken::from_near(amount), U128(shares));
    }

    #[test]
    fn mul_div_is_exact_in_256_bits() {
        assert_eq!(mul_div(7, 3, 2, false), Some(10));
        assert_eq!(mul_div(7, 3, 2, true), Some(11));
        assert_eq!(mul_div(6, 3, 2, true), Some(9));
        // 10^30 * 10^30 / 10^30 overflows u128 halfway through, not at the end.
        let big = 10u128.pow(30);
        assert_eq!(mul_div(big, big, big, false), Some(big));
        assert_eq!(mul_div(big, 3 * big, 2 * big, true), Some(big + big / 2));
        assert_eq!(mul_div(u128::MAX, 2, 1, false), None);
        assert_eq!(mul_div(1, 1, 0, false), None);
    }

    #[test]
    fn rewards_stay_with_earlier_stakes() {
        // Vault A stakes 10, the pool pays 1 in rewards, vault B stakes 10 (Y5).
        let a = shares_for(10 * NEAR, 0, 0);
        let b = shares_for(10 * NEAR, a, 11 * NEAR);
        let (total, owned) = (a + b, 21 * NEAR);
        let va = value_of(a, total, owned);
        assert!((11 * NEAR - 1..=11 * NEAR).contains(&va)); // rounded down, never up
        assert!(value_of(b, total, owned) <= 10 * NEAR);
        // Burning for an amount rounds up: what's left never pays for someone else's unstake.
        let burn = shares_to_burn(NEAR, total, owned).unwrap();
        assert!(value_of(burn, total, owned) >= NEAR - 1);
        assert!(mul_div(burn, owned, total, true).unwrap() >= NEAR);
    }

    #[test]
    fn two_slots_hold_a_queued_and_an_unlocking_request() {
        let mut s = VaultStake::empty();
        assert!(add_request(&mut s, NearToken::from_near(1), 1));
        assert!(add_request(&mut s, NearToken::from_near(2), 1)); // same batch merges
        assert!(add_request(&mut s, NearToken::from_near(3), 2));
        assert!(!add_request(&mut s, NearToken::from_near(4), 3));
        assert_eq!(take_withdrawn(&mut s, 0), NearToken::from_near(0));
        assert_eq!(take_withdrawn(&mut s, 1), NearToken::from_near(3));
        assert!(add_request(&mut s, NearToken::from_near(4), 3));
        assert_eq!(take_withdrawn(&mut s, 3), NearToken::from_near(7));
        assert!(s.is_empty());
    }

    #[test]
    #[should_panic(expected = "ERR_NO_STAKING")]
    fn no_pool_no_staking() {
        let mut c = contract(None);
        let id = vault(&mut c, "alice.test", 2);
        as_owner("alice.test");
        let _ = c.stake(id, NearToken::from_near(1));
    }

    #[test]
    #[should_panic(expected = "ERR_NOT_OWNER")]
    fn only_owner_can_stake() {
        let mut c = contract(Some("pool.test"));
        let id = vault(&mut c, "alice.test", 2);
        as_owner("eve.test");
        let _ = c.stake(id, NearToken::from_near(1));
    }

    #[test]
    #[should_panic(expected = "ERR_NOT_OWNER")]
    fn only_owner_can_unstake() {
        let mut c = contract(Some("pool.test"));
        let id = vault(&mut c, "alice.test", 3);
        staked(&mut c, "alice.test", &id, 2, 0);
        as_owner("eve.test");
        let _ = c.unstake(id, None);
    }

    #[test]
    #[should_panic(expected = "ERR_STAKING_BUSY")]
    fn one_pool_call_at_a_time() {
        let mut c = contract(Some("pool.test"));
        let id = vault(&mut c, "alice.test", 3);
        as_owner("alice.test");
        let _ = c.stake(id.clone(), NearToken::from_near(1));
        let _ = c.stake(id, NearToken::from_near(1));
    }

    #[test]
    #[should_panic(expected = "ERR_MIN_STAKE")]
    fn too_small_to_stake() {
        let mut c = contract(Some("pool.test"));
        let id = vault(&mut c, "alice.test", 2);
        as_owner("alice.test");
        let _ = c.stake(id, NearToken::from_millinear(99));
    }

    #[test]
    fn stake_credits_shares_and_pays_its_record() {
        let mut c = contract(Some("pool.test"));
        let id = vault(&mut c, "alice.test", 3);
        let before = c.holdings(id.clone()).near;
        staked(&mut c, "alice.test", &id, 2, 0);
        let s = c.stake_of(id.clone()).unwrap();
        assert_eq!(s.shares, U128(2 * NEAR));
        assert_eq!(s.staked_estimate, NearToken::from_near(2));
        assert!(!c.staking.busy);
        let after = c.holdings(id).near;
        // Two NEAR staked, and a little more for the record's storage (Y9).
        assert!(after < before.saturating_sub(NearToken::from_near(2)));
        assert!(after > before.saturating_sub(NearToken::from_near(2)).saturating_sub(NearToken::from_millinear(5)));
    }

    #[test]
    fn failed_stake_puts_the_near_back() {
        let mut c = contract(Some("pool.test"));
        let id = vault(&mut c, "alice.test", 3);
        let before = c.holdings(id.clone()).near;
        as_owner("alice.test");
        let _ = c.stake(id.clone(), NearToken::from_near(2));
        callback(pool_says(0), 10);
        let _ = c.on_stake_priced(id.clone(), NearToken::from_near(2));
        callback(PromiseResult::Failed, 10);
        c.on_staked(id.clone(), NearToken::from_near(2), U128(2 * NEAR));
        assert_eq!(c.holdings(id.clone()).near, before); // record refunded too
        assert!(c.stake_of(id).is_none());
        assert!(!c.staking.busy);
    }

    #[test]
    fn failed_price_read_puts_the_near_back() {
        let mut c = contract(Some("pool.test"));
        let id = vault(&mut c, "alice.test", 3);
        let before = c.holdings(id.clone()).near;
        as_owner("alice.test");
        let _ = c.stake(id.clone(), NearToken::from_near(2));
        callback(PromiseResult::Failed, 10);
        assert!(matches!(c.on_stake_priced(id.clone(), NearToken::from_near(2)), PromiseOrValue::Value(())));
        assert_eq!(c.holdings(id).near, before);
        assert!(!c.staking.busy);
    }

    #[test]
    fn unstaking_is_batched_and_comes_back_into_the_vault() {
        let mut c = contract(Some("pool.test"));
        let a = vault(&mut c, "alice.test", 3);
        let b = vault(&mut c, "bob.test", 3);
        staked(&mut c, "alice.test", &a, 2, 0);
        staked(&mut c, "bob.test", &b, 2, 2 * NEAR);

        // Alice unstakes 1: nothing is unlocking, so the batch goes to the pool at once.
        as_owner("alice.test");
        let _ = c.unstake(a.clone(), Some(NearToken::from_near(1)));
        callback(pool_says(4 * NEAR), 10);
        assert!(matches!(c.on_unstake_priced(a.clone(), Some(NearToken::from_near(1))), PromiseOrValue::Promise(_)));
        callback(PromiseResult::Successful(vec![]), 10);
        c.on_batch_unstaked(NearToken::from_near(1));
        assert_eq!(c.staking.unbonding, NearToken::from_near(1));
        assert_eq!(c.staking.batch, 2);
        // The estimate follows the stake that left the pool: 4 staked, 1 unstaked.
        assert_eq!(c.stake_of(a.clone()).unwrap().staked_estimate, NearToken::from_near(1));
        assert_eq!(c.stake_of(b.clone()).unwrap().staked_estimate, NearToken::from_near(2));
        assert_eq!(c.stake_of(a.clone()).unwrap().unlocks_at_epoch, Some(10 + UNLOCK_EPOCHS));

        // Bob unstakes everything while that batch unlocks: it waits, so alice's wait doesn't restart (Y6).
        as_owner("bob.test");
        let _ = c.unstake(b.clone(), None);
        callback(pool_says(3 * NEAR), 11);
        assert!(matches!(c.on_unstake_priced(b.clone(), None), PromiseOrValue::Value(())));
        assert_eq!(c.stake_of(b.clone()).unwrap().queued, NearToken::from_near(2));
        assert_eq!(c.stake_of(b.clone()).unwrap().shares, U128(0));
        assert!(!c.staking.busy);

        // Too early to withdraw.
        testing_env!(ctx("carol.test", 0, 10 + UNLOCK_EPOCHS - 1).build());
        let early = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = c.process_unstaking();
        }));
        assert!(early.is_err());

        // Unlocked: anyone withdraws alice's batch, then bob's is unstaked.
        testing_env!(ctx("carol.test", 0, 10 + UNLOCK_EPOCHS).build());
        let _ = c.process_unstaking();
        callback(PromiseResult::Successful(vec![]), 10 + UNLOCK_EPOCHS);
        assert!(matches!(c.on_batch_withdrawn(), PromiseOrValue::Promise(_)));
        callback(PromiseResult::Successful(vec![]), 10 + UNLOCK_EPOCHS);
        c.on_batch_unstaked(NearToken::from_near(2));

        let ready = c.stake_of(a.clone()).unwrap();
        assert_eq!(ready.ready, NearToken::from_near(1));
        let held = c.holdings(a.clone()).near;
        assert!(held > NearToken::from_near(1));
        // Settling moves it into the vault's record; the view doesn't change.
        c.settle_unstaked(&a);
        assert_eq!(c.holdings(a.clone()).near, held);
        assert_eq!(c.stake_of(a).unwrap().ready, NearToken::from_near(0));
        let bob = c.stake_of(b).unwrap();
        assert_eq!(bob.unbonding, NearToken::from_near(2));
        assert_eq!(bob.unlocks_at_epoch, Some(10 + 2 * UNLOCK_EPOCHS));
    }

    #[test]
    fn a_refused_unstake_changes_nothing() {
        let mut c = contract(Some("pool.test"));
        let a = vault(&mut c, "alice.test", 3);
        staked(&mut c, "alice.test", &a, 2, 0);
        as_owner("alice.test");
        let _ = c.unstake(a.clone(), Some(NearToken::from_near(5)));
        callback(pool_says(2 * NEAR), 10);
        assert!(matches!(c.on_unstake_priced(a.clone(), Some(NearToken::from_near(5))), PromiseOrValue::Value(())));
        assert_eq!(c.stake_of(a).unwrap().shares, U128(2 * NEAR));
        assert!(c.staking.queued.is_zero());
        assert!(!c.staking.busy);
    }

    #[test]
    fn a_refused_batch_stays_queued() {
        let mut c = contract(Some("pool.test"));
        let a = vault(&mut c, "alice.test", 3);
        staked(&mut c, "alice.test", &a, 2, 0);
        as_owner("alice.test");
        let _ = c.unstake(a.clone(), None);
        callback(pool_says(2 * NEAR), 10);
        let _ = c.on_unstake_priced(a.clone(), None);
        callback(PromiseResult::Failed, 10);
        c.on_batch_unstaked(NearToken::from_near(2));
        assert_eq!(c.staking.queued, NearToken::from_near(2));
        assert!(c.staking.unbonding.is_zero());
        assert_eq!(c.staking.batch, 1);
        assert!(!c.staking.busy);
        // Anyone can retry it.
        testing_env!(ctx("carol.test", 0, 11).build());
        let _ = c.process_unstaking();
        assert!(c.staking.busy);
    }
}
