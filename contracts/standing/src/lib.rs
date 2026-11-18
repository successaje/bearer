//! Bearer standing payments: a vault that pays a fixed amount to a named payee every period, from
//! its own coins.
//!
//! Escrow by transfer, like the schedule. The giver sends a sealed vault here with
//! `nft_transfer_call`, naming the payee, the chain, the address every payment goes to, the
//! amount, the highest fee a payment may carry, the period and the first due date. From that date
//! the payee may collect one payment per period: this contract, now the vault's owner on Bearer,
//! asks Bearer to sign a transfer of exactly that amount to exactly that address (P2, P3).
//!
//! Paying from a vault breaks its seal, and Bearer never moves an opened vault (its invariant I2).
//! So the first payment opens the vault, and from then on it stays here: the giver keeps every
//! other power through this contract, stopping the payments and withdrawing anything, unless they
//! made the plan irrevocable, in which case those wait until it ends (P5). Before the first
//! payment, a cancellable plan's vault can be taken back still sealed (P6).
//!
//! Whether Bearer signed is read back from Bearer's own withdrawal record before anything counts,
//! and only one request per vault is ever in flight (P4). Threats P1–P12 in docs/THREAT_MODEL.md.
#![allow(deprecated)] // storage-measured collections, as in the Bearer contract

use near_contract_standards::non_fungible_token::core::NonFungibleTokenReceiver;
use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::collections::{LookupMap, UnorderedMap};
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{self, json, Value};
use near_sdk::{
    assert_one_yocto, env, near, require, AccountId, BorshStorageKey, Gas, NearToken,
    PanicOnDefault, Promise, PromiseOrValue,
};

const GAS_FOR_NFT_TRANSFER: Gas = Gas::from_tgas(20);
/// Settles a move, including scheduling the deposit refund and its own callback.
const GAS_FOR_ON_MOVED: Gas = Gas::from_tgas(15);
const GAS_FOR_ON_PAYOUT: Gas = Gas::from_tgas(5);
const GAS_FOR_TAKE_BACK: Gas = Gas::from_tgas(50);
const GAS_FOR_BREAK_SEAL: Gas = Gas::from_tgas(10);
/// Bearer's own floor for one sign request (`GAS_FOR_SIGN` there).
const TGAS_PER_SIGNATURE: u64 = 15;
/// Bearer's callback reserve plus its margin, per chain, plus 5 Tgas of slack.
const TGAS_BTC_FIXED: u64 = 30 + 15 + 5;
const TGAS_EVM_FIXED: u64 = 20 + 15 + 5;
const TGAS_SOL_FIXED: u64 = 15 + 15 + 5;
const GAS_FOR_WITHDRAWALS_VIEW: Gas = Gas::from_tgas(10);
const GAS_FOR_ON_SETTLED: Gas = Gas::from_tgas(20);
/// This contract's own work in `collect` and `withdraw` before handing over.
const GAS_FOR_SELF: Gas = Gas::from_tgas(15);
const GAS_FOR_RECHECK: Gas = Gas::from_tgas(40);
const GAS_FOR_VAULT_VIEW: Gas = Gas::from_tgas(10);
const GAS_FOR_ON_UNPLANNED_READ: Gas = Gas::from_tgas(30);
const GAS_FOR_RETURN_UNPLANNED: Gas = Gas::from_tgas(50);
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const SECOND: u64 = 1_000_000_000;
/// A minute, so a plan can be tried out; a real one is more likely a week or a month.
pub const MIN_INTERVAL_NS: u64 = 60 * SECOND;
/// About ten years.
pub const MAX_INTERVAL_NS: u64 = 10 * 366 * 24 * 3600 * SECOND;
/// About 100 years.
pub const MAX_LEAD_NS: u64 = 100 * 366 * 24 * 3600 * SECOND;
pub const MAX_PAYMENTS: u32 = 100_000;
/// Bitcoin inputs per payment this contract passes on; Bearer's own limit may be lower.
pub const MAX_BTC_INPUTS: usize = 8;
const MAX_ADDRESS_LEN: usize = 90;
const MAX_VAULT_VIEW: usize = 16 * 1024;
const MAX_WITHDRAWALS_VIEW: usize = 16 * 1024;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Plans,
    Deposits,
    Claimable,
}

