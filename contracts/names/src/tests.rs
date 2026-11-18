use super::*;
use near_sdk::mock::MockAction;
use near_sdk::test_utils::{get_created_receipts, get_logs, testing_env_with_promise_results, VMContextBuilder};
use near_sdk::{testing_env, PromiseResult};

const NAMES: &str = "names.test";
const RENT: u128 = 10_315_810_000_000_000_000_000;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(predecessor: &str, deposit: u128) -> VMContextBuilder {
    let mut c = VMContextBuilder::new();
    c.current_account_id(acc(NAMES))
        .predecessor_account_id(acc(predecessor))
        .signer_account_id(acc(predecessor))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .prepaid_gas(Gas::from_tgas(300))
        .account_balance(NearToken::from_near(10));
    c
}

fn contract() -> VaultNames {
    testing_env!(ctx("deployer.test", 0).build());
    VaultNames::new(acc("bearer.test"), acc("registry.tla.test"), acc("tla.test"))
}

fn vault_json(owner: &str, state: &str) -> Vec<u8> {
    serde_json::to_vec(&json!({ "token_id": "7", "owner_id": owner, "state": { "kind": state }, "custody": [] })).unwrap()
}

fn lease_json(full_name: &str, owner: &str) -> Vec<u8> {
    serde_json::to_vec(&json!({ "full_name": full_name, "owner": owner, "tla_id": "tla.test", "payout_account": owner, "lifecycle": "Active", "rented_at": "1", "expires_at": "2", "annual_rent": "1000" })).unwrap()
}

/// alice, holding vault 7, asks for `label`; the vault view answers `vault`.
fn asked(label: &str, vault: Vec<u8>) -> VaultNames {
    let mut c = contract();
    testing_env!(ctx("alice.test", RENT).build());
    let _ = c.name_vault("7".into(), label.into());
    testing_env_with_promise_results(ctx(NAMES, 0).build(), PromiseResult::Successful(vault));
    c.on_vault_for_naming("7".into());
    c
}

/// alice names vault 7 "zaras-fund", and the registry records this contract as its owner.
fn named() -> VaultNames {
    let mut c = asked("zaras-fund", vault_json("alice.test", "sealed"));
    testing_env_with_promise_results(ctx(NAMES, 0).build(), PromiseResult::Successful(lease_json("zaras-fund.tla.test", NAMES)));
    c.on_rented("7".into());
    c
}

fn logged(event: &str) -> bool {
    get_logs().iter().any(|l| l.contains(&format!("\"event\":\"{event}\"")))
}

/* ---------- the rules ---------- */

#[test]
fn labels_are_lower_case_letters_digits_and_inner_hyphens() {
    for ok in ["abc", "zaras-fund", "vault-0042", "a1b2c3"] {
        assert!(valid_label(ok), "{ok}");
    }
    for bad in ["ab", "Zara", "zara.fund", "-zara", "zara-", "zara fund", "zara_fund", &"a".repeat(33)] {
        assert!(!valid_label(bad), "{bad}");
    }
}

#[test]
fn only_the_holder_names_and_only_the_holder_of_an_opened_vault_withdraws() {
    let v = |owner: &str, kind: &str| VaultSummary { owner_id: acc(owner), state: VaultState { kind: kind.into() } };
    assert!(may_name(&v("alice.test", "sealed"), &acc("alice.test")));
    assert!(!may_name(&v("bob.test", "sealed"), &acc("alice.test")));
    assert!(may_withdraw(&v("alice.test", "opened"), &acc("alice.test")));
    assert!(!may_withdraw(&v("alice.test", "sealed"), &acc("alice.test")), "a sealed vault can still change hands");
    assert!(!may_withdraw(&v("bob.test", "opened"), &acc("alice.test")));
}

#[test]
fn the_wallet_request_is_house_of_stakes_shape() {
    let r = transfer_request(&acc("alice.test"), U128(1_000));
    assert_eq!(
        r,
        json!({ "request": { "external": [{ "receiver_id": "alice.test", "actions": [{ "action": "transfer", "payload": { "amount": "1000" } }] }] } })
    );
}

