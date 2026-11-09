# Bearer threat model

**For:** anyone deciding whether to accept, hold or build on a Bearer vault, and the judges checking our claims.
**After reading** you'll know every way we know of that someone could try to keep or take a vault's coins, what stops each one, and which test proves it.

Status: 2026-11-08. Rows are marked ✅ once their test passes (`contracts/tests`, `cargo test`). "Base, Bitcoin, Solana" means proven for each chain's `withdraw_*` in the sandbox.

## The rule everything rests on

> A vault can change hands only while it is **sealed**. Breaking the seal is the only way to get a signature, and it can never be undone.

| | Sealed | Opened |
|---|---|---|
| Can be transferred (any path) | Yes | Never |
| Can request a withdrawal signature | Never | Yes, by the owner, repeatedly |
| Signatures ever requested | Always 0 | 0 or more |

### Invariants

- **I1.** `state` only ever changes `Sealed → Opened`.
- **I2.** Every successful transfer, on every path, observed `state == Sealed`.
- **I3.** Every MPC `sign` call is made by a `withdraw_*` method that observed `state == Opened` and `predecessor == owner`.
- **I4.** `signatures_requested == 0` whenever `state == Sealed`.
- **I5.** Derivation paths are built only by the contract and are unique per token and chain.

### Why this answers "can the old owner keep the money?"

The classic attack: Alice gets a withdrawal signed, keeps the signed transaction, transfers the vault to Bob, then broadcasts it. Checking ownership at transfer time can't cancel a signature that already exists.

Under the rule, Alice can't get a signature without breaking the seal, and once she breaks it she can't transfer the vault. So any vault Bob receives has never had a signature requested on any chain (I2 + I4). The coins at its addresses can only move through a future signature, and only the current owner can ever ask for one.

### Why retries and late signatures are safe

An opened vault's owner is fixed forever. Every signature the contract requests for it pays where that owner chose. If a timed-out request is retried and both signatures end up existing, they spend the same Bitcoin coins or the same EVM nonce, so the chain accepts at most one, and either way it's the owner's own withdrawal. Fee bumps are just another withdrawal.

## Threats