/// The chain a plan pays on, in the vault's own native coin there.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Chain {
    /// Bitcoin, in satoshis.
    Btc,
    /// An EVM chain Bearer signs for, in wei.
    Evm,
    /// Solana, in lamports. Solana's fee is fixed and paid by the vault on top.
    Sol,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PlanState {
    /// Nothing in flight.
    Waiting,
    /// The payee's payment is with Bearer; settles once Bearer's record is read back.
    Paying { caller: AccountId, attached: NearToken },
    /// The giver's withdrawal is with Bearer; settles the same way.
    Withdrawing { caller: AccountId, attached: NearToken },
    /// Bearer's record couldn't be read back: anyone may `recheck` (P4).
    Unsettled { caller: AccountId, attached: NearToken, paying: bool },
    /// On its way back to the giver, still sealed.
    Returning,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Plan {
    pub token_id: TokenId,
    pub giver: AccountId,
    pub payee: AccountId,
    pub chain: Chain,
    /// Where every payment goes: a Bitcoin address, a `0x…` address (lower case) or a Solana one.
    pub to: String,
    /// EVM only: the chain every payment is signed for.
    pub chain_id: Option<U64>,
    /// Each payment, in satoshis, wei or lamports.
    pub amount: U128,
    /// The highest fee a payment may carry, in the same unit. Always 0 on Solana.
    pub max_fee: U128,
    pub interval_ns: U64,
    /// The first payment falls due here; one more every `interval_ns` after.
    pub first_due_ns: U64,
    /// How many payments in all. None: until the giver stops it.
    pub max_payments: Option<u32>,
    /// Whether the giver may stop the payments, take the vault back or withdraw before the end.
    pub cancellable: bool,
    /// Payments Bearer has signed.
    pub payments: u32,
    /// Requests this contract has made of Bearer for the vault, so the next one's index in
    /// Bearer's withdrawal log. A vault arrives sealed with none, and only its owner can add one.
    pub withdrawals: u32,
    /// Whether the first payment (or a refused one's batch) has broken the seal.
    pub opened: bool,
    pub stopped_at_ns: Option<U64>,
    pub planned_at_ns: U64,
    /// Taken from the giver's balance here; paid back if the vault goes back to them.
    pub deposit: NearToken,
    pub state: PlanState,
}

#[near(serializers = [json])]
pub struct StandingConfig {
    pub nft_contract: AccountId,
    pub plan_deposit: NearToken,
    pub min_interval_ns: U64,
    pub max_btc_inputs: u32,
}

#[near(serializers = [json])]
struct PlanMsg {
    payee: AccountId,
    chain: Chain,
    to: String,
    chain_id: Option<U64>,
    amount: U128,
    max_fee: U128,
    interval_ns: U64,
    first_due_ns: U64,
    max_payments: Option<u32>,
    cancellable: bool,
}

/* ---------- Bearer's withdrawal parameters, as its `withdraw_*` methods take them ---------- */

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct BtcInput {
    pub txid: String,
    pub vout: u32,
    pub value_sat: U64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct BtcParams {
    pub inputs: Vec<BtcInput>,
    pub to_address: String,
    pub amount_sat: U64,
    pub fee_sat: U64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct EvmParams {
    pub chain_id: U64,
    pub nonce: U64,
    pub to: String,
    pub amount_wei: U128,
    pub gas_limit: U64,
    pub max_fee_per_gas: U128,
    pub max_priority_fee_per_gas: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct SolParams {
    pub recent_blockhash: String,
    pub to: String,
    pub lamports: U64,
}

/// A full withdrawal, for the giver once the plan no longer binds them.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
#[serde(tag = "chain", rename_all = "snake_case")]
pub enum Withdrawal {
    Btc(BtcParams),
    Evm(EvmParams),
    Sol(SolParams),
}

/// What the payee chooses for a payment. The address, the amount and the EVM chain come from
/// the plan, so the payee can't get them wrong or change them (P3).
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
#[serde(tag = "chain", rename_all = "snake_case")]
pub enum Collect {
    /// Coins at the vault's own address; change goes back to it.
    Btc { inputs: Vec<BtcInput>, fee_sat: U64 },
    Evm {
        nonce: U64,
        gas_limit: U64,
        max_fee_per_gas: U128,
        max_priority_fee_per_gas: U128,
    },
    Sol { recent_blockhash: String },
}

/// The parts of a record in Bearer's `withdrawals` view that settlement reads.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct RecordView {
    pub index: u32,
    pub status: String,
    pub error: Option<String>,
}

/// The parts of Bearer's `vault` view that `return_unplanned` reads.
#[near(serializers = [json])]
struct VaultSummary {
    owner_id: AccountId,
    custody: Vec<CustodyEntry>,
}

#[near(serializers = [json])]
struct CustodyEntry {
    account_id: AccountId,
}

/* ---------- pure rules, unit-tested without a chain ---------- */

/// Payments that have fallen due by `now`, counting the ones already collected.
pub fn fallen_due(p: &Plan, now: u64) -> u32 {
    if now < p.first_due_ns.0 {
        return 0;
    }
    let n = (now - p.first_due_ns.0) / p.interval_ns.0.max(1) + 1;
    let n = u32::try_from(n).unwrap_or(u32::MAX);
    match p.max_payments {
        Some(max) => n.min(max),
        None => n,
    }
}

/// Whether the plan is over: stopped, every payment collected, or a whole period past the last
/// one's due date. A payment not collected by then lapses.
pub fn ended(p: &Plan, now: u64) -> bool {
    if p.stopped_at_ns.is_some() {
        return true;
    }
    match p.max_payments {
        Some(max) => {
            p.payments >= max
                || now
                    >= p
                        .first_due_ns
                        .0
                        .saturating_add(p.interval_ns.0.saturating_mul(u64::from(max)))
        }
        None => false,
    }
}

/// Payments the payee may collect now.
pub fn owed_at(p: &Plan, now: u64) -> u32 {
    if ended(p, now) {
        0
    } else {
        fallen_due(p, now).saturating_sub(p.payments)
    }
}

/// Whether the giver may take the vault back or withdraw from it now (P5).
pub fn giver_free(p: &Plan, now: u64) -> bool {
    p.cancellable || ended(p, now)
}

/// When the next payment falls due, if there is one.
pub fn next_due_ns(p: &Plan, now: u64) -> Option<u64> {
    if ended(p, now) {
        return None;
    }
    Some(
        p.first_due_ns
            .0
            .saturating_add(p.interval_ns.0.saturating_mul(u64::from(p.payments))),
    )
}

/// What Bearer did with a request, from the record at the index this contract expected.
#[derive(Debug, PartialEq)]
pub enum Outcome {
    /// Signed: anyone can broadcast it. A payment counts.
    Signed { index: u32 },
    /// Recorded but not signed (the signer failed): nothing counts, the index is used.
    NotSigned { index: u32, error: Option<String> },
    /// Refused outright: nothing recorded, the seal unbroken, the deposit back here.
    Refused,
}

pub fn outcome(expected_index: u32, records: &[RecordView]) -> Outcome {
    match records.iter().find(|r| r.index == expected_index) {
        None => Outcome::Refused,
        Some(r) if r.status == "signed" => Outcome::Signed { index: r.index },
        Some(r) => Outcome::NotSigned {
            index: r.index,
            error: r.error.clone().or_else(|| Some(r.status.clone())),
        },
    }
}

/// Turns the payee's choices into the exact withdrawal the plan allows, or says why not (P3).
pub fn payment(p: &Plan, c: &Collect) -> Result<Withdrawal, &'static str> {
    let amount = p.amount.0;
    match (p.chain, c) {
        (Chain::Btc, Collect::Btc { inputs, fee_sat }) => {
            if inputs.is_empty() {
                return Err("ERR_NO_INPUTS");
            }
            if inputs.len() > MAX_BTC_INPUTS {
                return Err("ERR_TOO_MANY_INPUTS");
            }
            if u128::from(fee_sat.0) > p.max_fee.0 {
                return Err("ERR_FEE_TOO_HIGH");
            }
            Ok(Withdrawal::Btc(BtcParams {
                inputs: inputs.clone(),
                to_address: p.to.clone(),
                amount_sat: U64(u64::try_from(amount).map_err(|_| "ERR_AMOUNT")?),
                fee_sat: *fee_sat,
            }))
        }
        (
            Chain::Evm,
            Collect::Evm {
                nonce,
                gas_limit,
                max_fee_per_gas,
                max_priority_fee_per_gas,
            },
        ) => {
            if max_priority_fee_per_gas.0 > max_fee_per_gas.0 {
                return Err("ERR_PRIORITY_FEE");
            }
            let fee = u128::from(gas_limit.0)
                .checked_mul(max_fee_per_gas.0)
                .ok_or("ERR_FEE_TOO_HIGH")?;
            if fee > p.max_fee.0 {
                return Err("ERR_FEE_TOO_HIGH");
            }
            Ok(Withdrawal::Evm(EvmParams {
                chain_id: p.chain_id.ok_or("ERR_CHAIN_ID")?,
                nonce: *nonce,
                to: p.to.clone(),
                amount_wei: p.amount,
                gas_limit: *gas_limit,
                max_fee_per_gas: *max_fee_per_gas,
                max_priority_fee_per_gas: *max_priority_fee_per_gas,
            }))
        }
        (Chain::Sol, Collect::Sol { recent_blockhash }) => Ok(Withdrawal::Sol(SolParams {
            recent_blockhash: recent_blockhash.clone(),
            to: p.to.clone(),
            lamports: U64(u64::try_from(amount).map_err(|_| "ERR_AMOUNT")?),
        })),
        _ => Err("ERR_WRONG_CHAIN"),
    }
}

/// Bearer's method and the gas it needs for a withdrawal.
pub fn bearer_call(w: &Withdrawal) -> (&'static str, Gas) {
    match w {
        Withdrawal::Btc(b) => (
            "withdraw_btc",
            Gas::from_tgas(TGAS_PER_SIGNATURE * b.inputs.len() as u64 + TGAS_BTC_FIXED),
        ),
        Withdrawal::Evm(_) => ("withdraw_evm", Gas::from_tgas(TGAS_PER_SIGNATURE + TGAS_EVM_FIXED)),
        Withdrawal::Sol(_) => ("withdraw_sol", Gas::from_tgas(TGAS_PER_SIGNATURE + TGAS_SOL_FIXED)),
    }
}

fn params_json(w: &Withdrawal) -> Value {
    match w {
        Withdrawal::Btc(b) => json!(b),
        Withdrawal::Evm(e) => json!(e),
        Withdrawal::Sol(s) => json!(s),
    }
}

fn is_base58(s: &str) -> bool {
    s.bytes()
        .all(|b| b.is_ascii_alphanumeric() && !matches!(b, b'0' | b'O' | b'I' | b'l'))
}

/// Checks the address for the chain and returns it as stored (EVM in lower case). Bearer checks
/// it fully when it builds each payment; this catches the plain mistakes at planning (P8).
pub fn checked_address(chain: Chain, to: &str) -> Result<String, &'static str> {
    if to.is_empty() || to.len() > MAX_ADDRESS_LEN {
        return Err("ERR_BAD_ADDRESS");
    }
    match chain {
        Chain::Btc => {
            let ok = to.len() >= 14
                && to.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit());
            if ok {
                Ok(to.to_string())
            } else {
                Err("ERR_BAD_ADDRESS")
            }
        }
        Chain::Evm => {
            let hex = to.strip_prefix("0x").ok_or("ERR_BAD_ADDRESS")?;
            if hex.len() == 40 && hex.bytes().all(|b| b.is_ascii_hexdigit()) {
                Ok(format!("0x{}", hex.to_ascii_lowercase()))
            } else {
                Err("ERR_BAD_ADDRESS")
            }
        }
        Chain::Sol => {
            if (32..=44).contains(&to.len()) && is_base58(to) {
                Ok(to.to_string())
            } else {
                Err("ERR_BAD_ADDRESS")
            }
        }
    }
}

