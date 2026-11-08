use near_sdk::json_types::U64;
use near_sdk::{near, AccountId};

/// How many holders each vault keeps on-chain. Older entries live in NEP-297 events.
pub const CUSTODY_CAP: usize = 16;

/// Longest allowed vault name, in bytes.
pub const MAX_NAME_LEN: usize = 32;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum VaultState {
    Sealed,
    /// Terminal. No transition leaves this state (invariant I1).
    Opened {
        at_ns: U64,
        by: AccountId,
    },
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Finish {
    Obsidian,
    Champagne,
    Graphite,
    Ivory,
    Midnight,
    Sage,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ChainTag {
    Btc,
    Evm,
    Sol,
}

impl ChainTag {
    pub const ALL: [ChainTag; 3] = [ChainTag::Btc, ChainTag::Evm, ChainTag::Sol];

    pub fn as_str(self) -> &'static str {
        match self {
            ChainTag::Btc => "btc",
            ChainTag::Evm => "evm",
            ChainTag::Sol => "sol",
        }
    }

    /// MPC key domain: 0 is secp256k1 (Bitcoin, EVM), 1 is Ed25519 (Solana).
    pub fn domain_id(self) -> u64 {
        match self {
            ChainTag::Btc | ChainTag::Evm => 0,
            ChainTag::Sol => 1,
        }
    }
}

/// Derivation path for a vault's address on one chain. Built only here (invariant I5).
pub fn vault_path(token_id: &str, chain: ChainTag) -> String {
    format!("bearer:v3:{token_id}:{}", chain.as_str())
}

/// Public keys the MPC signer derives for this contract and the vault's paths.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct DerivedKeys {
    pub btc: String,
    pub evm: String,
    pub sol: String,
}

impl DerivedKeys {
    pub fn get(&self, chain: ChainTag) -> &str {
        match chain {
            ChainTag::Btc => &self.btc,
            ChainTag::Evm => &self.evm,
            ChainTag::Sol => &self.sol,
        }
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Custody {
    pub account_id: AccountId,
    pub since_ns: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Vault {
    pub state: VaultState,
    /// Always 0 while sealed (invariant I4).
    pub signatures_requested: u32,
    pub withdrawal_count: u32,
    /// Filled in by the callback of `create_vault`; `None` until the signer answers.
    pub keys: Option<DerivedKeys>,
    pub custody: Vec<Custody>,
    pub created_at_ns: U64,
    pub name: Option<String>,
    pub finish: Finish,
}

impl Vault {
    pub fn new(owner: AccountId, now_ns: u64, name: Option<String>, finish: Finish) -> Self {
        Self {
            state: VaultState::Sealed,
            signatures_requested: 0,
            withdrawal_count: 0,
            keys: None,
            custody: vec![Custody {
                account_id: owner,
                since_ns: U64(now_ns),
            }],
            created_at_ns: U64(now_ns),
            name,
            finish,
        }
    }

    pub fn is_sealed(&self) -> bool {
        matches!(self.state, VaultState::Sealed)
    }

    pub fn push_custody(&mut self, account_id: AccountId, now_ns: u64) {
        if self.custody.len() >= CUSTODY_CAP {
            self.custody.remove(0);
        }
        self.custody.push(Custody {
            account_id,
            since_ns: U64(now_ns),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn paths_unique_per_vault_and_chain() {
        let mut seen = HashSet::new();
        for id in 0..2_000u64 {
            for chain in ChainTag::ALL {
                assert!(
                    seen.insert(vault_path(&id.to_string(), chain)),
                    "duplicate path"
                );
            }
        }
        // Token "1" on evm can never equal token "1:evm" style collisions: ids are digits only.
        assert_eq!(vault_path("42", ChainTag::Btc), "bearer:v3:42:btc");
    }

    #[test]
    fn custody_log_is_capped() {
        let alice: AccountId = "alice.test.near".parse().unwrap();
        let mut v = Vault::new(alice.clone(), 1, None, Finish::Obsidian);
        for i in 0..40 {
            v.push_custody(format!("u{i}.test.near").parse().unwrap(), 2 + i);
        }
        assert_eq!(v.custody.len(), CUSTODY_CAP);
        assert_eq!(
            v.custody.last().unwrap().account_id.as_str(),
            "u39.test.near"
        );
    }
}
