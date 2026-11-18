use super::*;
use near_sdk::test_utils::{get_logs, testing_env_with_promise_results, VMContextBuilder};
use near_sdk::{testing_env, PromiseResult};

const DEPOSIT: NearToken = NearToken::from_millinear(10);
const NOW: u64 = 1_800_000_000 * SECOND;
const DAY: u64 = 24 * 3600 * SECOND;
const BTC_TO: &str = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx";
const EVM_TO: &str = "0x3FA2b1c47d9e0f5a6b8c2d4e6f80a1b3c519cd00";
const SOL_TO: &str = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
/// What a payee attaches: Bearer's deposit for one signature plus the seal's yoctoNEAR.
const ATTACHED: u128 = 10u128.pow(22) + 2;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(predecessor: &str, deposit: u128, now: u64) -> VMContextBuilder {
    let mut c = VMContextBuilder::new();
    c.current_account_id(acc("standing.test"))
        .predecessor_account_id(acc(predecessor))
        .signer_account_id(acc(predecessor))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .prepaid_gas(Gas::from_tgas(300))
        .block_timestamp(now)
        .account_balance(NearToken::from_near(10));
    c
}

fn contract() -> StandingPayments {
    testing_env!(ctx("deployer.test", 0, NOW).build());
    StandingPayments::new(acc("bearer.test"), DEPOSIT)
}

fn btc_msg(cancellable: bool, max_payments: Option<u32>) -> String {
    json!({
        "payee": "bob.test", "chain": "btc", "to": BTC_TO, "amount": "10000", "max_fee": "1000",
        "interval_ns": U64(DAY), "first_due_ns": U64(NOW), "max_payments": max_payments,
        "cancellable": cancellable,
    })
    .to_string()
}

fn with_deposit(c: &mut StandingPayments, who: &str) {
    testing_env!(ctx(who, DEPOSIT.as_yoctonear(), NOW).build());
    c.deposit_for_plan();
}

/// alice plans vault 1: 10 000 sats a day to bob, from NOW.
fn planned(cancellable: bool, max_payments: Option<u32>) -> StandingPayments {
    let mut c = contract();
    with_deposit(&mut c, "alice.test");
    testing_env!(ctx("bearer.test", 0, NOW).build());
    let _ = c.nft_on_transfer(acc("alice.test"), acc("alice.test"), "1".into(), btc_msg(cancellable, max_payments));
    c
}

fn plan_with(msg: Value) {
    let mut c = contract();
    with_deposit(&mut c, "alice.test");
    testing_env!(ctx("bearer.test", 0, NOW).build());
    let _ = c.nft_on_transfer(acc("alice.test"), acc("alice.test"), "1".into(), msg.to_string());
}

fn inputs(n: usize) -> Vec<BtcInput> {
    (0..n)
        .map(|i| BtcInput { txid: format!("{:064x}", i + 1), vout: 0, value_sat: U64(50_000) })
        .collect()
}

fn btc(fee: u64) -> Collect {
    Collect::Btc { inputs: inputs(1), fee_sat: U64(fee) }
}

fn record(index: u32, status: &str) -> Vec<u8> {
    serde_json::to_vec(&json!([{ "index": index, "status": status, "error": null, "params": {}, "path": "", "payload_hashes": [], "signed_raw_tx": null, "requested_at_ns": "0" }])).unwrap()
}

/// Bob collects at `now`, then Bearer's record at the expected index comes back as `result`.
fn collect_and_settle(c: &mut StandingPayments, now: u64, result: PromiseResult) {
    testing_env!(ctx("bob.test", ATTACHED, now).build());
    let _ = c.collect("1".into(), btc(500));
    testing_env_with_promise_results(ctx("standing.test", 0, now).build(), result);
    c.on_settled("1".into());
}

fn plan_of(c: &StandingPayments) -> Plan {
    c.plan("1".into()).unwrap()
}

fn base_plan() -> Plan {
    Plan {
        token_id: "1".into(),
        giver: acc("alice.test"),
        payee: acc("bob.test"),
        chain: Chain::Btc,
        to: BTC_TO.into(),
        chain_id: None,
        amount: U128(10_000),
        max_fee: U128(1_000),
        interval_ns: U64(DAY),
        first_due_ns: U64(NOW),
        max_payments: Some(3),
        cancellable: false,
        payments: 0,
        withdrawals: 0,
        opened: false,
        stopped_at_ns: None,
        planned_at_ns: U64(NOW),
        deposit: DEPOSIT,
        state: PlanState::Waiting,
    }
}