/// NEP-297 event under this contract's own standard.
fn emit(event: &str, data: Value) {
    let payload = json!({
        "standard": "bearer_standing",
        "version": "1.0.0",
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{payload}"));
}

// Implements the receiving side of NEP-171 and emits NEP-297 events.
#[near(
    contract_state,
    contract_metadata(standard(standard = "nep297", version = "1.0.0"))
)]
#[derive(PanicOnDefault)]
pub struct StandingPayments {
    nft_contract: AccountId,
    plan_deposit: NearToken,
    plans: UnorderedMap<TokenId, Plan>,
    /// Plan balances not held by a plan, per giver (P9).
    deposits: LookupMap<AccountId, NearToken>,
    /// Refunds that bounced, per account.
    claimable: LookupMap<AccountId, NearToken>,
}

#[near]
impl StandingPayments {
    /// No owner, admin or upgrade methods exist (P12). Both settings are fixed here.
    #[init]
    pub fn new(nft_contract: AccountId, plan_deposit: NearToken) -> Self {
        require!(!plan_deposit.is_zero(), "ERR_CONFIG");
        Self {
            nft_contract,
            plan_deposit,
            plans: UnorderedMap::new(StorageKey::Plans),
            deposits: LookupMap::new(StorageKey::Deposits),
            claimable: LookupMap::new(StorageKey::Claimable),
        }
    }

