# Bearer threat model

**For:** anyone deciding whether to accept, hold or build on a Bearer vault, and the judges checking our claims.
**After reading** you'll know every way we know of that someone could try to keep or take a vault's coins, what stops each one, and which test proves it.

Status: 2026-11-09. Rows are marked ✅ once their test passes (`contracts/tests`, `cargo test`). "Partly" means only part of the defence is tested; "policy" rows are handled by design or wording, not by a test. "Base, Bitcoin, Solana" means proven for each chain's `withdraw_*` in the sandbox.

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
| T10 | Two signatures exist after a retry | Both pay the same owner and spend the same coins or nonce; at most one confirms | `pnpm demo:dry` step 7: two signed Bitcoin spends of one coin, the simulated ledger accepts one and refuses the other; a re-sent Base transfer fails on its used nonce | partly: a simulated ledger, not yet on real chains |
| T11 | Admin or upgrade powers | No admin, owner, pause, upgrade or raw-sign methods; full-access keys deleted; code hash published | `no_privileged_methods` (sandbox: the wasm exports exactly the expected methods), `spike:testnet lock` (deletes every key; refuses unless the deployed code is the given build). Run on `bearer.testnet` 2026-11-09: 0 keys left, code hash `PEsHBVDK…Vq1S` = the reproducible build ([tx](https://testnet.nearblocks.io/txns/J87dPH7D1LG7PLwvyzqwFbBKMsQ7pAd7Nxfn1DrvsaVT)) | ✅ |
| T12 | Storage drain | Every state-growing call pays for its storage; custody log capped at 16 | `create_deposit_covers_max_vault` (sandbox); withdrawals enforce `ERR_WITHDRAW_DEPOSIT_BELOW_STORAGE` in-contract | ✅ partly |
| T13 | Stale claim link after a transfer or opening (if claim links ship) | Every transfer and `break_seal` deletes the key; `claim` requires `Sealed` | `claim_key_deleted_on_transfer`, `claim_rejected_after_open` | not built: claim links didn't ship |
| T14 | Off-chain payment risk (seller takes payment and never transfers) | Out of scope for v1: Bearer guarantees what you *receive* is sealed and yours, not that a counterparty pays | README and How page copy | policy |
| T15 | Wrong display data (indexer lies or lags) | Balances labelled observed with source and time; the contract never relies on them | UI review checklist | policy |
| T16 | Wrong-network deposits (e.g. ETH on Ethereum Sepolia to the vault's 0x address) | UI warnings; `evm_chain_ids` allowlist; documented as unsupported in v1 | Copy review | policy |
| T17 | Signer returns a signature for the wrong key | Callback verifies each signature against the vault's stored derived key before storing a transaction | `rejects_signature_from_wrong_key`, `a failed Bitcoin signature fails the whole withdrawal, which can be retried`, `a failed or wrong-key Ed25519 signature fails the withdrawal` (sandbox; Ed25519 checked with `env::ed25519_verify`) | ✅ Base, Bitcoin, Solana |

On 2026-11-09 the attack lab's five attacks (T1 twice, T2, T3, T11) were also sent to the locked
`bearer.testnet` as real transactions, and each was refused with the expected error without
reaching the signer (`pnpm spike:testnet attacks`; docs/SPIKES.md).

## Market threats

The market (`contracts/market`) is a separate contract: it holds a listed vault in escrow and
sells it for an exact NEAR price. It can't change Bearer's rules: a vault reaches it only through
Bearer's sealed-only transfer gate, and nothing in it can break a seal. Tests: `cargo test -p
market` (unit) and `contracts/tests/market.test.ts` (sandbox, against the locked Bearer wasm).

| # | Attack | Defence | Test | Status |
|---|---|---|---|---|
| M1 | Fake a listing by calling `nft_on_transfer` directly | Only the Bearer contract may call it | `only_bearer_can_list` (unit and sandbox) | ✅ |
| M2 | List or sell an opened vault, or one the seller no longer holds | The vault arrives through Bearer's gate (sealed only) and stays in escrow; at settlement Bearer's gate checks again, in the same receipt that moves it | `opened_vault_cannot_be_listed` (sandbox) | ✅ |
| M3 | Buyer pays and gets nothing, pays a different price, or races another buyer | Exact price only; a sale in flight locks the listing; the vault moves before any money; a vault that didn't move refunds the buyer and the listing stands | `buy_needs_the_exact_price`, `double_buy_race`, `failed_move_refunds_the_buyer`, `sold_vault_moves_first_then_seller_is_paid` (sandbox); `settle_every_branch`, `second_buyer_is_refused_while_a_sale_is_pending` (unit) | ✅ |
| M4 | A payout bounces (the seller's account is gone) and the money is lost | The callback keeps it as a claimable balance; `claim` pays it to whoever holds the name | `bounced_payout_becomes_claimable` (sandbox and unit) | ✅ |
| M5 | Settlement stops halfway | `buy` and `delist` refuse under 60 Tgas; callbacks never panic | `buy_needs_gas_for_the_whole_settlement`, `failed_move_restores_the_listing` (unit) | ✅ |
| M6 | Fill the market's storage for free | Each listing holds a 0.01 NEAR deposit, checked against the storage it uses and paid back on sale or delisting; without one the vault goes straight back | `listing_holds_the_deposit_and_covers_its_storage` (unit), `listing_without_deposit_returns_the_vault` (sandbox) | ✅ |
| M7 | Someone else delists, or a delisted vault is bought | Only the seller delists; delisting removes the listing | `only_the_seller_can_delist`, `buy_after_delist` (sandbox) | ✅ |
| M8 | A vault sent with plain `nft_transfer` is stuck in the market | `return_unlisted` sends it to the holder before the market, read from Bearer's custody log; it refuses listed vaults | `return_unlisted` tests (sandbox) | ✅ |
| M9 | Admin or upgrade powers over the market, including its key holder acting as the owner of a listed vault (breaking its seal) | No admin, owner or upgrade methods; every key deleted (`spike:market lock`, same guards as Bearer's). The site shows the market's key count and code hash live | `spike:market lock` run on `bearer-market.testnet` 2026-11-09: 0 keys left, code hash `7joKh4WS…qt7P` = the reproducible build ([tx](https://testnet.nearblocks.io/txns/G8t9cc9xKa7ymc84hCtk8xeRG2JKBao8auFLKLg1SHVK)) | ✅ |
| M10 | A buyer reads an observed balance as a guaranteed value | Listings show balances as observations, with source, time and confirmation status | UI review | policy |

## Holdings threats (v2, branch `v2`, not deployed)

v2 lets a vault also hold NEAR, NEP-141 tokens and NEP-171 NFTs, kept by the contract on its
behalf (`contracts/bearer/src/holdings.rs`). They follow the vault's rule: they move with it while
sealed and leave only after opening, by the owner. Tests: `contracts/tests/holdings.test.ts`
(sandbox, against a mock token and NFT contract, `contracts/mock-assets`).

| # | Attack | Defence | Test | Status |
|---|---|---|---|---|
| H1 | Fill someone's vault with spam tokens or NFTs, or use up its slots | Only the vault's owner can load tokens and NFTs; anyone else's are returned by the sender's own contract | `only_owner_can_load_tokens_and_nfts` | ✅ |
| H2 | Take holdings out of a sealed vault | Every withdrawal requires an opened vault | `nothing_leaves_a_sealed_vault` | ✅ |
| H3 | Former owner takes holdings after a transfer | Every withdrawal requires the caller to be the owner | `former_owner_cannot_withdraw_holdings` | ✅ |
| H4 | A failed transfer loses the asset | What a withdrawal moves is marked pending first and restored if the transfer fails; callbacks never panic | `failed_withdrawal_keeps_the_asset` | ✅ |
| H5 | Put a vault inside a vault | Bearer vaults are refused as holdings | `no_nested_vaults` | ✅ |
| H6 | Drain the contract's storage | Each entry's storage is paid from the vault's own NEAR and refunded when it empties; at most 8 tokens and 16 NFTs per vault | `storage_paid_from_vault_near` | ✅ |
| H7 | A fake token pretends to be a known one | Holdings are shown by contract account, not by symbol | UI review | policy |
| H8 | Two withdrawals take the same tokens | Amounts in flight are pending and can't be withdrawn again | `double_withdrawal` | ✅ |

## Staking threats (v2, branch `v2`, not on the hosted site)

The owner of a v2 vault, sealed or opened, can stake its NEAR with the contract's one staking
pool (`contracts/bearer/src/staking.rs`). No signature is involved, so the seal rule is untouched:
staked NEAR is either at that pool or back in the vault, where H2 and H3 apply. Tests:
`cargo test -p bearer staking` (unit) and `contracts/tests/staking.test.ts` (sandbox, against a
mock pool with the standard pool's rules); a testnet run on `bearer-v2.testnet` with
`stakely_v2.pool.f863973.m0` (docs/features/staking.md).

| # | Attack | Defence | Test | Status |
|---|---|---|---|---|
| Y1 | Stake a vault's NEAR with a pool the attacker controls, then hand the vault on | One pool, fixed when the contract is created; no method changes it (`migrate_add_staking` is `#[private]`: only the account's own key, none once locked). The testnet pool is the standard pool code with no access keys | `the pool is the one fixed at creation, and nobody else can migrate` (sandbox), `no_pool_no_staking` (unit); testnet: the pool has 0 keys | ✅ |
| Y2 | Someone else stakes or unstakes a vault, to lock up its NEAR | Only the vault's owner can stake or unstake | `only_owner_can_stake`, `only_owner_can_unstake` (unit and sandbox); testnet: a stranger's stake refused, `ERR_NOT_OWNER` | ✅ |
| Y3 | The former owner keeps the stake after handing the vault on | Shares belong to the vault, not the account; they move with it | `stakes from a sealed vault, and the stake moves with the vault` (sandbox); testnet: alice's unstake after the handover refused, `ERR_NOT_OWNER` | ✅ |
| Y4 | Take staked NEAR out of a sealed vault | Unstaked NEAR comes back into the vault's NEAR; leaving the vault still needs an opened vault and its owner | `unstaked NEAR still needs an opened vault to leave it` (sandbox); testnet: withdrawing from the sealed, staked vault refused, `ERR_VAULT_SEALED` | ✅ |
| Y5 | One vault takes another's rewards or principal | Shares priced at the pool's stake read after `ping`, minus what's queued to leave; new shares rounded down, burned shares rounded up | `rewards_stay_with_earlier_stakes` (unit), `rewards stay with the vaults that earned them` (sandbox, with a simulated reward) | ✅ |
| Y6 | Keep restarting everyone's 4-epoch unlock by unstaking again and again | The pool restarts the wait for the whole account on each `unstake`, so requests are batched: the contract unstakes at the pool only when nothing is unlocking, and withdraws a batch before unstaking the next. A request waits at most two unlock periods | `unstaking_is_batched_and_comes_back_into_the_vault` (unit), `batches requests so one vault can't keep restarting everyone's unlock` (sandbox); testnet: bob's second request queued and the pool's unstaked balance didn't change | ✅ |
| Y7 | A pool call fails halfway, or two interleave | One pool call at a time (`ERR_STAKING_BUSY`); callbacks never panic, always release it, and put NEAR that didn't reach the pool back in the vault | `one_pool_call_at_a_time`, `failed_stake_puts_the_near_back`, `failed_price_read_puts_the_near_back`, `a_refused_unstake_changes_nothing`, `a_refused_batch_stays_queued` (unit), `failed_stake_keeps_the_near` (sandbox) | ✅ |
| Y8 | Staking is read as a guaranteed return | The site says rewards vary and aren't guaranteed, and how long unstaking takes; amounts are read from the pool's own view | UI review | policy |
| Y9 | Fill the contract's storage with stake records | Each vault's fixed-size record is paid from its own NEAR when created and refunded when emptied | `stake_credits_shares_and_pays_its_record` (unit), sandbox storage checks | ✅ |

## What you are trusting

- **NEAR's MPC network** to sign only what the Bearer contract requests, and to keep its key shares safe.
- **The Bearer contract code**, which is open source, reproducibly built and locked (no full-access keys, no upgrade path).
- **Each chain's normal operation** for deposits and withdrawals to confirm.
- **Display data sources** (mempool.space testnet4, Base Sepolia and Solana devnet RPCs) for the balances the UI shows. The contract never uses them.

## Out of scope

- Payment between people who trade a vault (T14).
- Mainnet. This is a testnet prototype and has not been audited.
