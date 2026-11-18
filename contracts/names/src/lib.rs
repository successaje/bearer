//! Bearer vault names: a rented Top Level Account name for a vault, as the vault's own NEAR account.
//!
//! House of Stake's TLA contracts (houseofstake/tla-contracts) rent names under a TLA as real NEAR
//! accounts. A rented account holds no access keys at all; it runs House of Stake's shared wallet,
//! and only its lease owner (an "extension") can make it send anything. This contract rents a name
//! for a vault with itself as that owner, and never hands the lease on, so the account belongs to
//! the vault rather than to any one person (N1).
//!
//! Anyone can send NEAR to a vault's name. Only the vault's holder can take it out, and only once
//! they have opened the vault, the same rule Bearer applies to its Bitcoin, Base and Solana
//! addresses. An opened vault never changes hands (Bearer's invariant I2), so the check made here
//! can't be overtaken by a sale (N3). While the vault is sealed, the name passes on with it,
//! untouched, like everything else inside.
//!
//! No admin, owner or upgrade methods. Threats N1–N9 in docs/THREAT_MODEL.md.
#![allow(deprecated)] // storage-measured collections, as in the Bearer contract

use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::collections::LookupMap;
use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json, Value};
use near_sdk::{
    assert_one_yocto, env, near, require, AccountId, BorshStorageKey, Gas, NearToken,
    PanicOnDefault, Promise,
};

const GAS_FOR_VAULT_VIEW: Gas = Gas::from_tgas(10);
/// The registry reserves 90 Tgas to create the account and 15 for its own callback (d12a84b).
const GAS_FOR_RENT: Gas = Gas::from_tgas(150);
const GAS_FOR_NAME_VIEW: Gas = Gas::from_tgas(10);
const GAS_FOR_ON_RENTED: Gas = Gas::from_tgas(20);
/// Room for the rent, the read-back and its settlement, scheduled from the vault check.
const GAS_FOR_ON_VAULT_FOR_NAMING: Gas = Gas::from_tgas(195);
const GAS_FOR_NAMING: Gas = Gas::from_tgas(230);
const GAS_FOR_EXECUTE: Gas = Gas::from_tgas(30);
const GAS_FOR_ON_WITHDRAWN: Gas = Gas::from_tgas(10);
const GAS_FOR_ON_VAULT_FOR_WITHDRAWAL: Gas = Gas::from_tgas(55);
const GAS_FOR_WITHDRAWAL: Gas = Gas::from_tgas(85);
const GAS_FOR_ON_PAYOUT: Gas = Gas::from_tgas(5);
/// The registry's `claim_refund`: a transfer and a 10 Tgas callback (d12a84b).
const GAS_FOR_RECLAIM: Gas = Gas::from_tgas(25);
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
pub const MIN_LABEL_LEN: usize = 3;
pub const MAX_LABEL_LEN: usize = 32;
const MAX_VIEW: usize = 16 * 1024;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Names,
    Vaults,
    Pending,
    Claimable,
}

/// A naming in flight: the label asked for, who asked, and what they attached for the rent.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Pending {
    pub label: String,
    pub caller: AccountId,
    pub attached: NearToken,
}

#[near(serializers = [json])]
pub struct NamesConfig {
    pub nft_contract: AccountId,
    pub registry: AccountId,
    pub tla: AccountId,
    pub min_label_len: u32,
    pub max_label_len: u32,
}

/// The parts of Bearer's `vault` view this contract reads.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct VaultSummary {
    pub owner_id: AccountId,
    pub state: VaultState,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct VaultState {
    pub kind: String,
}

/// The parts of the registry's `get_sub_account` view this contract reads.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct LeaseSummary {
    pub full_name: String,
    pub owner: AccountId,
}

/// A label the registry will rent and Bearer will show: lower-case letters, digits and inner
/// hyphens, 3 to 32 characters (N6).
pub fn valid_label(label: &str) -> bool {
    let b = label.as_bytes();
    (MIN_LABEL_LEN..=MAX_LABEL_LEN).contains(&b.len())
        && b.iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
        && b[0] != b'-'
        && b[b.len() - 1] != b'-'
}