    /// Pays for plans ahead of time: each holds `plan_deposit` from this balance (P9). Planning
    /// can't carry the deposit itself: `nft_transfer_call` forwards exactly 1 yoctoNEAR.
    #[payable]
    pub fn deposit_for_plan(&mut self) -> NearToken {
        require!(env::attached_deposit() >= self.plan_deposit, "ERR_DEPOSIT");
        let account = env::predecessor_account_id();
        let balance = self
            .deposit_of(account.clone())
            .saturating_add(env::attached_deposit());
        self.deposits.insert(&account, &balance);
        balance
    }

    /// Returns the caller's plan balance that no plan holds.
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

    /// The payee collects one payment that has fallen due. The address, amount and EVM chain come
    /// from the plan; the payee chooses only the coins to spend (Bitcoin), the nonce and gas (EVM)
    /// or the blockhash (Solana), with the fee capped by the plan (P3). Attach what Bearer's
    /// `withdraw_*` needs (its `withdraw_deposit + mpc_sign_deposit` per signature), plus 1
    /// yoctoNEAR for the seal before the first payment; a refused request gives it all back.
    /// Fails: `ERR_NOT_PLANNED`, `ERR_NOT_PAYEE`, `ERR_IN_PROGRESS`, `ERR_WRONG_CHAIN`,
    /// `ERR_NO_INPUTS`, `ERR_TOO_MANY_INPUTS`, `ERR_FEE_TOO_HIGH`, `ERR_PRIORITY_FEE`, `ERR_ENDED`,
    /// `ERR_NOT_DUE`, `ERR_DEPOSIT`, `ERR_GAS`.
    #[payable]
    pub fn collect(&mut self, token_id: TokenId, params: Collect) -> Promise {
        let mut p = self.plan_or_panic(&token_id);
        let caller = env::predecessor_account_id();
        require!(caller == p.payee, "ERR_NOT_PAYEE");
        require!(p.state == PlanState::Waiting, "ERR_IN_PROGRESS");
        let w = payment(&p, &params).unwrap_or_else(|e| env::panic_str(e));
        let now = env::block_timestamp();
        require!(!ended(&p, now), "ERR_ENDED");
        require!(owed_at(&p, now) >= 1, "ERR_NOT_DUE");
        let attached = env::attached_deposit();
        let seal = if p.opened { 0 } else { 1 };
        require!(attached.as_yoctonear() > seal, "ERR_DEPOSIT");
        self.check_gas(&w, !p.opened);
        p.state = PlanState::Paying {
            caller,
            attached,
        };
        let open_first = !p.opened;
        let index = p.withdrawals;
        self.plans.insert(&token_id, &p);
        self.request(token_id, index, w, attached, open_first)
    }

