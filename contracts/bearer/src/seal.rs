use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::json_types::U64;
use near_sdk::serde_json::json;
use near_sdk::{assert_one_yocto, env, near, require};

use crate::events;
use crate::vault::VaultState;
use crate::{Contract, ContractExt};

#[near]
impl Contract {
    /// Breaks the vault's seal. **Irreversible**: afterwards the vault can request
    /// withdrawal signatures and can never be transferred again (I1, I2).
    ///
    /// Caller: the owner. Deposit: exactly 1 yoctoNEAR (forces a full-access key or a
    /// wallet confirmation). Requests no signature itself.
    /// Fails: `ERR_NOT_OWNER`, `ERR_ALREADY_OPENED`.
    #[payable]
    pub fn break_seal(&mut self, token_id: TokenId) {
        assert_one_yocto();
        let mut vault = self.vault_for_owner(&token_id);
        require!(vault.is_sealed(), "ERR_ALREADY_OPENED");
        let by = env::predecessor_account_id();
        let at = env::block_timestamp();
        vault.state = VaultState::Opened {
            at_ns: U64(at),
            by: by.clone(),
        };
        self.vaults.insert(&token_id, &vault);
        self.set_token_state_extra(&token_id, "opened");
        events::emit(
            "vault_opened",
            json!({ "token_id": token_id, "by": by, "at_ns": U64(at) }),
        );
    }
}