/// Whether `caller` may name vault `vault`: they hold it now (N2).
pub fn may_name(vault: &VaultSummary, caller: &AccountId) -> bool {
    &vault.owner_id == caller
}

/// Whether `caller` may take NEAR out of the vault's name: they hold it, and it's opened, so it
/// can never change hands again (N3).
pub fn may_withdraw(vault: &VaultSummary, caller: &AccountId) -> bool {
    &vault.owner_id == caller && vault.state.kind == "opened"
}

/// The House of Stake wallet request that sends `amount` of the name's NEAR to `receiver`.
pub fn transfer_request(receiver: &AccountId, amount: U128) -> Value {
    json!({
        "request": {
            "external": [{
                "receiver_id": receiver,
                "actions": [{ "action": "transfer", "payload": { "amount": amount } }],
            }],
        },
    })
}

/// NEP-297 event under this contract's own standard.
fn emit(event: &str, data: Value) {
    let payload = json!({
        "standard": "bearer_names",
        "version": "1.0.0",
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{payload}"));
}

#[near(
    contract_state,
    contract_metadata(standard(standard = "nep297", version = "1.0.0"))
)]
#[derive(PanicOnDefault)]
pub struct VaultNames {
    nft_contract: AccountId,
    registry: AccountId,
    tla: AccountId,
    /// Vault → its name's account. Set once, never changed or removed.
    names: LookupMap<TokenId, AccountId>,
    /// Name's account → vault.
    vaults: LookupMap<AccountId, TokenId>,
    pending: LookupMap<TokenId, Pending>,
    /// Refunds that bounced, per account.
    claimable: LookupMap<AccountId, NearToken>,
}

#[near]
impl VaultNames {
    /// No owner, admin or upgrade methods exist (N9). All three settings are fixed here.
    #[init]
    pub fn new(nft_contract: AccountId, registry: AccountId, tla: AccountId) -> Self {
        let this = env::current_account_id();
        require!(nft_contract != this && registry != this && tla != this, "ERR_CONFIG");
        Self {
            nft_contract,
            registry,
            tla,
            names: LookupMap::new(StorageKey::Names),
            vaults: LookupMap::new(StorageKey::Vaults),
            pending: LookupMap::new(StorageKey::Pending),
            claimable: LookupMap::new(StorageKey::Claimable),
        }
    }