/* ---------- the rules ---------- */

#[test]
fn payments_fall_due_once_a_period_from_the_first_date() {
    let p = base_plan();
    assert_eq!(fallen_due(&p, NOW - 1), 0);
    assert_eq!(fallen_due(&p, NOW), 1);
    assert_eq!(fallen_due(&p, NOW + DAY - 1), 1);
    assert_eq!(fallen_due(&p, NOW + DAY), 2);
    assert_eq!(fallen_due(&p, NOW + 50 * DAY), 3, "never more than max_payments");
    let open_ended = Plan { max_payments: None, ..base_plan() };
    assert_eq!(fallen_due(&open_ended, NOW + 50 * DAY), 51);
}

#[test]
fn owed_counts_what_is_due_and_not_yet_collected() {
    let p = Plan { payments: 1, ..base_plan() };
    assert_eq!(owed_at(&p, NOW), 0);
    assert_eq!(owed_at(&p, NOW + DAY), 1);
    assert_eq!(owed_at(&p, NOW + 2 * DAY), 2, "missed periods can still be collected");
    assert_eq!(next_due_ns(&p, NOW), Some(NOW + DAY));
}

#[test]
fn a_plan_ends_when_stopped_paid_in_full_or_a_period_after_the_last_due_date() {
    let p = base_plan();
    assert!(!ended(&p, NOW + 3 * DAY - 1));
    assert!(ended(&p, NOW + 3 * DAY), "a payment not collected by then lapses");
    assert_eq!(owed_at(&p, NOW + 3 * DAY), 0);
    assert!(ended(&Plan { payments: 3, ..base_plan() }, NOW));
    assert!(ended(&Plan { stopped_at_ns: Some(U64(NOW)), ..base_plan() }, NOW));
    assert!(!ended(&Plan { max_payments: None, ..base_plan() }, NOW + 1000 * DAY));
    assert_eq!(next_due_ns(&Plan { payments: 3, ..base_plan() }, NOW), None);
}

#[test]
fn an_irrevocable_plan_binds_the_giver_until_it_ends() {
    let p = base_plan();
    assert!(!giver_free(&p, NOW + DAY));
    assert!(giver_free(&p, NOW + 3 * DAY));
    assert!(giver_free(&Plan { cancellable: true, ..base_plan() }, NOW));
}

#[test]
fn a_payment_uses_the_plans_address_amount_and_fee_cap() {
    let p = base_plan();
    let Withdrawal::Btc(b) = payment(&p, &btc(1_000)).unwrap() else { panic!() };
    assert_eq!((b.to_address.as_str(), b.amount_sat.0, b.fee_sat.0), (BTC_TO, 10_000, 1_000));
    assert_eq!(payment(&p, &btc(1_001)), Err("ERR_FEE_TOO_HIGH"));
    assert_eq!(payment(&p, &Collect::Btc { inputs: vec![], fee_sat: U64(1) }), Err("ERR_NO_INPUTS"));
    assert_eq!(
        payment(&p, &Collect::Btc { inputs: inputs(MAX_BTC_INPUTS + 1), fee_sat: U64(1) }),
        Err("ERR_TOO_MANY_INPUTS")
    );
    assert_eq!(payment(&p, &Collect::Sol { recent_blockhash: "x".into() }), Err("ERR_WRONG_CHAIN"));

    let evm = Plan {
        chain: Chain::Evm,
        to: EVM_TO.to_lowercase(),
        chain_id: Some(U64(84532)),
        amount: U128(10u128.pow(15)),
        max_fee: U128(21_000 * 2_000_000_000),
        ..base_plan()
    };
    let gas = |max_fee_per_gas: u128, priority: u128| Collect::Evm {
        nonce: U64(0),
        gas_limit: U64(21_000),
        max_fee_per_gas: U128(max_fee_per_gas),
        max_priority_fee_per_gas: U128(priority),
    };
    let Withdrawal::Evm(e) = payment(&evm, &gas(2_000_000_000, 1)).unwrap() else { panic!() };
    assert_eq!((e.chain_id.0, e.to.as_str(), e.amount_wei.0), (84532, EVM_TO.to_lowercase().as_str(), 10u128.pow(15)));
    assert_eq!(payment(&evm, &gas(2_000_000_001, 1)), Err("ERR_FEE_TOO_HIGH"));
    assert_eq!(payment(&evm, &gas(10, 11)), Err("ERR_PRIORITY_FEE"));
}

