//! The one transfer gate. Every change of owner goes through this file (T2, T6).
//! No other module may call `tokens.nft_transfer*`, `tokens.internal_transfer*` or write
//! `owner_by_id`; the `single_owner_write_path` test enforces it.

use std::collections::HashMap;

use near_contract_standards::non_fungible_token::core::{
    NonFungibleTokenCore, NonFungibleTokenResolver,
};
use near_contract_standards::non_fungible_token::{Token, TokenId};
use near_sdk::{env, near, require, AccountId, PromiseOrValue};

use crate::{Contract, ContractExt};

impl Contract {
    /// Refuses unless the vault is sealed (invariant I2).
    fn assert_transferable(&self, token_id: &TokenId) {
        let vault = self.vault_or_panic(token_id);
        require!(vault.is_sealed(), "ERR_VAULT_OPENED");
    }

    fn record_custody(&mut self, token_id: &TokenId, new_owner: &AccountId) {
        let mut vault = self.vault_or_panic(token_id);
        vault.push_custody(new_owner.clone(), env::block_timestamp());
        self.vaults.insert(token_id, &vault);
    }
}

#[near]
impl NonFungibleTokenCore for Contract {
    /// NEP-171 transfer. Requires exactly 1 yoctoNEAR and a sealed vault.
    #[payable]
    fn nft_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
    ) {
        require!(approval_id.is_none(), "ERR_NO_APPROVALS");
        self.assert_transferable(&token_id);
        self.tokens
            .nft_transfer(receiver_id.clone(), token_id.clone(), None, memo);
        self.record_custody(&token_id, &receiver_id);
    }

    /// NEP-171 transfer-and-call. The receiver may ask for the token back; the return
    /// goes through `nft_resolve_transfer`, which also respects the seal.
    #[payable]
    fn nft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<bool> {
        require!(approval_id.is_none(), "ERR_NO_APPROVALS");
        self.assert_transferable(&token_id);
        let result =
            self.tokens
                .nft_transfer_call(receiver_id.clone(), token_id.clone(), None, memo, msg);
        self.record_custody(&token_id, &receiver_id);
        result
    }

    fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        self.tokens.nft_token(token_id)
    }
}

#[near]
impl NonFungibleTokenResolver for Contract {
    /// If the receiver opened the vault during `nft_on_transfer`, it keeps the vault even if
    /// it asked to return it: an opened vault never changes hands (T6).
    #[private]
    fn nft_resolve_transfer(
        &mut self,
        previous_owner_id: AccountId,
        receiver_id: AccountId,
        token_id: TokenId,
        approved_account_ids: Option<HashMap<AccountId, u64>>,
    ) -> bool {
        if !self.vault_or_panic(&token_id).is_sealed() {
            return true;
        }
        let kept = self.tokens.nft_resolve_transfer(
            previous_owner_id.clone(),
            receiver_id,
            token_id.clone(),
            approved_account_ids,
        );
        if !kept {
            self.record_custody(&token_id, &previous_owner_id);
        }
        kept
    }
}

#[cfg(test)]
mod tests {
    /// T6: only this file may move tokens between owners.
    #[test]
    fn single_owner_write_path() {
        let forbidden = [
            "nft_transfer(",
            "nft_transfer_call(",
            "internal_transfer",
            "owner_by_id.insert",
            "nft_resolve_transfer(",
        ];
        let others = [
            ("lib.rs", include_str!("lib.rs")),
            ("seal.rs", include_str!("seal.rs")),
            ("vault.rs", include_str!("vault.rs")),
            ("withdraw_evm.rs", include_str!("withdraw_evm.rs")),
            ("mpc.rs", include_str!("mpc.rs")),
            ("evm.rs", include_str!("evm.rs")),
            ("events.rs", include_str!("events.rs")),
            ("holdings.rs", include_str!("holdings.rs")),
            ("staking.rs", include_str!("staking.rs")),
        ];
        for (file, src) in others {
            for pat in forbidden {
                assert!(
                    !src.contains(pat),
                    "{file} contains `{pat}`; owner changes belong in transfer.rs"
                );
            }
        }
    }
}