    /// The giver withdraws from the vault: any amount, anywhere, on any chain, once the vault is
    /// opened and the plan doesn't bind them (cancellable, or over). Attach what Bearer's
    /// `withdraw_*` needs. A sealed vault is taken back with `take_back` instead (P5, P6).
    /// Fails: `ERR_NOT_PLANNED`, `ERR_NOT_GIVER`, `ERR_IN_PROGRESS`, `ERR_VAULT_SEALED`,
    /// `ERR_PLAN_BINDING`, `ERR_TOO_MANY_INPUTS`, `ERR_DEPOSIT`, `ERR_GAS`.
    #[payable]
    pub fn withdraw(&mut self, token_id: TokenId, params: Withdrawal) -> Promise {
        let mut p = self.plan_or_panic(&token_id);
        let caller = env::predecessor_account_id();
        require!(caller == p.giver, "ERR_NOT_GIVER");
        require!(p.state == PlanState::Waiting, "ERR_IN_PROGRESS");
        require!(p.opened, "ERR_VAULT_SEALED");
        require!(giver_free(&p, env::block_timestamp()), "ERR_PLAN_BINDING");
        if let Withdrawal::Btc(b) = &params {
            require!(b.inputs.len() <= MAX_BTC_INPUTS, "ERR_TOO_MANY_INPUTS");
        }
        let attached = env::attached_deposit();
        require!(!attached.is_zero(), "ERR_DEPOSIT");
        self.check_gas(&params, false);
        p.state = PlanState::Withdrawing {
            caller,
            attached,
        };
        let index = p.withdrawals;
        self.plans.insert(&token_id, &p);
        self.request(token_id, index, params, attached, false)
    }

    /// The giver stops the payments for good, if the plan is cancellable. Nothing more falls due;
    /// a payment already with Bearer still settles. Attach 1 yoctoNEAR.
    /// Fails: `ERR_NOT_PLANNED`, `ERR_NOT_GIVER`, `ERR_NOT_CANCELLABLE`, `ERR_ENDED`.
    #[payable]
    pub fn stop(&mut self, token_id: TokenId) {
        assert_one_yocto();
        let mut p = self.plan_or_panic(&token_id);
        require!(env::predecessor_account_id() == p.giver, "ERR_NOT_GIVER");
        require!(p.cancellable, "ERR_NOT_CANCELLABLE");
        let now = env::block_timestamp();
        require!(!ended(&p, now), "ERR_ENDED");
        p.stopped_at_ns = Some(U64(now));
        emit(
            "stopped",
            json!({ "token_id": token_id, "giver": p.giver, "payments": p.payments }),
        );
        self.plans.insert(&token_id, &p);
    }

    /// The giver takes a still-sealed vault back, ending the plan and getting the deposit back:
    /// any time if it's cancellable, otherwise once it's over (P6). Attach 1 yoctoNEAR.
    /// Fails: `ERR_NOT_PLANNED`, `ERR_NOT_GIVER`, `ERR_IN_PROGRESS`, `ERR_VAULT_OPENED`,
    /// `ERR_PLAN_BINDING`, `ERR_GAS`.
    #[payable]
    pub fn take_back(&mut self, token_id: TokenId) -> Promise {
        assert_one_yocto();
        let mut p = self.plan_or_panic(&token_id);
        require!(env::predecessor_account_id() == p.giver, "ERR_NOT_GIVER");
        require!(p.state == PlanState::Waiting, "ERR_IN_PROGRESS");
        require!(!p.opened, "ERR_VAULT_OPENED");
        require!(giver_free(&p, env::block_timestamp()), "ERR_PLAN_BINDING");
        require!(env::prepaid_gas() >= GAS_FOR_TAKE_BACK, "ERR_GAS");
        p.state = PlanState::Returning;
        self.plans.insert(&token_id, &p);
        let giver = p.giver.clone();
        self.move_vault(token_id, giver)
    }