#[test]
fn settlement_reads_bearers_record_at_the_expected_index() {
    let r = |index: u32, status: &str| RecordView { index, status: status.into(), error: None };
    assert_eq!(outcome(2, &[r(2, "signed")]), Outcome::Signed { index: 2 });
    assert_eq!(
        outcome(2, &[r(2, "failed")]),
        Outcome::NotSigned { index: 2, error: Some("failed".into()) }
    );
    assert_eq!(outcome(2, &[]), Outcome::Refused);
    assert_eq!(outcome(2, &[r(1, "signed")]), Outcome::Refused, "an older record never counts");
}

#[test]
fn addresses_are_checked_for_their_chain() {
    assert_eq!(checked_address(Chain::Btc, BTC_TO), Ok(BTC_TO.into()));
    assert_eq!(checked_address(Chain::Btc, "TB1QW508"), Err("ERR_BAD_ADDRESS"));
    assert_eq!(checked_address(Chain::Evm, EVM_TO), Ok(EVM_TO.to_lowercase()));
    assert_eq!(checked_address(Chain::Evm, "0x1234"), Err("ERR_BAD_ADDRESS"));
    assert_eq!(checked_address(Chain::Sol, SOL_TO), Ok(SOL_TO.into()));
    assert_eq!(checked_address(Chain::Sol, "0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl"), Err("ERR_BAD_ADDRESS"));
}

/* ---------- planning (P1, P8, P9) ---------- */

#[test]
fn planning_holds_the_deposit_and_records_the_terms() {
    let c = planned(true, None);
    let p = plan_of(&c);
    assert_eq!((p.payee.as_str(), p.amount.0, p.max_fee.0), ("bob.test", 10_000, 1_000));
    assert_eq!((p.payments, p.withdrawals, p.opened), (0, 0, false));
    assert_eq!(p.state, PlanState::Waiting);
    assert!(c.deposit_of(acc("alice.test")).is_zero());
    assert!(get_logs().iter().any(|l| l.contains("\"event\":\"planned\"")));
}

#[test]
#[should_panic(expected = "ERR_WRONG_NFT_CONTRACT")]
fn only_bearer_can_plan() {
    let mut c = contract();
    testing_env!(ctx("fake.test", 0, NOW).build());
    let _ = c.nft_on_transfer(acc("eve.test"), acc("eve.test"), "1".into(), btc_msg(true, None));
}

#[test]
#[should_panic(expected = "ERR_NO_PLAN_DEPOSIT")]
fn planning_needs_a_deposit() {
    let mut c = contract();
    testing_env!(ctx("bearer.test", 0, NOW).build());
    let _ = c.nft_on_transfer(acc("alice.test"), acc("alice.test"), "1".into(), btc_msg(true, None));
}

#[test]
#[should_panic(expected = "ERR_PAYEE")]
fn the_payee_cannot_be_the_giver() {
    plan_with(json!({ "payee": "alice.test", "chain": "btc", "to": BTC_TO, "amount": "1", "max_fee": "1", "interval_ns": U64(DAY), "first_due_ns": U64(NOW), "cancellable": true }));
}

#[test]
#[should_panic(expected = "ERR_INTERVAL")]
fn a_period_is_at_least_a_minute() {
    plan_with(json!({ "payee": "bob.test", "chain": "btc", "to": BTC_TO, "amount": "1", "max_fee": "1", "interval_ns": U64(59 * SECOND), "first_due_ns": U64(NOW), "cancellable": true }));
}

#[test]
#[should_panic(expected = "ERR_IRREVOCABLE_NEEDS_AN_END")]
fn an_irrevocable_plan_needs_a_number_of_payments() {
    plan_with(json!({ "payee": "bob.test", "chain": "btc", "to": BTC_TO, "amount": "1", "max_fee": "1", "interval_ns": U64(DAY), "first_due_ns": U64(NOW), "cancellable": false }));
}