| # | Attack | Defence | Test | Status |
|---|---|---|---|---|
| T1 | Former owner withdraws after transferring (any chain) | `withdraw_*` and `break_seal` require `predecessor == owner` | `alice_cannot_break_seal_after_transfer and alice_cannot_withdraw_after_transfer`, `alice_cannot_withdraw_btc_after_transfer`, `alice_cannot_withdraw_sol_after_transfer` (sandbox) | ✅ Base, Bitcoin, Solana |
| T2 | Transfer an opened vault, by any path | `internal_transfer` requires `Sealed`; it is the only owner-changing path | `opened_vault_rejects_nft_transfer and nft_transfer_call` (sandbox) | ✅ |
| T3 | Keep a signature for a sealed vault | No signature can be requested while sealed (I3); `withdraw_*` on a sealed vault fails `ERR_VAULT_SEALED` | `sealed_vault_cannot_request_signature`, `sealed_vault_cannot_request_btc_signature`, `sealed_vault_cannot_request_sol_signature` (sandbox; also assert the signer saw no call and `signatures_requested == 0`) | ✅ |
| T4 | Race `break_seal` against `nft_transfer` | The contract's receipts run one at a time; whichever runs first wins and the other fails cleanly | `race_break_then_transfer and race_transfer_then_break` (sandbox) | ✅ |
| T5 | Transfer while a withdrawal signature is in flight ("sale in the middle of a payout") | A signature in flight implies `Opened`, which refuses transfers | `transfer_rejected_during_pending_signature` (sandbox) | ✅ |
| T6 | Bypass the gate: NEP-178 approvals, `nft_resolve_transfer` returning an opened vault, a forgotten path | No approvals extension; resolve uses the gate; a test fails if any other code changes the owner | `nft_approve_not_exposed and approvals refused` (sandbox), `single_owner_write_path` (unit), `resolve_keeps_opened_vault_with_receiver` (needs a receiver test contract) | ✅ partly |
| T7 | Make the contract sign arbitrary bytes | Only typed `withdraw_*`; payloads built in-contract; EVM native transfer only (empty data, type-2); Bitcoin `SIGHASH_ALL` only, change to the same address; Solana one system transfer | `rejects_calldata_shapes`, `rejects_bad_spends`, `bip143_native_p2wpkh_vector` (unit); `rejects unsupported chains and bad params`, `rejects bad Bitcoin spends before asking for a signature`, `signs a P2WPKH spend: payment out, change back to the vault` (sandbox, checked with bitcoinjs-lib); `sol_single_transfer_only`, `compact_u16_vectors` (unit), `rejects bad Solana params before asking for a signature`, `signs one SystemProgram transfer from the vault` (sandbox, checked with @solana/web3.js). No durable nonce can be built: the message always carries a recent blockhash | ✅ Base, Bitcoin, Solana |
| T8 | Collide derivation paths to sign for another vault | Paths built only by the contract from sequential IDs and fixed chain tags | `paths_unique_per_vault_and_chain` (unit) | ✅ |
| T9 | MPC timeout or error leaves the vault in a bad state | Callback never panics; record `Failed`; vault stays `Opened`; retry allowed | `failed_signature_stays_opened and failed_signature_can_retry`, `a failed Bitcoin signature fails the whole withdrawal, which can be retried`, `a failed or wrong-key Ed25519 signature fails the withdrawal` (sandbox) | ✅ Base, Bitcoin, Solana |
| T10 | Two signatures exist after a retry | Both pay the same owner and spend the same coins or nonce; at most one confirms | `pnpm demo:dry` step 7: two signed Bitcoin spends of one coin, the simulated ledger accepts one and refuses the other; a re-sent Base transfer fails on its used nonce | ✅ (simulated ledger) |
| T11 | Admin or upgrade powers | No admin, owner, pause, upgrade or raw-sign methods; full-access keys deleted; code hash published | `no_privileged_methods` (sandbox: the wasm exports exactly the expected methods), `spike:testnet lock` (deletes every key; refuses unless the deployed code is the given build; not yet run on `bearer.testnet`) | ✅ partly |
| T12 | Storage drain | Every state-growing call pays for its storage; custody log capped at 16 | `create_deposit_covers_max_vault` (sandbox); withdrawals enforce `ERR_WITHDRAW_DEPOSIT_BELOW_STORAGE` in-contract | ✅ partly |
| T13 | Stale claim link after a transfer or opening (if claim links ship) | Every transfer and `break_seal` deletes the key; `claim` requires `Sealed` | `claim_key_deleted_on_transfer`, `claim_rejected_after_open` | |
| T14 | Off-chain payment risk (seller takes payment and never transfers) | Out of scope for v1: Bearer guarantees what you *receive* is sealed and yours, not that a counterparty pays | README and How page copy | |
| T15 | Wrong display data (indexer lies or lags) | Balances labelled observed with source and time; the contract never relies on them | UI review checklist | |
| T16 | Wrong-network deposits (e.g. ETH on Ethereum Sepolia to the vault's 0x address) | UI warnings; `evm_chain_ids` allowlist; documented as unsupported in v1 | Copy review | |
| T17 | Signer returns a signature for the wrong key | Callback verifies each signature against the vault's stored derived key before storing a transaction | `rejects_signature_from_wrong_key`, `a failed Bitcoin signature fails the whole withdrawal, which can be retried`, `a failed or wrong-key Ed25519 signature fails the withdrawal` (sandbox; Ed25519 checked with `env::ed25519_verify`) | ✅ Base, Bitcoin, Solana |

## What you are trusting

- **NEAR's MPC network** to sign only what the Bearer contract requests, and to keep its key shares safe.
- **The Bearer contract code**, which is open source, reproducibly built and locked (no full-access keys, no upgrade path).
- **Each chain's normal operation** for deposits and withdrawals to confirm.
- **Display data sources** (mempool.space testnet4, Base Sepolia and Solana devnet RPCs) for the balances the UI shows. The contract never uses them.

## Out of scope

- Payment between people who trade a vault (T14).
- Mainnet. This is a testnet prototype and has not been audited.