/* ---------- naming (N2, N4, N5, N6) ---------- */

#[test]
fn the_holder_names_a_vault_for_good() {
    let c = named();
    assert_eq!(c.name_of("7".into()), Some(acc("zaras-fund.tla.test")));
    assert_eq!(c.vault_of(acc("zaras-fund.tla.test")), Some("7".to_string()));
    assert!(c.pending_of("7".into()).is_none());
    assert!(logged("named"));
}

#[test]
#[should_panic(expected = "ERR_ALREADY_NAMED")]
fn a_vault_is_named_once() {
    let mut c = named();
    testing_env!(ctx("alice.test", RENT).build());
    let _ = c.name_vault("7".into(), "another".into());
}

#[test]
#[should_panic(expected = "ERR_IN_PROGRESS")]
fn one_naming_at_a_time() {
    let mut c = contract();
    testing_env!(ctx("alice.test", RENT).build());
    let _ = c.name_vault("7".into(), "zaras-fund".into());
    let _ = c.name_vault("7".into(), "other-name".into());
}

#[test]
#[should_panic(expected = "ERR_BAD_LABEL")]
fn a_bad_label_is_refused_before_anything_happens() {
    let mut c = contract();
    testing_env!(ctx("alice.test", RENT).build());
    let _ = c.name_vault("7".into(), "Zara.Fund".into());
}

#[test]
#[should_panic(expected = "ERR_GAS")]
fn naming_needs_gas_for_the_whole_rent() {
    let mut c = contract();
    let mut low = ctx("alice.test", RENT);
    low.prepaid_gas(Gas::from_tgas(200));
    testing_env!(low.build());
    let _ = c.name_vault("7".into(), "zaras-fund".into());
}

#[test]
fn someone_who_doesnt_hold_the_vault_gets_their_deposit_back() {
    let c = asked("zaras-fund", vault_json("bob.test", "sealed"));
    assert!(c.pending_of("7".into()).is_none());
    assert!(c.name_of("7".into()).is_none());
    assert!(logged("naming_refused"));
}

#[test]
fn a_vault_that_isnt_there_names_nothing() {
    let mut c = contract();
    testing_env!(ctx("alice.test", RENT).build());
    let _ = c.name_vault("7".into(), "zaras-fund".into());
    testing_env_with_promise_results(ctx(NAMES, 0).build(), PromiseResult::Successful(b"null".to_vec()));
    c.on_vault_for_naming("7".into());
    assert!(c.pending_of("7".into()).is_none());
    assert!(logged("naming_refused"));
}

#[test]
fn a_rent_the_registry_refused_counts_nothing_and_refunds() {
    let mut c = asked("taken-name", vault_json("alice.test", "sealed"));
    testing_env_with_promise_results(ctx(NAMES, 0).build(), PromiseResult::Successful(b"null".to_vec()));
    c.on_rented("7".into());
    assert!(c.name_of("7".into()).is_none());
    assert!(logged("naming_refused"));
}

#[test]
fn a_name_someone_else_owns_isnt_taken_for_this_vault() {
    let mut c = asked("zaras-fund", vault_json("alice.test", "sealed"));
    testing_env_with_promise_results(ctx(NAMES, 0).build(), PromiseResult::Successful(lease_json("zaras-fund.tla.test", "mallory.test")));
    c.on_rented("7".into());
    assert!(c.name_of("7".into()).is_none());
}

#[test]
fn an_unreadable_lease_counts_nothing() {
    let mut c = asked("zaras-fund", vault_json("alice.test", "sealed"));
    testing_env_with_promise_results(ctx(NAMES, 0).build(), PromiseResult::Failed);
    c.on_rented("7".into());
    assert!(c.name_of("7".into()).is_none());
}

/* ---------- withdrawing (N3) ---------- */