#[test]
#[should_panic(expected = "ERR_CHAIN_ID")]
fn an_evm_plan_names_its_chain() {
    plan_with(json!({ "payee": "bob.test", "chain": "evm", "to": EVM_TO, "amount": "1", "max_fee": "1", "interval_ns": U64(DAY), "first_due_ns": U64(NOW), "cancellable": true }));
}

#[test]
#[should_panic(expected = "ERR_FEE")]
fn a_solana_plan_has_no_fee_cap_to_set() {
    plan_with(json!({ "payee": "bob.test", "chain": "sol", "to": SOL_TO, "amount": "1", "max_fee": "5000", "interval_ns": U64(DAY), "first_due_ns": U64(NOW), "cancellable": true }));
}

#[test]
#[should_panic(expected = "ERR_BAD_ADDRESS")]
fn a_bad_address_is_refused_at_planning() {
    plan_with(json!({ "payee": "bob.test", "chain": "evm", "to": "0xnothex", "chain_id": "84532", "amount": "1", "max_fee": "1", "interval_ns": U64(DAY), "first_due_ns": U64(NOW), "cancellable": true }));
}

#[test]
fn a_first_due_date_in_the_past_means_now() {
    let mut c = contract();
    with_deposit(&mut c, "alice.test");
    testing_env!(ctx("bearer.test", 0, NOW).build());
    let msg = json!({ "payee": "bob.test", "chain": "btc", "to": BTC_TO, "amount": "1", "max_fee": "1", "interval_ns": U64(DAY), "first_due_ns": U64(NOW - 30 * DAY), "cancellable": true });
    let _ = c.nft_on_transfer(acc("alice.test"), acc("alice.test"), "1".into(), msg.to_string());
    assert_eq!(plan_of(&c).first_due_ns, U64(NOW));
    assert_eq!(c.owed("1".into()), 1, "not thirty payments at once");
}

/* ---------- collecting (P2, P3, P4, P7) ---------- */

#[test]
#[should_panic(expected = "ERR_NOT_PAYEE")]
fn only_the_payee_collects() {
    let mut c = planned(true, None);
    testing_env!(ctx("eve.test", ATTACHED, NOW).build());
    let _ = c.collect("1".into(), btc(500));
}

#[test]
#[should_panic(expected = "ERR_NOT_DUE")]
fn nothing_can_be_collected_before_the_first_due_date() {
    let mut c = planned(true, None);
    testing_env!(ctx("bob.test", ATTACHED, NOW - 1).build());
    let _ = c.collect("1".into(), btc(500));
}

#[test]
#[should_panic(expected = "ERR_FEE_TOO_HIGH")]
fn the_fee_is_capped_by_the_plan() {
    let mut c = planned(true, None);
    testing_env!(ctx("bob.test", ATTACHED, NOW).build());
    let _ = c.collect("1".into(), btc(1_001));
}

#[test]
#[should_panic(expected = "ERR_GAS")]
fn a_payment_needs_gas_for_its_whole_settlement() {
    let mut c = planned(true, None);
    let mut low = ctx("bob.test", ATTACHED, NOW);
    low.prepaid_gas(Gas::from_tgas(100));
    testing_env!(low.build());
    let _ = c.collect("1".into(), btc(500));
}

#[test]
#[should_panic(expected = "ERR_IN_PROGRESS")]
fn one_request_at_a_time() {
    let mut c = planned(true, None);
    testing_env!(ctx("bob.test", ATTACHED, NOW + 5 * DAY).build());
    let _ = c.collect("1".into(), btc(500));
    let _ = c.collect("1".into(), btc(500));
}

#[test]
fn a_signed_payment_counts_and_opens_the_vault() {
    let mut c = planned(true, None);
    collect_and_settle(&mut c, NOW, PromiseResult::Successful(record(0, "signed")));
    let p = plan_of(&c);
    assert_eq!((p.payments, p.withdrawals, p.opened), (1, 1, true));
    assert_eq!(p.state, PlanState::Waiting);
    assert!(get_logs().iter().any(|l| l.contains("\"event\":\"paid\"")));
    assert_eq!(c.owed("1".into()), 0);
    assert_eq!(c.next_due("1".into()), Some(U64(NOW + DAY)));
}