    /// Reads Bearer's record again for a request whose settlement couldn't read it (P4). Anyone
    /// may call it; it only works while the plan is `Unsettled`, when Bearer's answer is final.
    /// Fails: `ERR_NOT_PLANNED`, `ERR_NOT_UNSETTLED`, `ERR_GAS`.
    pub fn recheck(&mut self, token_id: TokenId) -> Promise {
        let mut p = self.plan_or_panic(&token_id);
        let PlanState::Unsettled {
            caller,
            attached,
            paying,
        } = p.state.clone()
        else {
            env::panic_str("ERR_NOT_UNSETTLED")
        };
        require!(env::prepaid_gas() >= GAS_FOR_RECHECK, "ERR_GAS");
        p.state = if paying {
            PlanState::Paying { caller, attached }
        } else {
            PlanState::Withdrawing { caller, attached }
        };
        let index = p.withdrawals;
        self.plans.insert(&token_id, &p);
        self.read_record(&token_id, index).then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_FOR_ON_SETTLED)
                .on_settled(token_id),
        )
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

    /// Sends back a vault that arrived by plain `nft_transfer` and so has no plan (P10). It goes
    /// to whoever held it before this contract, read from the vault's custody log. Anyone may
    /// call this; it does nothing for a planned vault or one this contract doesn't hold.
    pub fn return_unplanned(&mut self, token_id: TokenId) -> Promise {
        require!(self.plans.get(&token_id).is_none(), "ERR_PLANNED");
        require!(env::prepaid_gas() >= GAS_FOR_RETURN_UNPLANNED, "ERR_GAS");
        Promise::new(self.nft_contract.clone())
            .function_call(
                "vault".to_string(),
                serde_json::to_vec(&json!({ "token_id": token_id })).unwrap_or_default(),
                NearToken::from_yoctonear(0),
                GAS_FOR_VAULT_VIEW,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_ON_UNPLANNED_READ)
                    .on_unplanned_read(token_id),
            )
    }

    /// Never panics (P4): settles a request from Bearer's own record at the index this contract
    /// expected. Signed counts; recorded-but-unsigned uses the index and counts nothing; no
    /// record means Bearer refused it, and the deposit that came back goes to the caller.
    #[private]
    pub fn on_settled(&mut self, token_id: TokenId) {
        let Some(mut p) = self.plans.get(&token_id) else {
            return;
        };
        let (caller, attached, paying) = match &p.state {
            PlanState::Paying { caller, attached } => (caller.clone(), *attached, true),
            PlanState::Withdrawing { caller, attached } => (caller.clone(), *attached, false),
            _ => return,
        };
        let records = env::promise_result_checked(0, MAX_WITHDRAWALS_VIEW)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Vec<RecordView>>(&bytes).ok());
        let Some(records) = records else {
            p.state = PlanState::Unsettled {
                caller,
                attached,
                paying,
            };
            self.plans.insert(&token_id, &p);
            emit("unsettled", json!({ "token_id": token_id }));
            return;
        };
        match outcome(p.withdrawals, &records) {
            Outcome::Signed { index } => {
                p.withdrawals = index + 1;
                p.opened = true;
                if paying {
                    p.payments += 1;
                    emit(
                        "paid",
                        json!({ "token_id": token_id, "payee": p.payee, "chain": p.chain, "to": p.to, "amount": p.amount, "index": index, "payment": p.payments }),
                    );
                } else {
                    emit(
                        "withdrawn",
                        json!({ "token_id": token_id, "giver": p.giver, "index": index }),
                    );
                }
            }
            Outcome::NotSigned { index, error } => {
                p.withdrawals = index + 1;
                p.opened = true;
                let event = if paying { "payment_failed" } else { "withdrawal_failed" };
                emit(event, json!({ "token_id": token_id, "index": index, "error": error }));
            }
            Outcome::Refused => {
                let event = if paying { "payment_refused" } else { "withdrawal_refused" };
                emit(event, json!({ "token_id": token_id, "by": caller }));
                self.pay(caller, attached).detach();
            }
        }
        p.state = PlanState::Waiting;
        self.plans.insert(&token_id, &p);
    }

    /// Never panics: whatever happened to the vault, the plan ends in a known state.
    #[private]
    pub fn on_vault_moved(&mut self, token_id: TokenId) {
        let Some(p) = self.plans.get(&token_id) else {
            return;
        };
        if p.state != PlanState::Returning {
            return;
        }
        if env::promise_result_checked(0, 64).is_ok() {
            self.plans.remove(&token_id);
            emit(
                "taken_back",
                json!({ "token_id": token_id, "giver": p.giver, "payments": p.payments }),
            );
            self.pay(p.giver.clone(), p.deposit).detach();
        } else {
            self.plans.insert(
                &token_id,
                &Plan {
                    state: PlanState::Waiting,
                    ..p
                },
            );
            emit("take_back_failed", json!({ "token_id": token_id }));
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

    /// Second half of `return_unplanned`. Never panics.
    #[private]
    pub fn on_unplanned_read(&mut self, token_id: TokenId) {
        if self.plans.get(&token_id).is_some() {
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
                serde_json::to_vec(&json!({ "receiver_id": to, "token_id": token_id, "memo": "bearer standing: never planned" }))
                    .unwrap_or_default(),
                ONE_YOCTO,
                GAS_FOR_NFT_TRANSFER,
            )
            .detach();
    }

    /* ---------- views ---------- */

    pub fn plans(&self, from_index: Option<u64>, limit: Option<u64>) -> Vec<Plan> {
        self.plans
            .values()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50).min(100) as usize)
            .collect()
    }

    pub fn plan(&self, token_id: TokenId) -> Option<Plan> {
        self.plans.get(&token_id)
    }

    pub fn plan_count(&self) -> u64 {
        self.plans.len()
    }

    /// Payments the payee may collect right now.
    pub fn owed(&self, token_id: TokenId) -> u32 {
        self.plans
            .get(&token_id)
            .map(|p| owed_at(&p, env::block_timestamp()))
            .unwrap_or(0)
    }

    /// When the next payment falls due (it may already have), or None once the plan is over.
    pub fn next_due(&self, token_id: TokenId) -> Option<U64> {
        self.plans
            .get(&token_id)
            .and_then(|p| next_due_ns(&p, env::block_timestamp()))
            .map(U64)
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

    pub fn get_config(&self) -> StandingConfig {
        StandingConfig {
            nft_contract: self.nft_contract.clone(),
            plan_deposit: self.plan_deposit,
            min_interval_ns: U64(MIN_INTERVAL_NS),
            max_btc_inputs: MAX_BTC_INPUTS as u32,
        }
    }
}