#[test]
#[should_panic(expected = "ERR_NOT_NAMED")]
fn an_unnamed_vault_has_nothing_to_withdraw() {
    let mut c = contract();
    testing_env!(ctx("alice.test", 1).build());
    let _ = c.withdraw("7".into(), acc("alice.test"), U128(1));
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn a_withdrawal_takes_exactly_one_yocto() {
    let mut c = named();
    testing_env!(ctx("alice.test", 0).build());
    let _ = c.withdraw("7".into(), acc("alice.test"), U128(1));
}

#[test]
fn the_holder_of_an_opened_vault_withdraws() {
    let mut c = named();
    testing_env!(ctx("alice.test", 1).build());
    let _ = c.withdraw("7".into(), acc("carol.test"), U128(5));
    testing_env_with_promise_results(ctx(NAMES, 0).build(), PromiseResult::Successful(vault_json("alice.test", "opened")));
    c.on_vault_for_withdrawal("7".into(), acc("alice.test"), acc("carol.test"), U128(5));
    assert!(!logged("withdrawal_refused"));
}

#[test]
fn a_sealed_vault_keeps_its_near() {
    let mut c = named();
    testing_env_with_promise_results(ctx(NAMES, 0).build(), PromiseResult::Successful(vault_json("alice.test", "sealed")));
    c.on_vault_for_withdrawal("7".into(), acc("alice.test"), acc("alice.test"), U128(5));
    assert!(logged("withdrawal_refused"));
    assert!(get_logs().iter().any(|l| l.contains("still sealed")));
}

#[test]
fn a_former_holder_cant_withdraw() {
    let mut c = named();
    testing_env_with_promise_results(ctx(NAMES, 0).build(), PromiseResult::Successful(vault_json("bob.test", "opened")));
    c.on_vault_for_withdrawal("7".into(), acc("alice.test"), acc("alice.test"), U128(5));
    assert!(get_logs().iter().any(|l| l.contains("not the vault's holder")));
}

/* ---------- refunds this contract fronts (N7) ---------- */

/// The function calls this execution scheduled, as (receiver, method).
fn calls() -> Vec<(String, String)> {
    get_created_receipts()
        .into_iter()
        .flat_map(|r| {
            let to = r.receiver_id.to_string();
            r.actions.into_iter().filter_map(move |a| match a {
                MockAction::FunctionCallWeight { method_name, .. } => {
                    Some((to.clone(), String::from_utf8(method_name).unwrap()))
                }
                _ => None,
            })
        })
        .collect()
}

#[test]
fn anyone_can_bring_back_what_the_registry_holds_for_the_contract() {
    let mut c = contract();
    testing_env!(ctx("anyone.test", 0).build());
    let _ = c.reclaim();
    assert_eq!(calls(), vec![("registry.tla.test".to_string(), "claim_refund".to_string())]);
}

#[test]
fn a_refused_rent_is_refunded_now() {
    let mut c = asked("taken-name", vault_json("alice.test", "sealed"));
    testing_env_with_promise_results(ctx(NAMES, 0).build(), PromiseResult::Successful(b"null".to_vec()));
    c.on_rented("7".into());
    let paid: Vec<_> = get_created_receipts()
        .into_iter()
        .filter(|r| r.receiver_id == acc("alice.test"))
        .flat_map(|r| r.actions)
        .filter_map(|a| match a {
            MockAction::Transfer { deposit, .. } => Some(deposit.as_yoctonear()),
            _ => None,
        })
        .collect();
    assert_eq!(paid, vec![RENT]);
    assert_eq!(c.claimable_of(acc("alice.test")), NearToken::from_yoctonear(0));
}

#[test]
fn a_refund_the_contract_cant_cover_yet_is_kept_for_claim() {
    let mut c = asked("taken-name", vault_json("alice.test", "sealed"));
    let mut poor = ctx(NAMES, 0);
    poor.account_balance(NearToken::from_yoctonear(1));
    testing_env_with_promise_results(poor.build(), PromiseResult::Successful(b"null".to_vec()));
    c.on_rented("7".into());
    assert!(c.pending_of("7".into()).is_none(), "the vault can be named again");
    assert_eq!(c.claimable_of(acc("alice.test")), NearToken::from_yoctonear(RENT));
    assert!(logged("refund_held"));
}
