# Bearer threat model

**For:** anyone deciding whether to accept, hold or build on a Bearer vault, and the judges checking our claims.
**After reading** you'll know every way we know of that someone could try to keep or take a vault's coins, what stops each one, and which test proves it.

The short version, the ways a seller could try to keep the money and why each fails, is [THREAT_MODEL.md](../THREAT_MODEL.md) at the root.

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
| T6 | Bypass the gate: NEP-178 approvals, `nft_resolve_transfer` returning an opened vault, a forgotten path | No approvals extension; resolve uses the gate (a vault that is no longer sealed stays with the receiver); a test fails if any other code changes the owner | `nft_approve_not_exposed and approvals refused` (sandbox), `single_owner_write_path` (unit), `resolve_keeps_opened_vault_with_receiver` (sandbox, against the locked wasm: a receiver contract breaks the seal inside `nft_on_transfer`, then asks for the vault back; it stays with the receiver, opened) | ✅ |
| T7 | Make the contract sign arbitrary bytes | Only typed `withdraw_*`; payloads built in-contract; EVM native transfer only (empty data, type-2); Bitcoin `SIGHASH_ALL` only, change to the same address; Solana one system transfer | `rejects_calldata_shapes`, `rejects_bad_spends`, `bip143_native_p2wpkh_vector` (unit); `rejects unsupported chains and bad params`, `rejects bad Bitcoin spends before asking for a signature`, `signs a P2WPKH spend: payment out, change back to the vault` (sandbox, checked with bitcoinjs-lib); `sol_single_transfer_only`, `compact_u16_vectors` (unit), `rejects bad Solana params before asking for a signature`, `signs one SystemProgram transfer from the vault` (sandbox, checked with @solana/web3.js). No durable nonce can be built: the message always carries a recent blockhash | ✅ Base, Bitcoin, Solana |
| T8 | Collide derivation paths to sign for another vault | Paths built only by the contract from sequential IDs and fixed chain tags | `paths_unique_per_vault_and_chain` (unit) | ✅ |
| T9 | MPC timeout or error leaves the vault in a bad state | Callback never panics; record `Failed`; vault stays `Opened`; retry allowed | `failed_signature_stays_opened and failed_signature_can_retry`, `a failed Bitcoin signature fails the whole withdrawal, which can be retried`, `a failed or wrong-key Ed25519 signature fails the withdrawal` (sandbox) | ✅ Base, Bitcoin, Solana |
| T10 | Two signatures exist after a retry | Both pay the same owner and spend the same coins or nonce; at most one confirms | `spike:testnet same-nonce` on `bearer.testnet` 2026-11-09: two signed Base withdrawals from vault No. 0001 for nonce 0, broadcast together; Base Sepolia confirmed one ([0xcda9…ed00](https://sepolia.basescan.org/tx/0xcda94fc2657424ccc34d972c4015e517f12a75bfaca0aeeeea52d7b89ffded00)) and refused the other (`0xec7e…8b60`), which got "nonce too low" when sent again. `pnpm demo:dry` step 7: two signed Bitcoin spends of one coin, the simulated ledger accepts one and refuses the other | ✅ Base (real chain), Bitcoin (simulated ledger) |
| T11 | Admin or upgrade powers | No admin, owner, pause, upgrade or raw-sign methods; full-access keys deleted; code hash published | `no_privileged_methods` (sandbox: the wasm exports exactly the expected methods), `spike:testnet lock` (deletes every key; refuses unless the deployed code is the given build). Run on `bearer.testnet` 2026-11-09: 0 keys left, code hash `PEsHBVDK…Vq1S` = the reproducible build ([tx](https://testnet.nearblocks.io/txns/J87dPH7D1LG7PLwvyzqwFbBKMsQ7pAd7Nxfn1DrvsaVT)) | ✅ |
| T12 | Storage drain | Every state-growing call pays for its storage; custody log capped at 16 | `create_deposit_covers_max_vault` (sandbox); withdrawals enforce `ERR_WITHDRAW_DEPOSIT_BELOW_STORAGE` in-contract | ✅ partly |
| T13 | A stale copy of a Bearer link takes the vault after it was passed on | A link is the key of the NEAR account that holds the vault. Passing it on or sending it moves the vault to another account, so an old copy controls an empty account. No contract change: the locked contract only sees an owner | testnet 2026-11-10: vault No. 0010 passed through three links and on to an account; each earlier link then read "This link is empty" (docs/features/bearer-links.md) | ✅ |
| T14 | Off-chain payment risk (seller takes payment and never transfers) | Out of scope for v1: Bearer guarantees what you *receive* is sealed and yours, not that a counterparty pays | README and How page copy | policy |
| T15 | Wrong display data (indexer lies or lags) | Balances labelled observed with source and time; the contract never relies on them | UI review checklist | policy |
| T16 | Wrong-network deposits (e.g. ETH on Ethereum Sepolia to the vault's 0x address) | UI warnings; `evm_chain_ids` allowlist; documented as unsupported in v1 | Copy review | policy |
| T17 | Signer returns a signature for the wrong key | Callback verifies each signature against the vault's stored derived key before storing a transaction | `rejects_signature_from_wrong_key`, `a failed Bitcoin signature fails the whole withdrawal, which can be retried`, `a failed or wrong-key Ed25519 signature fails the withdrawal` (sandbox; Ed25519 checked with `env::ed25519_verify`) | ✅ Base, Bitcoin, Solana |
| T18 | Someone who sees a Bearer link takes the vault first | By design: a link is a bearer instrument, like cash. The page says so and offers two ways to move the vault out (a new link, or a NEAR account). The key stays after `#`, which browsers never send to a server, and in the tab's sessionStorage | UI review | policy |
| T19 | Passing a vault on, or making links, stops halfway and loses the new key, and the vault with it | The page stores the new link in the browser and has it saved before anything moves; every step checks what already happened, so it resumes after a reload or a closed tab. Minting writes each key to disk before any transaction and finishes halfway links on the next run | testnet 2026-11-10: a pass-on reloaded mid-move (new link funded, vault not moved) resumed and finished; a mint stopped after creating its vault was finished by a rerun (docs/features/bearer-links.md) | ✅ |

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
| M2 | List or sell an opened vault, or one the seller no longer holds | The vault arrives through Bearer's gate (sealed only) and stays in escrow; at settlement Bearer's gate checks again, in the same receipt that moves it | `opened_vault_cannot_be_listed`, `a_signature_in_flight_blocks_the_sale` (sandbox) | ✅ |
| M3 | Buyer pays and gets nothing, pays a different price, or races another buyer | Exact price only; a sale in flight locks the listing; the vault moves before any money; a vault that didn't move refunds the buyer and the listing stands | `buy_needs_the_exact_price`, `double_buy_race`, `failed_move_refunds_the_buyer`, `sold_vault_moves_first_then_seller_is_paid`, `a_deposit_during_a_pending_sale_belongs_to_the_buyer` (sandbox: a payment that lands while the vault is listed can be spent only by the buyer, after they break the seal); `settle_every_branch`, `second_buyer_is_refused_while_a_sale_is_pending` (unit) | ✅ |
| M4 | A payout bounces (the seller's account is gone) and the money is lost | The callback keeps it as a claimable balance; `claim` pays it to whoever holds the name | `bounced_payout_becomes_claimable` (sandbox and unit) | ✅ |
| M5 | Settlement stops halfway | `buy` and `delist` refuse under 60 Tgas; callbacks never panic | `buy_needs_gas_for_the_whole_settlement`, `failed_move_restores_the_listing` (unit) | ✅ |
| M6 | Fill the market's storage for free | Each listing holds a 0.01 NEAR deposit, checked against the storage it uses and paid back on sale or delisting; without one the vault goes straight back | `listing_holds_the_deposit_and_covers_its_storage` (unit), `listing_without_deposit_returns_the_vault` (sandbox) | ✅ |
| M7 | Someone else delists, or a delisted vault is bought | Only the seller delists; delisting removes the listing | `only_the_seller_can_delist`, `buy_after_delist` (sandbox) | ✅ |
| M8 | A vault sent with plain `nft_transfer` is stuck in the market | `return_unlisted` sends it to the holder before the market, read from Bearer's custody log; it refuses listed vaults | `return_unlisted` tests (sandbox) | ✅ |
| M9 | Admin or upgrade powers over the market, including its key holder acting as the owner of a listed vault (breaking its seal) | No admin, owner or upgrade methods; every key deleted (`spike:market lock`, same guards as Bearer's). The site shows the market's key count and code hash live | `spike:market lock` run on `bearer-market.testnet` 2026-11-09: 0 keys left, code hash `7joKh4WS…qt7P` = the reproducible build ([tx](https://testnet.nearblocks.io/txns/G8t9cc9xKa7ymc84hCtk8xeRG2JKBao8auFLKLg1SHVK)) | ✅ |
| M10 | A buyer reads an observed balance as a guaranteed value | Listings show balances as observations, with source, time and confirmation status | UI review | policy |

## Scheduled handover threats

The schedule (`contracts/schedule`) holds a sealed vault until a chosen date, then hands it to a
chosen recipient. Like the market it can't change Bearer's rules: a vault reaches it only through
Bearer's sealed-only gate, and nothing in it breaks a seal. Tests: `cargo test -p schedule` (unit)
and `contracts/tests/schedule.test.ts` (sandbox, against the locked Bearer wasm).

| # | Attack | Defence | Test | Status |
|---|---|---|---|---|
| S1 | Fake a schedule by calling `nft_on_transfer` directly | Only the Bearer contract may call it | `only_bearer_can_schedule` (unit and sandbox) | ✅ |
| S2 | Release before the date | `release` refuses until the block time reaches it | `release_waits_for_the_date` (unit and sandbox) | ✅ |
| S3 | Release to someone other than the recipient | The recipient is fixed when scheduling; `release` takes no recipient, so anyone may call it | `anyone_can_release_on_the_date` | ✅ |
| S4 | Cancel what was promised | Only the giver, only if they chose a cancellable schedule, only before the date | `irrevocable_schedule_cannot_be_cancelled`, `only_the_giver_can_cancel`, `no_cancelling_after_the_date` | ✅ |
| S5 | The recipient's name isn't registered, so whoever registers it later gets the vault | `release` sends 1 yoctoNEAR first; if the account doesn't exist, the vault stays and the schedule waits | `missing_recipient_keeps_the_vault` (unit and sandbox) | ✅ |
| S6 | The giver withdraws while the vault is scheduled | The schedule holds the vault and never breaks seals; only sealed vaults can be scheduled | `giver_cannot_withdraw_while_scheduled`, `opened_vault_cannot_be_scheduled` | ✅ |
| S7 | Fill the schedule's storage for free | Each schedule holds a 0.01 NEAR deposit, checked against its storage and paid back with the release or the cancellation | `schedule_holds_the_deposit_and_covers_its_storage`, `scheduling_without_deposit_returns_the_vault` | ✅ |
| S8 | A handover stops halfway | `release` and `cancel` refuse too little gas; callbacks never panic and put the schedule back to waiting | `failed_move_keeps_the_schedule` (unit) | ✅ |
| S9 | A vault sent without a schedule is stuck | `return_unscheduled` sends it to the holder before the schedule; never a scheduled vault | `return_unscheduled` tests (sandbox) | ✅ |
| S10 | Admin or upgrade powers over the schedule, including its key holder acting as the owner of a scheduled vault (breaking its seal) | No admin, owner or upgrade methods; every key deleted (`spike:schedule lock`, same guards as Bearer's). The site shows the schedule's lock state live | `spike:schedule lock` run on `bearer-schedule.testnet` 2026-11-09: 0 keys left, code hash `9sLo27AU…JSkE` = the reproducible build ([tx](https://testnet.nearblocks.io/txns/6wAyfjD218s7DvCwuzK7nEtAdLDQK5eZujY3caDJRekx)) | ✅ |

## Lending threats

The lending contract (`contracts/lend`) holds a pledged vault while a loan runs: the borrower
gets NEAR from a lender, and the vault goes back when they repay, or to the lender if they don't
by the due date. Like the market and the schedule it can't change Bearer's rules: a vault reaches
it only through Bearer's sealed-only gate, and nothing in it breaks a seal. Tests: `cargo test -p
lend` (unit) and `contracts/tests/lend.test.ts` (sandbox, against the locked Bearer wasm).

| # | Attack | Defence | Test | Status |
|---|---|---|---|---|
| L1 | Fake a loan request by calling `nft_on_transfer` directly | Only the Bearer contract may call it | `only_bearer_can_request` (unit and sandbox) | ✅ |
| L2 | Pledge an opened vault, or drain one while it's pledged | The vault arrives through Bearer's gate (sealed only) and stays in escrow; nothing here calls `break_seal`, so the borrower can't open it; Bearer's gate checks again in the receipt that moves it out | `opened_vault_cannot_be_pledged`, `borrower_cannot_open_a_pledged_vault` (sandbox); on testnet the borrower's `break_seal` was refused (`ERR_NOT_OWNER`) | ✅ |
| L3 | A lender pays and the borrower gets nothing, or a borrower repays and the vault doesn't come back | Funding passes the exact principal straight to the borrower; repaying moves the vault first and pays the lender only once it has; a vault that didn't move refunds the borrower and the loan stands | `fund_pays_the_borrower`, `repaid_vault_moves_first_then_lender_is_paid`, `foreclosed_vault_goes_to_the_lender_sealed` (sandbox); `settle_every_branch`, `failed_repay_restores_the_loan` (unit) | ✅ |
| L4 | A payout bounces (the account is gone) and the money is lost | The callback keeps it as a claimable balance; `claim` pays it to whoever holds the name | `bounced_payout_becomes_claimable` (unit) | ✅ |
| L5 | Settlement stops halfway | `repay`, `foreclose` and `cancel_request` refuse under 70 Tgas; callbacks never panic and put the loan back as it was | `repay_needs_gas_for_the_whole_settlement`, `failed_foreclosure_keeps_the_loan_for_another_try` (unit) | ✅ |
| L6 | Fill the contract's storage for free, or pledge on terms nobody could meet | Each loan holds a 0.01 NEAR deposit, checked against its storage as it will be once funded, and paid back to the borrower however the loan ends. Terms are checked on arrival: at least 0.001 NEAR, a repayment no smaller than the loan, a term from a minute to ten years. Otherwise the vault goes straight back | `request_holds_the_deposit_and_covers_its_storage`, `funding_fits_in_the_bytes_the_deposit_reserved`, `request_terms_are_checked` (unit); `request_without_deposit_returns_the_vault`, `bad_terms_return_the_vault` (sandbox) | ✅ |
| L7 | The borrower swaps the terms under a lender (takes the request back and asks again for more, or for longer) | `fund` names the repayment and term the lender saw and is refused if either differs; the principal must match exactly | `fund_refuses_changed_terms` (unit and sandbox); refused on testnet (`ERR_TERMS_CHANGED`) | ✅ |
| L8 | Someone else repays, forecloses or cancels; the lender takes the vault early; the borrower repays late; a funded loan is cancelled | Only the borrower repays, and only before the due date; only the lender forecloses, and only from it; only the borrower cancels, and only before anyone lends | `only_the_borrower_can_repay`, `no_repaying_on_or_after_the_due_date`, `only_the_lender_can_foreclose`, `foreclose_waits_for_the_due_date`, `only_the_borrower_can_cancel` (unit); the same in the sandbox; on testnet `ERR_NOT_DUE` and `ERR_PAST_DUE` | ✅ |
| L9 | A vault sent with plain `nft_transfer` is stuck in the contract | `return_unrequested` sends it to the holder before it, read from Bearer's custody log; never a pledged vault | `return_unrequested` tests (sandbox) | ✅ |
| L10 | Admin or upgrade powers over the lending contract, including its key holder acting as the owner of a pledged vault (breaking its seal) | No admin, owner or upgrade methods; every key deleted (`spike:lend lock`, same guards as the market's). The site shows the lending contract's lock state live | `spike:lend lock` run on `bearer-lend.testnet` 2026-11-11: 0 keys left, code hash `9CP3cAHg…GmyU` = the reproducible build ([tx](https://testnet.nearblocks.io/txns/Cia5mDdMobJJCPWUx6kgcAhuNDiYhBxBPukb1XW4ZFuX)) | ✅ |
| L11 | A lender reads an observed balance as a guaranteed value, or the coins fall below the loan | Requests show balances as observations, with source, time and confirmation status. There is no price feed and no early liquidation: the lend review says the borrower may let the lender keep the vault instead of repaying | UI review | policy |

## Dead man's switch threats

The switch (`contracts/switch`) holds a sealed vault while its owner keeps checking in, and hands
it to the beneficiary they named once a whole interval passes without one. Like the other escrow
contracts it can't change Bearer's rules: a vault reaches it only through Bearer's sealed-only
gate, and nothing in it breaks a seal. Tests: `cargo test -p switch` (unit) and
`contracts/tests/switch.test.ts` (sandbox, against the locked Bearer wasm).

| # | Attack | Defence | Test | Status |
|---|---|---|---|---|
| D1 | Fake arming by calling `nft_on_transfer` directly | Only the Bearer contract may call it | `only_bearer_can_arm` (unit and sandbox) | ✅ |
| D2 | Put an opened vault in a switch, or drain one while it's held | The vault arrives through Bearer's gate (sealed only) and stays in escrow; nothing here calls `break_seal`, so the owner can't open it while it's held; Bearer's gate checks again in the receipt that moves it out | `opened_vault_cannot_be_armed`, `owner_cannot_open_an_armed_vault` (sandbox) | ✅ |
| D3 | Someone else checks in, changes the beneficiary or takes the vault back | Only the owner, and only while it's armed | `only_the_owner_checks_in_updates_or_takes_back` (unit), `only_the_owner_checks_in, updates or takes back` (sandbox) | ✅ |
| D4 | The vault is handed over early, or to someone other than the beneficiary | `release` works only once a whole interval has passed since the last check-in, and only moves the vault to the beneficiary the owner named; anyone may trigger it, so the beneficiary needn't wait for anyone | `nobody_can_release_before_a_whole_interval_of_silence`, `a_check_in_stops_a_release_that_would_have_been_due` (unit), `released_vault_goes_to_the_beneficiary_only` (sandbox) | ✅ |
| D5 | A hand-over or take-back stops halfway | `release` refuses under 80 Tgas and `take_back` under 50; callbacks never panic; a vault that didn't move leaves the switch armed as it was | `release_needs_gas_for_the_whole_hand_over`, `a_failed_take_back_keeps_the_switch_armed` (unit) | ✅ |
| D6 | Fill the contract's storage for free | Each switch holds a 0.01 NEAR deposit, checked against its storage including room for the longest beneficiary an update could name, and paid back to the owner however the switch ends. Bad terms send the vault straight back | `arming_needs_a_deposit`, `a_longer_beneficiary_fits_in_the_bytes_the_deposit_reserved` (unit), `arming_without_deposit_returns_the_vault` (sandbox) | ✅ |
| D7 | The vault goes nowhere: the beneficiary is mistyped (an account nobody has), or is the owner, the switch or Bearer | Those three are refused at arming and on update. `release` sends the beneficiary 1 yoctoNEAR first and, if their account doesn't exist, puts the switch back as it was. The site checks the account exists before arming, and the owner can name someone else at any time | `arming_terms_are_checked`, `a_missing_beneficiary_puts_the_switch_back` (unit), `missing_beneficiary_keeps_the_vault armed` (sandbox) | ✅ |
| D8 | A vault sent with plain `nft_transfer` is stuck in the contract | `return_unarmed` sends it to the holder before it, read from Bearer's custody log; never an armed vault | `return_unarmed` tests (sandbox) | ✅ |
| D9 | Admin or upgrade powers over the switch, including its key holder acting as the owner of a vault in it (breaking its seal) | No admin, owner or upgrade methods; every key deleted (`spike:switch lock`, same guards as the market's). The site shows the switch's lock state live | `spike:switch lock` run on `bearer-switch.testnet` 2026-11-12: 0 keys left, code hash `8UD16nKp…nFhh` = the reproducible build ([tx](https://testnet.nearblocks.io/txns/GyLmqGMPoCNf83WzN7BWvsy9EtK3KLxsDeQpvdtUfbnZ)) | ✅ |
| D10 | The owner comes back after the interval ran out, racing someone handing the vault over | A check-in counts until the vault has actually been handed over; whichever lands first wins. Once a hand-over is in flight, check-ins are refused until it settles | `the_owner_can_still_check_in_after_the_due_date_until_it_is_released`, `anyone_can_release_once_it_is_due_and_it_locks_the_switch` (unit), `a_late_check_in_still_counts` (sandbox) | ✅ |
| D11 | The owner loses their key or forgets to check in, and the vault goes before they meant it to | That's what a switch does; the interval is theirs to choose, up to ten years. The vault page and My vaults show the clock; there is no reminder service. Who the beneficiary is and when the owner last checked in are public | by design | documented |

## Standing payments threats

Standing payments (`contracts/standing`) hold a vault and pay a fixed amount from it to a named
payee every period. Unlike the other escrow contracts, this one breaks the seal: the first payment
opens the vault, so it never leaves the contract again (Bearer's I2), and the giver acts through it.
Tests: `cargo test -p standing` (unit) and `contracts/tests/standing.test.ts` (sandbox, against the
locked Bearer wasm), plus `spike:standing` on testnet.

| # | Attack | Defence | Test | Status |
|---|---|---|---|---|
| P1 | Fake a plan by calling `nft_on_transfer` directly | Only the Bearer contract may call it | `only_bearer_can_plan` (unit and sandbox) | ✅ |
| P2 | Someone other than the payee collects, or the payee collects more than once a period | `collect` is the payee's only, and only while a payment has fallen due and not been collected: one per period from the first due date, never more than the plan's number | `only_the_payee_collects`, `one_payment_per_period`, `payments_fall_due_once_a_period_from_the_first_date` (unit), `one_payment_per_period`, `only_the_payee_collects` (sandbox); refused on testnet (`ERR_NOT_PAYEE`, `ERR_NOT_DUE`) | ✅ |
| P3 | The payee sends a payment elsewhere, changes its amount or burns the vault's coins in fees | The address, the amount and the EVM chain come from the plan, never from the payee; the payee picks only coins, nonce, gas or blockhash, and the fee (Bitcoin `fee_sat`, EVM `gas_limit × max_fee_per_gas`) is capped by the plan. Bearer builds and verifies the transaction itself | `a_payment_uses_the_plans_address_amount_and_fee_cap` (unit), `first_payment_opens_the_vault_and_pays_exactly_the_plan`, `pays_exactly_the_plan` for Base and Solana (sandbox, each signed transaction decoded); refused on testnet (`ERR_FEE_TOO_HIGH`) | ✅ |
| P4 | A payment counts without being signed (the payee loses it), or a signed one isn't counted (the payee is paid twice) | Settlement reads Bearer's own withdrawal record at the index the contract expected: signed counts; recorded but unsigned uses the index and counts nothing; no record means Bearer refused, and the deposit goes back. One request per vault at a time. If the record can't be read, the plan stays locked (`unsettled`) until `recheck`, which works only then, when Bearer's answer is final | `settlement_reads_bearers_record_at_the_expected_index`, `a_signed_payment_counts_and_opens_the_vault`, `an_unsigned_payment_counts_nothing_but_uses_the_index`, `a_refused_payment_counts_nothing_and_leaves_the_seal`, `an_unreadable_record_leaves_the_plan_locked_until_rechecked`, `recheck_cannot_race_a_request_in_flight`, `one_request_at_a_time` (unit), `a_refused_first_payment_leaves_the_vault_sealed`, `an_unsigned_payment_counts_nothing_and_the_payee_can_try_again` (sandbox, with the mock signer failing) | ✅ |
| P5 | The giver drains a vault they promised not to, or the payee or anyone else withdraws | `withdraw` is the giver's only, and only once the plan doesn't bind them: cancellable, or over. `stop` is the giver's only, and only on a cancellable plan | `an_irrevocable_plan_binds_withdrawals_too`, `the_payee_cannot_withdraw`, `an_irrevocable_plan_cannot_be_stopped`, `only_the_giver_stops` (unit), `the_giver_withdraws_through_the_plan_and_the_payee_cannot`, `pays_exactly_the_plan_and_binds_the_giver` (sandbox); refused on testnet (`ERR_NOT_GIVER`) | ✅ |
| P6 | The vault leaves the contract when it shouldn't, or can't leave when it should | An opened vault never moves (Bearer refuses it, whoever asks). A sealed one goes back only to the giver, and only when the plan doesn't bind them; the move is Bearer's own `nft_transfer`, which checks the seal in the same receipt | `a_sealed_vault_goes_back_to_the_giver_with_the_deposit`, `an_opened_vault_cannot_be_taken_back`, `an_irrevocable_plan_keeps_the_vault_until_it_ends`, `an_irrevocable_plan_that_paid_nothing_gives_the_vault_back_once_over` (unit), `a_cancellable_sealed_vault_goes_back_with_its_deposit`, `an_opened_vault_stays_and_stop_ends_the_payments` (sandbox); refused on testnet (`ERR_VAULT_OPENED`, twice) | ✅ |
| P7 | A payment stops halfway: the seal broken but nothing paid, or Bearer signed but nothing settled | The seal and the first withdrawal go to Bearer as one batch receipt, so a refused withdrawal leaves the seal unbroken. `collect` and `withdraw` refuse unless the whole chain fits in the gas: this contract, the seal, Bearer's own floor, the read-back and settlement. Callbacks never panic | `a_payment_needs_gas_for_its_whole_settlement` (unit), `a_refused_first_payment_leaves_the_vault_sealed` (sandbox) | ✅ |
| P8 | A plan that can never pay or never end: the payee is the giver, the contract or Bearer; a bad address; an irrevocable plan with no end; a period under a minute | Refused at planning, which sends the vault straight back. Bearer checks the address fully at every payment | `the_payee_cannot_be_the_giver`, `a_period_is_at_least_a_minute`, `an_irrevocable_plan_needs_a_number_of_payments`, `an_evm_plan_names_its_chain`, `a_solana_plan_has_no_fee_cap_to_set`, `a_bad_address_is_refused_at_planning`, `addresses_are_checked_for_their_chain` (unit), `bad_terms_return_the_vault` (sandbox) | ✅ |
| P9 | Fill the contract's storage for free | Each plan holds a 0.01 NEAR deposit, checked against its storage including the largest in-flight state; paid back if the vault goes back. Planning without it sends the vault back | `planning_needs_a_deposit` (unit), `planning_without_deposit_returns_the_vault` (sandbox) | ✅ |
| P10 | A vault sent with plain `nft_transfer` is stuck in the contract | `return_unplanned` sends it to the holder before it, read from Bearer's custody log; never a planned vault | `sends_a_vault_that_arrived_without_a_plan_back` (sandbox) | ✅ |
| P11 | The vault runs dry, or the payee stops collecting | That's the plan's nature: the contract can't see other chains' balances. A payment the vault can't cover is refused by Bearer or fails on its chain, and counts nothing unless signed. A payment not collected within a period after the last one falls due lapses. The page shows what's held and what's due | by design | documented |
| P12 | Admin or upgrade powers over the contract, including its key holder acting as the owner of every vault in it: unlike the other escrows, that owner could withdraw from opened vaults | No admin, owner or upgrade methods; every key deleted (`spike:standing lock`, same guards as the switch's: it refuses unless the deployed code hash is `contracts/res/standing.wasm`'s). The site shows the lock state live beside every plan | `spike:standing lock` run on `bearer-standing.testnet` 2026-11-18: 0 keys left on three RPCs, code hash `BRHTRhTM…LNck` = the reproducible build of `f4420f1` ([tx](https://testnet.nearblocks.io/txns/AomwgGxHemBz2St6vCoRooPnSje7ZnGr2cYsfUkrrviX)); `pnpm verify` checks both | ✅ |

## Risk note threats

The risk note (`apps/web/src/lib/nearai`, docs/features/risk-note.md) asks an open model in NEAR AI
Cloud's confidential enclaves for advice on a loan request. It can't move anything; these rows are
about whether the note shown is what it claims to be. Tests: `pnpm --filter web check:nearai` (live,
with tamper tests).

| # | Attack | Defence | Test | Status |
|---|---|---|---|---|
| A1 | Show a note that didn't come from the attested model (a proxy, a cache, an edited reply) | The reply's signature must recover (EIP-191) to the key the Intel quotes bind, over the SHA-256 of the exact request and reply bytes, signed by the model's enclave (`provider_tee`), not the gateway. Otherwise the note isn't shown | Signatures over other hashes, by another key or by the gateway are refused (check:nearai) | ✅ |
| A2 | Replay an old attestation, or one for another request | A nonce made for each request must be in every Intel quote's report data and in NVIDIA's signed verdict | A report checked with another nonce: not fresh, not bound, GPUs refused (check:nearai) | ✅ |
| A3 | A fake or altered Intel quote, or a debuggable enclave | Each quote is verified with DCAP against Intel's certification service and must be `UpToDate`; the debug bit must be off | The debug bit flipped: caught, and Intel rejects the quote's signature (check:nearai) | ✅ |
| A4 | The enclave runs other code than it claims | The quote's `mr_config_id` must bind the docker compose's hash, the event log's `compose-hash` must agree, and the event log must replay to RTMR3. The compose pins images by digest; the model weights loaded by NEAR AI's compose-manager aren't re-verified here | A changed compose fails (check:nearai) | ✅, compose level |
| A5 | GPUs outside the enclave, or a forged NVIDIA verdict | NVIDIA's attestation service checks the GPU evidence; its ES384 JWT is verified against NVIDIA's published keys, overall result `true`, our nonce | Live check: 24 Hopper GPUs passed (check:nearai) | ✅ |
| A6 | A visitor feeds the model false facts, or instructions | The server reads the facts itself from NEAR testnet and public chain data for the vault number given; the request carries nothing else. The vault's name, chosen by its owner, isn't sent | by construction (`loanFacts`) | ✅ |
| A7 | Run up the NEAR AI bill | Only existing loans can be asked about; each note is kept ten minutes per loan state and an enclave check one minute; the key is a server-only variable | by construction | partly: a determined caller can still make one paid call per loan every ten minutes per server instance |
| A8 | Treat the note as a guarantee | The page says it's advice, the rating is "risk to the lender", the model is told there's no NEAR price, and the lending contract alone decides | by design | documented |

## What you are trusting

- **NEAR's MPC network** to sign only what the Bearer contract requests, and to keep its key shares safe.
- **The Bearer contract code**, which is open source, reproducibly built and locked (no full-access keys, no upgrade path).
- **Each chain's normal operation** for deposits and withdrawals to confirm.
- **Display data sources** (mempool.space testnet4, Base Sepolia and Solana devnet RPCs) for the balances the UI shows. The contract never uses them.

## Out of scope

- Payment between people who trade a vault (T14).
- Price risk on a loan (L11): no oracle, no liquidation before the due date.
- Mainnet. This is a testnet prototype and has not been audited.