    /// The vault's holder rents `{label}.{tla}` for it. Attach the registry's price
    /// (`get_rent_price(...).total_yocto`); if the name can't be rented, it all comes back. A vault
    /// is named once, for good.
    /// Fails: `ERR_BAD_LABEL`, `ERR_ALREADY_NAMED`, `ERR_IN_PROGRESS`, `ERR_DEPOSIT`, `ERR_GAS`.
    #[payable]
    pub fn name_vault(&mut self, token_id: TokenId, label: String) -> Promise {
        require!(valid_label(&label), "ERR_BAD_LABEL");
        require!(self.names.get(&token_id).is_none(), "ERR_ALREADY_NAMED");
        require!(self.pending.get(&token_id).is_none(), "ERR_IN_PROGRESS");
        let attached = env::attached_deposit();
        require!(!attached.is_zero(), "ERR_DEPOSIT");
        require!(env::prepaid_gas() >= GAS_FOR_NAMING, "ERR_GAS");
        let caller = env::predecessor_account_id();
        self.pending.insert(&token_id, &Pending { label, caller, attached });
        self.read_vault(&token_id).then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_FOR_ON_VAULT_FOR_NAMING)
                .on_vault_for_naming(token_id),
        )
    }

    /// The holder of an opened vault sends `amount` of its name's NEAR to `receiver_id`. Attach
    /// 1 yoctoNEAR. Refused unless the caller holds the vault and has opened it (N3).
    /// Fails: `ERR_NOT_NAMED`, `ERR_AMOUNT`, `ERR_GAS`.
    #[payable]
    pub fn withdraw(&mut self, token_id: TokenId, receiver_id: AccountId, amount: U128) -> Promise {
        assert_one_yocto();
        require!(self.names.get(&token_id).is_some(), "ERR_NOT_NAMED");
        require!(amount.0 > 0, "ERR_AMOUNT");
        require!(env::prepaid_gas() >= GAS_FOR_WITHDRAWAL, "ERR_GAS");
        let caller = env::predecessor_account_id();
        self.read_vault(&token_id).then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_FOR_ON_VAULT_FOR_WITHDRAWAL)
                .on_vault_for_withdrawal(token_id, caller, receiver_id, amount),
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

    /// Brings back what the registry holds for this contract: it never sends refunds straight
    /// back, it records them for `claim_refund`. That's the padding on every rent quote
    /// (`quote_slippage_bps`), and the whole price of a rent whose account couldn't be created,
    /// which this contract has already refunded to its caller (N7). Anyone can call it; the NEAR
    /// can only come here.
    pub fn reclaim(&mut self) -> Promise {
        Promise::new(self.registry.clone()).function_call(
            "claim_refund".to_string(),
            b"{}".to_vec(),
            NearToken::from_yoctonear(0),
            GAS_FOR_RECLAIM,
        )
    }

    /// Never panics: a caller who doesn't hold the vault gets their deposit back; otherwise the
    /// name is rented, read back from the registry and settled.
    #[private]
    pub fn on_vault_for_naming(&mut self, token_id: TokenId) {
        let Some(p) = self.pending.get(&token_id) else {
            return;
        };
        match self.vault_result() {
            Some(v) if may_name(&v, &p.caller) => {
                let args = json!({ "tla_id": self.tla, "name": p.label, "owner_account": null });
                Promise::new(self.registry.clone())
                    .function_call(
                        "rent_sub_account".to_string(),
                        serde_json::to_vec(&args).unwrap_or_default(),
                        p.attached,
                        GAS_FOR_RENT,
                    )
                    .then(
                        Promise::new(self.registry.clone()).function_call(
                            "get_sub_account".to_string(),
                            serde_json::to_vec(&json!({ "tla_id": self.tla, "name": p.label }))
                                .unwrap_or_default(),
                            NearToken::from_yoctonear(0),
                            GAS_FOR_NAME_VIEW,
                        ),
                    )
                    .then(
                        Self::ext(env::current_account_id())
                            .with_static_gas(GAS_FOR_ON_RENTED)
                            .on_rented(token_id),
                    )
                    .detach();
            }
            _ => {
                self.pending.remove(&token_id);
                emit(
                    "naming_refused",
                    json!({ "token_id": token_id, "by": p.caller, "reason": "not the vault's holder" }),
                );
                self.refund(p.caller, p.attached);
            }
        }
    }

    /// Never panics: the name counts only if the registry now records this contract as its
    /// owner. Otherwise the rent was refused and the caller is refunded now, from this contract's
    /// balance: a refused call's deposit comes back here on its own, a failed account creation's
    /// waits at the registry for `reclaim`.
    #[private]
    pub fn on_rented(&mut self, token_id: TokenId) {
        let Some(p) = self.pending.remove(&token_id) else {
            return;
        };
        let account = format!("{}.{}", p.label, self.tla);
        let lease = env::promise_result_checked(0, MAX_VIEW)
            .ok()
            .and_then(|b| serde_json::from_slice::<Option<LeaseSummary>>(&b).ok())
            .flatten();
        let ours = lease
            .as_ref()
            .is_some_and(|l| l.owner == env::current_account_id() && l.full_name == account);
        match account.parse::<AccountId>() {
            Ok(id) if ours && self.vaults.get(&id).is_none() => {
                self.names.insert(&token_id, &id);
                self.vaults.insert(&id, &token_id);
                emit("named", json!({ "token_id": token_id, "account_id": id, "by": p.caller }));
            }
            _ => {
                emit(
                    "naming_refused",
                    json!({ "token_id": token_id, "by": p.caller, "reason": "the registry didn't rent it" }),
                );
                self.refund(p.caller, p.attached);
            }
        }
    }

    /// Never panics: sends the NEAR only for the holder of the opened vault.
    #[private]
    pub fn on_vault_for_withdrawal(
        &mut self,
        token_id: TokenId,
        caller: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) {
        let Some(name) = self.names.get(&token_id) else {
            return;
        };
        match self.vault_result() {
            Some(v) if may_withdraw(&v, &caller) => {
                Promise::new(name.clone())
                    .function_call(
                        "w_execute_extension".to_string(),
                        serde_json::to_vec(&transfer_request(&receiver_id, amount))
                            .unwrap_or_default(),
                        ONE_YOCTO,
                        GAS_FOR_EXECUTE,
                    )
                    .then(
                        Self::ext(env::current_account_id())
                            .with_static_gas(GAS_FOR_ON_WITHDRAWN)
                            .on_withdrawn(token_id, name, caller, receiver_id, amount),
                    )
                    .detach();
            }
            v => {
                let reason = match v {
                    None => "the vault couldn't be read",
                    Some(v) if v.owner_id != caller => "not the vault's holder",
                    Some(_) => "the vault is still sealed",
                };
                emit(
                    "withdrawal_refused",
                    json!({ "token_id": token_id, "by": caller, "reason": reason }),
                );
            }
        }
    }

    #[private]
    pub fn on_withdrawn(
        &mut self,
        token_id: TokenId,
        account_id: AccountId,
        by: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) {
        let event = if env::promise_result_checked(0, 64).is_ok() {
            "withdrawn"
        } else {
            "withdrawal_failed"
        };
        emit(
            event,
            json!({ "token_id": token_id, "account_id": account_id, "by": by, "receiver_id": receiver_id, "amount": amount }),
        );
    }

    /// A refund that bounced (the account no longer exists) is kept for `claim`.
    #[private]
    pub fn on_payout(&mut self, account_id: AccountId, amount: NearToken) {
        if env::promise_result_checked(0, 64).is_ok() {
            return;
        }
        let total = self.claimable_of(account_id.clone()).saturating_add(amount);
        self.claimable.insert(&account_id, &total);
        emit("payout_failed", json!({ "account_id": account_id, "amount": amount }));
    }

    /* ---------- views ---------- */

    pub fn name_of(&self, token_id: TokenId) -> Option<AccountId> {
        self.names.get(&token_id)
    }

    pub fn vault_of(&self, account_id: AccountId) -> Option<TokenId> {
        self.vaults.get(&account_id)
    }

    pub fn pending_of(&self, token_id: TokenId) -> Option<Pending> {
        self.pending.get(&token_id)
    }

    pub fn claimable_of(&self, account_id: AccountId) -> NearToken {
        self.claimable
            .get(&account_id)
            .unwrap_or(NearToken::from_yoctonear(0))
    }

    pub fn get_config(&self) -> NamesConfig {
        NamesConfig {
            nft_contract: self.nft_contract.clone(),
            registry: self.registry.clone(),
            tla: self.tla.clone(),
            min_label_len: MIN_LABEL_LEN as u32,
            max_label_len: MAX_LABEL_LEN as u32,
        }
    }
}