#[test]
#[should_panic(expected = "ERR_NOT_DUE")]
fn one_payment_per_period() {
    let mut c = planned(true, None);
    collect_and_settle(&mut c, NOW, PromiseResult::Successful(record(0, "signed")));
    testing_env!(ctx("bob.test", ATTACHED, NOW + DAY - 1).build());
    let _ = c.collect("1".into(), btc(500));
}

#[test]
fn the_next_period_pays_again_at_the_next_index() {
    let mut c = planned(true, None);
    collect_and_settle(&mut c, NOW, PromiseResult::Successful(record(0, "signed")));
    collect_and_settle(&mut c, NOW + DAY, PromiseResult::Successful(record(1, "signed")));
    let p = plan_of(&c);
    assert_eq!((p.payments, p.withdrawals), (2, 2));
}

#[test]
fn an_unsigned_payment_counts_nothing_but_uses_the_index() {
    let mut c = planned(true, None);
    collect_and_settle(&mut c, NOW, PromiseResult::Successful(record(0, "failed")));
    let p = plan_of(&c);
    assert_eq!((p.payments, p.withdrawals, p.opened), (0, 1, true));
    assert_eq!(c.owed("1".into()), 1, "the payee can try again");
}

#[test]
fn a_refused_payment_counts_nothing_and_leaves_the_seal() {
    let mut c = planned(true, None);
    collect_and_settle(&mut c, NOW, PromiseResult::Successful(b"[]".to_vec()));
    let p = plan_of(&c);
    assert_eq!((p.payments, p.withdrawals, p.opened), (0, 0, false));
    assert_eq!(p.state, PlanState::Waiting);
    assert!(get_logs().iter().any(|l| l.contains("\"event\":\"payment_refused\"")));
}

#[test]
fn an_unreadable_record_leaves_the_plan_locked_until_rechecked() {
    let mut c = planned(true, None);
    collect_and_settle(&mut c, NOW, PromiseResult::Failed);
    let p = plan_of(&c);
    assert!(matches!(p.state, PlanState::Unsettled { paying: true, .. }));
    assert_eq!(p.payments, 0);

    testing_env!(ctx("carol.test", 0, NOW).build());
    let _ = c.recheck("1".into());
    assert!(matches!(plan_of(&c).state, PlanState::Paying { .. }));
    testing_env_with_promise_results(ctx("standing.test", 0, NOW).build(), PromiseResult::Successful(record(0, "signed")));
    c.on_settled("1".into());
    assert_eq!(plan_of(&c).payments, 1);
}

#[test]
#[should_panic(expected = "ERR_NOT_UNSETTLED")]
fn recheck_cannot_race_a_request_in_flight() {
    let mut c = planned(true, None);
    testing_env!(ctx("bob.test", ATTACHED, NOW).build());
    let _ = c.collect("1".into(), btc(500));
    testing_env!(ctx("carol.test", 0, NOW).build());
    let _ = c.recheck("1".into());
}

/* ---------- the giver (P5, P6) ---------- */

#[test]
#[should_panic(expected = "ERR_ENDED")]
fn a_stopped_plan_pays_nothing_more() {
    let mut c = planned(true, None);
    testing_env!(ctx("alice.test", 1, NOW).build());
    c.stop("1".into());
    testing_env!(ctx("bob.test", ATTACHED, NOW + DAY).build());
    let _ = c.collect("1".into(), btc(500));
}

#[test]
#[should_panic(expected = "ERR_NOT_CANCELLABLE")]
fn an_irrevocable_plan_cannot_be_stopped() {
    let mut c = planned(false, Some(3));
    testing_env!(ctx("alice.test", 1, NOW).build());
    c.stop("1".into());
}

#[test]
#[should_panic(expected = "ERR_NOT_GIVER")]
fn only_the_giver_stops() {
    let mut c = planned(true, None);
    testing_env!(ctx("bob.test", 1, NOW).build());
    c.stop("1".into());
}

