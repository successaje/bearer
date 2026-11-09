//! Sandbox-only: a staking pool with the standard pool's interface and accounting (shares,
//! rounding, a 4-epoch unlock that restarts on every `unstake`), but no validator behind it.
//! `add_reward` stands in for epoch rewards and `set_failing` makes a method panic, so the vault
//! staking tests (v2) can check rewards and failures.
#![allow(deprecated)]

use near_sdk::collections::LookupMap;
use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault, Promise};

const NUM_EPOCHS_TO_UNLOCK: u64 = 4;

#[near(serializers = [borsh])]
#[derive(Default)]
struct Account {
    unstaked: u128,
    shares: u128,
    unlock_epoch: u64,
}

#[near(serializers = [json])]
pub struct HumanReadableAccount {
    pub account_id: AccountId,
    pub unstaked_balance: U128,
    pub staked_balance: U128,
    pub can_withdraw: bool,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockPool {
    accounts: LookupMap<AccountId, Account>,
    total_staked: u128,
    total_shares: u128,
    failing: Vec<String>,
}

/// `a * b / c` in 256 bits, like the real pool's U256 math.
fn mul_div(a: u128, b: u128, c: u128, up: bool) -> u128 {
    const MASK: u128 = u64::MAX as u128;
    let (a1, a0) = (a >> 64, a & MASK);
    let (b1, b0) = (b >> 64, b & MASK);
    let (p00, p01, p10, p11) = (a0 * b0, a0 * b1, a1 * b0, a1 * b1);
    let mid = (p00 >> 64) + (p01 & MASK) + (p10 & MASK);
    let lo = (p00 & MASK) | (mid << 64);
    let hi = p11 + (p01 >> 64) + (p10 >> 64) + (mid >> 64);
    require!(c > 0 && hi < c, "MOCK_OVERFLOW");
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
    q + u128::from(up && rem > 0)
}

#[near]
impl MockPool {
    #[init]
    pub fn new() -> Self {
        Self { accounts: LookupMap::new(b"a"), total_staked: 0, total_shares: 0, failing: vec![] }
    }

    fn check(&self, method: &str) {
        require!(!self.failing.iter().any(|m| m == method), "MOCK_FAILING");
    }

    fn account(&self, id: &AccountId) -> Account {
        self.accounts.get(id).unwrap_or_default()
    }

    fn staked_of(&self, a: &Account) -> u128 {
        if self.total_shares == 0 {
            0
        } else {
            mul_div(a.shares, self.total_staked, self.total_shares, false)
        }
    }

    pub fn ping(&mut self) {
        self.check("ping");
    }

    #[payable]
    pub fn deposit_and_stake(&mut self) {
        self.check("deposit_and_stake");
        let amount = env::attached_deposit().as_yoctonear();
        let id = env::predecessor_account_id();
        let mut a = self.account(&id);
        a.unstaked += amount;
        let shares = if self.total_shares == 0 { amount } else { mul_div(amount, self.total_shares, self.total_staked, false) };
        require!(shares > 0, "MOCK_ZERO_SHARES");
        let charge = if self.total_shares == 0 { amount } else { mul_div(shares, self.total_staked, self.total_shares, false) };
        a.unstaked -= charge;
        a.shares += shares;
        self.total_staked += charge;
        self.total_shares += shares;
        self.accounts.insert(&id, &a);
    }

    pub fn unstake(&mut self, amount: U128) {
        self.check("unstake");
        let id = env::predecessor_account_id();
        let mut a = self.account(&id);
        let shares = mul_div(amount.0, self.total_shares, self.total_staked, true);
        require!(shares > 0 && a.shares >= shares, "Not enough staked balance to unstake");
        let receive = mul_div(shares, self.total_staked, self.total_shares, true);
        a.shares -= shares;
        a.unstaked += receive;
        a.unlock_epoch = env::epoch_height() + NUM_EPOCHS_TO_UNLOCK;
        self.total_shares -= shares;
        self.total_staked -= receive;
        self.accounts.insert(&id, &a);
    }

    pub fn withdraw_all(&mut self) {
        self.check("withdraw_all");
        let id = env::predecessor_account_id();
        let mut a = self.account(&id);
        require!(a.unlock_epoch <= env::epoch_height(), "The unstaked balance is not yet available due to unstaking delay");
        let amount = a.unstaked;
        require!(amount > 0, "MOCK_NOTHING");
        a.unstaked = 0;
        self.accounts.insert(&id, &a);
        Promise::new(id).transfer(NearToken::from_yoctonear(amount)).detach();
    }

    pub fn get_account_staked_balance(&self, account_id: AccountId) -> U128 {
        U128(self.staked_of(&self.account(&account_id)))
    }

    pub fn get_account(&self, account_id: AccountId) -> HumanReadableAccount {
        let a = self.account(&account_id);
        HumanReadableAccount {
            staked_balance: U128(self.staked_of(&a)),
            unstaked_balance: U128(a.unstaked),
            can_withdraw: a.unlock_epoch <= env::epoch_height(),
            account_id,
        }
    }

    /// Test switch: rewards, as if an epoch paid out.
    #[payable]
    pub fn add_reward(&mut self) {
        self.total_staked += env::attached_deposit().as_yoctonear();
    }

    /// Test switch: makes `method` panic, or stop panicking.
    pub fn set_failing(&mut self, method: String, on: bool) {
        self.failing.retain(|m| m != &method);
        if on {
            self.failing.push(method);
        }
    }
}