impl VaultNames {
    fn read_vault(&self, token_id: &TokenId) -> Promise {
        Promise::new(self.nft_contract.clone()).function_call(
            "vault".to_string(),
            serde_json::to_vec(&json!({ "token_id": token_id })).unwrap_or_default(),
            NearToken::from_yoctonear(0),
            GAS_FOR_VAULT_VIEW,
        )
    }

    fn vault_result(&self) -> Option<VaultSummary> {
        env::promise_result_checked(0, MAX_VIEW)
            .ok()
            .and_then(|b| serde_json::from_slice::<Option<VaultSummary>>(&b).ok())
            .flatten()
    }

    /// Refunds a naming now if this contract's free balance covers it; otherwise keeps it for
    /// `claim`, so a callback never fails on a refund it fronts (N7).
    fn refund(&mut self, account_id: AccountId, amount: NearToken) {
        if self.free_balance() >= amount {
            self.pay(account_id, amount).detach();
        } else {
            let total = self.claimable_of(account_id.clone()).saturating_add(amount);
            self.claimable.insert(&account_id, &total);
            emit("refund_held", json!({ "account_id": account_id, "amount": amount }));
        }
    }

    /// The balance not needed for this contract's own storage.
    fn free_balance(&self) -> NearToken {
        let reserve = env::storage_byte_cost().saturating_mul(u128::from(env::storage_usage()));
        env::account_balance().saturating_sub(reserve)
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