#[test]
fn a_sealed_vault_goes_back_to_the_giver_with_the_deposit() {
    let mut c = planned(true, None);
    testing_env!(ctx("alice.test", 1, NOW).build());
    let _ = c.take_back("1".into());
    assert_eq!(plan_of(&c).state, PlanState::Returning);
    testing_env_with_promise_results(ctx("standing.test", 0, NOW).build(), PromiseResult::Successful(vec![]));
    c.on_vault_moved("1".into());
    assert!(c.plan("1".into()).is_none());
}

#[test]
fn a_failed_take_back_keeps_the_plan() {
    let mut c = planned(true, None);
    testing_env!(ctx("alice.test", 1, NOW).build());
    let _ = c.take_back("1".into());
    testing_env_with_promise_results(ctx("standing.test", 0, NOW).build(), PromiseResult::Failed);
    c.on_vault_moved("1".into());
    assert_eq!(plan_of(&c).state, PlanState::Waiting);
}

#[test]
#[should_panic(expected = "ERR_VAULT_OPENED")]
fn an_opened_vault_cannot_be_taken_back() {
    let mut c = planned(true, None);
    collect_and_settle(&mut c, NOW, PromiseResult::Successful(record(0, "signed")));
    testing_env!(ctx("alice.test", 1, NOW).build());
    let _ = c.take_back("1".into());
}

#[test]
#[should_panic(expected = "ERR_PLAN_BINDING")]
fn an_irrevocable_plan_keeps_the_vault_until_it_ends() {
    let mut c = planned(false, Some(3));
    testing_env!(ctx("alice.test", 1, NOW + DAY).build());
    let _ = c.take_back("1".into());
}

#[test]
fn an_irrevocable_plan_that_paid_nothing_gives_the_vault_back_once_over() {
    let mut c = planned(false, Some(3));
    testing_env!(ctx("alice.test", 1, NOW + 3 * DAY).build());
    let _ = c.take_back("1".into());
    assert_eq!(plan_of(&c).state, PlanState::Returning);
}

fn evm_withdrawal() -> Withdrawal {
    Withdrawal::Evm(EvmParams {
        chain_id: U64(84532),
        nonce: U64(1),
        to: EVM_TO.into(),
        amount_wei: U128(1),
        gas_limit: U64(21_000),
        max_fee_per_gas: U128(1),
        max_priority_fee_per_gas: U128(1),
    })
}

#[test]
fn the_giver_withdraws_from_an_opened_cancellable_plan() {
    let mut c = planned(true, None);
    collect_and_settle(&mut c, NOW, PromiseResult::Successful(record(0, "signed")));
    testing_env!(ctx("alice.test", ATTACHED, NOW).build());
    let _ = c.withdraw("1".into(), evm_withdrawal());
    assert!(matches!(plan_of(&c).state, PlanState::Withdrawing { .. }));
    testing_env_with_promise_results(ctx("standing.test", 0, NOW).build(), PromiseResult::Successful(record(1, "signed")));
    c.on_settled("1".into());
    let p = plan_of(&c);
    assert_eq!((p.payments, p.withdrawals), (1, 2), "a withdrawal is not a payment");
}

#[test]
#[should_panic(expected = "ERR_PLAN_BINDING")]
fn an_irrevocable_plan_binds_withdrawals_too() {
    let mut c = planned(false, Some(3));
    collect_and_settle(&mut c, NOW, PromiseResult::Successful(record(0, "signed")));
    testing_env!(ctx("alice.test", ATTACHED, NOW + DAY).build());
    let _ = c.withdraw("1".into(), evm_withdrawal());
}

#[test]
#[should_panic(expected = "ERR_VAULT_SEALED")]
fn a_sealed_vault_is_taken_back_not_withdrawn_from() {
    let mut c = planned(true, None);
    testing_env!(ctx("alice.test", ATTACHED, NOW).build());
    let _ = c.withdraw("1".into(), evm_withdrawal());
}

#[test]
#[should_panic(expected = "ERR_NOT_GIVER")]
fn the_payee_cannot_withdraw() {
    let mut c = planned(true, None);
    collect_and_settle(&mut c, NOW, PromiseResult::Successful(record(0, "signed")));
    testing_env!(ctx("bob.test", ATTACHED, NOW).build());
    let _ = c.withdraw("1".into(), evm_withdrawal());
}
