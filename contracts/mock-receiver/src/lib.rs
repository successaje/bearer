//! Sandbox-only NEP-171 receiver for threat T6. Inside `nft_on_transfer` it can break the seal on
//! the vault it was just sent and then ask for the vault back: the one way a transfer's resolve
//! step could hand an opened vault on. Bearer must keep it with the receiver instead.

use near_sdk::{env, ext_contract, near, AccountId, Gas, NearToken, PromiseOrValue};

#[ext_contract(ext_bearer)]
#[allow(dead_code)]
trait Bearer {
    fn break_seal(&mut self, token_id: String);
}

#[near(contract_state)]
#[derive(Default)]
pub struct Receiver {}

#[near]
impl Receiver {
    /// `msg`: "open-then-return" breaks the seal, then asks for the vault back; "return" asks for
    /// it back at once; anything else keeps it.
    pub fn nft_on_transfer(
        &mut self,
        sender_id: AccountId,
        previous_owner_id: AccountId,
        token_id: String,
        msg: String,
    ) -> PromiseOrValue<bool> {
        let _ = (sender_id, previous_owner_id);
        match msg.as_str() {
            "open-then-return" => PromiseOrValue::Promise(
                ext_bearer::ext(env::predecessor_account_id())
                    .with_attached_deposit(NearToken::from_yoctonear(1))
                    .with_static_gas(Gas::from_tgas(20))
                    .break_seal(token_id)
                    .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(5)).ask_back()),
            ),
            "return" => PromiseOrValue::Value(true),
            _ => PromiseOrValue::Value(false),
        }
    }

    /// What `nft_on_transfer` resolves to after breaking the seal: true asks for the vault back.
    #[private]
    pub fn ask_back(&self) -> bool {
        true
    }
}