#[near]
impl NonFungibleTokenReceiver for StandingPayments {
    /// Plans a vault the Bearer contract just moved here. `msg` is
    /// `{"payee","chain":"btc"|"evm"|"sol","to","chain_id"?,"amount","max_fee","interval_ns",
    /// "first_due_ns","max_payments"?,"cancellable"}`. A first due date in the past means now. Any
    /// panic sends the vault straight back to the giver (NEP-171 resolve).
    /// Fails: `ERR_WRONG_NFT_CONTRACT` (P1), `ERR_NO_APPROVALS`, `ERR_BAD_MSG`, `ERR_PAYEE`,
    /// `ERR_BAD_ADDRESS`, `ERR_CHAIN_ID`, `ERR_AMOUNT`, `ERR_FEE`, `ERR_INTERVAL`,
    /// `ERR_DATE_TOO_FAR`, `ERR_MAX_PAYMENTS`, `ERR_IRREVOCABLE_NEEDS_AN_END`,
    /// `ERR_ALREADY_PLANNED`, `ERR_NO_PLAN_DEPOSIT`, `ERR_PLAN_DEPOSIT_BELOW_STORAGE`.
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
        let m: PlanMsg =
            serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("ERR_BAD_MSG"));
        let giver = previous_owner_id;
        require!(
            m.payee != giver && m.payee != env::current_account_id() && m.payee != self.nft_contract,
            "ERR_PAYEE"
        );
        let to = checked_address(m.chain, &m.to).unwrap_or_else(|e| env::panic_str(e));
        require!(
            m.chain_id.is_some() == (m.chain == Chain::Evm),
            "ERR_CHAIN_ID"
        );
        require!(m.amount.0 > 0, "ERR_AMOUNT");
        if m.chain != Chain::Evm {
            require!(m.amount.0 <= u128::from(u64::MAX), "ERR_AMOUNT");
        }
        match m.chain {
            Chain::Sol => require!(m.max_fee.0 == 0, "ERR_FEE"),
            Chain::Btc => require!(
                m.max_fee.0 > 0 && m.max_fee.0 <= u128::from(u64::MAX),
                "ERR_FEE"
            ),
            Chain::Evm => require!(m.max_fee.0 > 0, "ERR_FEE"),
        }
        require!(
            (MIN_INTERVAL_NS..=MAX_INTERVAL_NS).contains(&m.interval_ns.0),
            "ERR_INTERVAL"
        );
        let now = env::block_timestamp();
        let first_due = m.first_due_ns.0.max(now);
        require!(
            first_due <= now.saturating_add(MAX_LEAD_NS),
            "ERR_DATE_TOO_FAR"
        );
        if let Some(max) = m.max_payments {
            require!((1..=MAX_PAYMENTS).contains(&max), "ERR_MAX_PAYMENTS");
        }
        require!(
            m.cancellable || m.max_payments.is_some(),
            "ERR_IRREVOCABLE_NEEDS_AN_END"
        );
        require!(self.plans.get(&token_id).is_none(), "ERR_ALREADY_PLANNED");

        let balance = self.deposit_of(giver.clone());
        require!(balance >= self.plan_deposit, "ERR_NO_PLAN_DEPOSIT");
        let rest = balance.saturating_sub(self.plan_deposit);
        if rest.is_zero() {
            self.deposits.remove(&giver);
        } else {
            self.deposits.insert(&giver, &rest);
        }

        let before = env::storage_usage();
        let plan = Plan {
            token_id: token_id.clone(),
            giver: giver.clone(),
            payee: m.payee.clone(),
            chain: m.chain,
            to: to.clone(),
            chain_id: m.chain_id,
            amount: m.amount,
            max_fee: m.max_fee,
            interval_ns: m.interval_ns,
            first_due_ns: U64(first_due),
            max_payments: m.max_payments,
            cancellable: m.cancellable,
            payments: 0,
            withdrawals: 0,
            opened: false,
            stopped_at_ns: None,
            planned_at_ns: U64(now),
            deposit: self.plan_deposit,
            state: PlanState::Waiting,
        };
        self.plans.insert(&token_id, &plan);
        // Room for the largest in-flight state too: two account ids and a balance.
        let used = env::storage_usage().saturating_sub(before) + 2 * 64 + 16 + 1;
        require!(
            env::storage_byte_cost().saturating_mul(u128::from(used)) <= self.plan_deposit,
            "ERR_PLAN_DEPOSIT_BELOW_STORAGE"
        );

        emit(
            "planned",
            json!({
                "token_id": token_id, "giver": giver, "payee": m.payee, "chain": m.chain, "to": to,
                "chain_id": m.chain_id, "amount": m.amount, "max_fee": m.max_fee,
                "interval_ns": m.interval_ns, "first_due_ns": U64(first_due),
                "max_payments": m.max_payments, "cancellable": m.cancellable,
            }),
        );
        PromiseOrValue::Value(false)
    }
}

impl StandingPayments {
    fn plan_or_panic(&self, token_id: &TokenId) -> Plan {
        self.plans
            .get(token_id)
            .unwrap_or_else(|| env::panic_str("ERR_NOT_PLANNED"))
    }

    /// Refuses a request that couldn't reach its settlement (P7).
    fn check_gas(&self, w: &Withdrawal, open_first: bool) {
        let (_, bearer_gas) = bearer_call(w);
        let seal = if open_first { GAS_FOR_BREAK_SEAL } else { Gas::from_tgas(0) };
        let needed = GAS_FOR_SELF
            .saturating_add(seal)
            .saturating_add(bearer_gas)
            .saturating_add(GAS_FOR_WITHDRAWALS_VIEW)
            .saturating_add(GAS_FOR_ON_SETTLED);
        require!(env::prepaid_gas() >= needed, "ERR_GAS");
    }

    /// One receipt to Bearer: the seal first, before the first payment, then the withdrawal.
    /// It's a single batch, so a refused withdrawal leaves the seal unbroken too. Then Bearer's
    /// record at `index` is read back and settled.
    fn request(
        &self,
        token_id: TokenId,
        index: u32,
        w: Withdrawal,
        attached: NearToken,
        open_first: bool,
    ) -> Promise {
        let (method, gas) = bearer_call(&w);
        let mut call = Promise::new(self.nft_contract.clone());
        let mut deposit = attached;
        if open_first {
            call = call.function_call(
                "break_seal".to_string(),
                serde_json::to_vec(&json!({ "token_id": token_id })).unwrap_or_default(),
                ONE_YOCTO,
                GAS_FOR_BREAK_SEAL,
            );
            deposit = deposit.saturating_sub(ONE_YOCTO);
        }
        let args = json!({ "token_id": token_id, "params": params_json(&w) });
        call.function_call(
            method.to_string(),
            serde_json::to_vec(&args).unwrap_or_default(),
            deposit,
            gas,
        )
        .then(self.read_record(&token_id, index))
        .then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_FOR_ON_SETTLED)
                .on_settled(token_id),
        )
    }

    fn read_record(&self, token_id: &TokenId, index: u32) -> Promise {
        Promise::new(self.nft_contract.clone()).function_call(
            "withdrawals".to_string(),
            serde_json::to_vec(&json!({ "token_id": token_id, "from_index": index, "limit": 1 }))
                .unwrap_or_default(),
            NearToken::from_yoctonear(0),
            GAS_FOR_WITHDRAWALS_VIEW,
        )
    }

    /// Bearer's own transfer gate checks, in the same receipt that moves the vault, that it is
    /// still sealed and still held here. Settlement waits for its answer.
    fn move_vault(&self, token_id: TokenId, receiver_id: AccountId) -> Promise {
        let args = json!({ "receiver_id": receiver_id, "token_id": token_id, "memo": "bearer standing" });
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
mod tests;
