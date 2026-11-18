# Feature: vault names

**Branch:** `next` · **Where:** a vault's page ("Its NEAR account") · **Contracts:** `contracts/names`
on `bearer-names.testnet` (not locked yet), renting from House of Stake's TLA contracts under
`bearer-tla.testnet` · **Status:** built on 18 Nov 2026, after the code window closed and while
judging ran; not on `main`

**For:** whoever decides whether this ships, and anyone checking what it trusts. What it does, what
it costs, what it depends on, and why it's shaped this way.

## What it is

A vault's holder can rent it a name of its own, such as `vault-0038.bearer-tla.testnet`: a real NEAR
account under a Top Level Account (TLA), rented through House of Stake's TLA contracts
([houseofstake/tla-contracts](https://github.com/houseofstake/tla-contracts)). Anyone can send NEAR to
it by name, from any wallet. It belongs to the vault, not to a person:

- the names contract rents it with itself as the lease's owner, and has no method to hand the lease
  on;
- the account has no access keys. It runs House of Stake's shared wallet, which sends only when the
  lease's owner (an "extension", here the names contract) asks;
- the names contract asks only for whoever holds the vault, and only once they've opened it. An
  opened vault never changes hands (Bearer's invariant I2), so a sale can't slip in between the
  check and the payment.

While the vault is sealed, the NEAR stays in the name and goes with the vault when it changes hands,
like its Bitcoin, Base and Solana coins. A vault is named once, for as long as the lease is renewed.
`vault-0042` is reserved for vault No. 0042, so no vault can be named to look like another.

## What it costs

On `bearer-tla.testnet` the registry quotes 0.0103158 NEAR:

- **0.01 NEAR** stays in the new account for its storage;
- **0.000316 NEAR** of rent: a year at the lowest tier ($0.0015 at a fixed $5 per NEAR, 0.0003 NEAR),
  padded 5.27% by the registry's quote against rate moves. The registry charges 0.0003 and keeps the
  rest for the names contract until someone calls `reclaim`; it goes to the contract, not back to
  the caller.

Renewing costs a year's rent, 0.000316 NEAR quoted. Anyone can renew, any number of years ahead.

## Why Bearer runs its own copy of House of Stake's fleet on testnet

House of Stake's own testnet deployment (`hosdemo.testnet`, the official code at `d12a84b`) can't
rent: its NEAR/USD rate comes from an oracle that stopped on 27 Aug 2026, so every rent fails with
`rate_stale`. Another testnet fleet, `hostla.testnet`, runs a prototype fork rather than the official
code. So Bearer deployed House of Stake's contracts under `bearer-tla.testnet` itself
(`spike/tla-testnet.ts`):

- **The same code:** the exact bytes deployed on hosdemo's accounts, read with `view_code` and pinned
  by hash: registrar `FDJaArRG…Khuv`, registry `DYKXJSzj…Uak6` and extension `FYqeTgwQ…7qZt` at
  `d12a84b`; recovery `GqFi2eCN…iZAm` at `7def42e`. The crates are `MIT OR Apache-2.0`.
- **The same wallet:** every name runs `impl.hosdemo.testnet`, House of Stake's shared wallet.
- **Settings for a testnet that has no oracle:** the rate fixed at $5 per NEAR and allowed to be 100
  years old, rent at the lowest tier, a 7-day grace period, and a recovery contract with two
  throwaway watcher keys, so recovery can never run.

On mainnet, names would come from House of Stake's own deployment. Nothing in the names contract is
specific to this fleet: its registry and TLA are set once, at `new`.

## What a name depends on

Bearer's other addresses depend only on NEAR, its MPC signing network and Bearer's locked contracts.
A name also depends on House of Stake's contracts, and on whoever governs them:

- **The lease runs out unless someone renews it.** Leases last a year. Once one has ended, anyone can
  sweep the name's NEAR into its payout account, which is the names contract, where it no longer
  belongs to any vault. A week later anyone can take the name back, and then anyone can rent it. The
  page warns 60 days before a lease ends, and checks the registry: a name whose lease is no longer
  the names contract's is shown as no longer the vault's.
- **The TLA's own lease runs out too.** `bearer-tla.testnet` is leased until 18 Nov 2027. Once that
  lease is past its grace period, every name under it can be taken back. Only the registry's admin,
  `council.bearer-tla.testnet`, can renew it.
- **The council can move any name.** It can add a recovery authority, and a recovery authority can
  give any name a new owner (`recover_sub_account`). The council and admins can also upgrade the
  registry and the extension. On testnet the council is Bearer's own key.
- **The shared wallet can change.** Every name runs the global contract published by
  `impl.hosdemo.testnet`, by account. That account has two full-access keys, House of Stake's, and
  whoever holds them can change what every name runs.
- **Keys are still in place.** Every account in Bearer's fleet still has its key (the council, the
  registry, the extension, recovery and `bearer-tla.testnet` itself), and so does the names
  contract until it's locked.

So a name is as safe as the TLA's governance. The page says so beside every name: keep small
amounts in it.

## How it's built

- **Naming.** `name_vault(token_id, label)` with the registry's quote attached and at least 230 Tgas.
  The contract reads Bearer's `vault` view in a callback (the caller must hold the vault), rents
  `label.tla` with itself as the owner, reads the lease back with `get_sub_account`, and counts the
  name only if the registry now records the names contract as its owner. Anything else refunds the
  caller. One naming per vault at a time.
- **Taking NEAR out.** `withdraw(token_id, receiver_id, amount)` with 1 yoctoNEAR. The contract reads
  the vault in a callback and, only for the holder of an opened vault, asks the name's wallet to send
  the amount (`w_execute_extension`, House of Stake's request format). The wallet keeps what its own
  storage needs. The 1 yoctoNEAR attached goes to the wallet.
- **Refunds.** House of Stake's registry never sends a refund straight back: it records it for the
  payer to collect with `claim_refund`. That covers the quote's padding on every rent, and the whole
  price when a name's account can't be created. The names contract refunds its caller at once, from
  its own balance; `reclaim` (anyone may call it) brings the registry's refunds back to the contract;
  and a refund the contract can't cover yet is kept for `claim`, so a callback never fails on one.
- **Renewing** is House of Stake's own `renew_sub_account`, which anyone may call.
- **No admin, owner or upgrade methods.** The Bearer contract, the registry and the TLA are fixed at
  `new`.
- **Events:** NEP-297 `bearer_names` (`named`, `naming_refused`, `withdrawn`, `withdrawal_refused`,
  `withdrawal_failed`, `payout_failed`, `refund_held`).

## On testnet

Against the locked `bearer.testnet` (reports in `contracts/tests/spike/reports/testnet-names-*`):

- **An opened vault.** Bob's vault No. 0001 was named `vault-0001.bearer-tla.testnet`
  ([tx](https://testnet.nearblocks.io/txns/CRy4iVAUNS8Yr49ktWEEq9Qg9Ep7hV3kbkseL96vXVSD)). Naming it
  again was refused with `ERR_ALREADY_NAMED`
  ([tx](https://testnet.nearblocks.io/txns/VtBRFoUdJ441AkSGe8B6FCLqDWcGG2jqB54PzLAxT73)); Alice, who
  doesn't hold it, was refused
  ([tx](https://testnet.nearblocks.io/txns/A4GoJ2adNybtfrEq5HexGEW6CFhNPKva4hVNRfojPSm4)); Bob took
  out 0.02 NEAR, 0.11 → 0.09, in 11.8 Tgas
  ([tx](https://testnet.nearblocks.io/txns/6QwhCfCELJCo21dt32qRNzjZr41bqydR3x9nruUq3PT5)).
- **A sealed vault that changes hands.** Alice created vault No. 0038
  ([tx](https://testnet.nearblocks.io/txns/EJWVtxWTpusnv5JuDpEuPJ6n72x6RUv789LtJS2jFvYd)) and named
  it `vault-0038` for 0.010315 NEAR, 33.9 Tgas in all
  ([tx](https://testnet.nearblocks.io/txns/5tGASDYDFemcPVFzLkeMj9SPXsdYsYkrCFf6oHzy8ZGV)), and 0.03
  NEAR was paid in. Every attempt to take it out failed until the right moment: Alice's while it was
  sealed ([tx](https://testnet.nearblocks.io/txns/DakiNSYoMkyy1T2WsTP1Ybmpj1sT74edxdVX9uj188V8));
  after she handed it to Bob sealed
  ([tx](https://testnet.nearblocks.io/txns/2omgxDtPRSRf9JZX3iUa7ognyTD3sAgDFmpaet9ZuUML)), Alice's
  again as its former holder
  ([tx](https://testnet.nearblocks.io/txns/EaKXzkjhb5vjhCqs98a8DmDpZAi3MDsP6kSD1Ffn9zUr)) and Bob's
  while it was still sealed
  ([tx](https://testnet.nearblocks.io/txns/7iEYFLzjLk983ZQF4z3ggL4QZTocWwLnvzUWDWKcgCiB)). Bob broke
  the seal ([tx](https://testnet.nearblocks.io/txns/3E77VKrR5ij6BV51SHYbXEizi1Ji9pUpYQQi1CvYdCCc)) and
  took out 0.02 NEAR, 0.04 → 0.02
  ([tx](https://testnet.nearblocks.io/txns/6dMNchZE1tbvuPfdRLpTUW3qGJyfrDG3RMZUDCFzKu3L)).
- **What the names are.** Both have 0 access keys, run `impl.hosdemo.testnet`, and their lease
  tokens on `registry.bearer-tla.testnet` are owned by `bearer-names.testnet`.
- **Refused, after the fixes below.** Alice naming vault No. 0002, which she doesn't hold: refused
  and refunded in the same transaction, 9.8 Tgas
  ([tx](https://testnet.nearblocks.io/txns/EShAqq2Kvz8hYxKpdWZhEr2wEanXtvaE96ci2hcvB723)); a vault
  other than No. 0042 named `vault-0042`: `ERR_LABEL_RESERVED`
  ([tx](https://testnet.nearblocks.io/txns/D8eDV6j6v26QmEa8PoUbRBCujHtDoNFeZi2m5jktQ7A3)).
- **Reclaimed.** The registry held 0.0000316 NEAR of quote padding from the two namings; `reclaim`
  brought it back to the names contract in 7.7 Tgas
  ([tx](https://testnet.nearblocks.io/txns/4t1uPcpZx4bX7K4HAF6xuRBwcwAY1wuRZF9vGppj15g2)).

`pnpm verify` re-checks vault No. 0038's name (no keys, the lease the names contract's), Alice's
refusal and Bob's withdrawal, and that the names contract isn't locked yet.

Two fixes came out of these runs and were redeployed: `reclaim`, with refunds that never fail a
callback, after finding the registry holding the padding; and reserved `vault-NNNN` labels.

## Not locked yet

`bearer-names.testnet` still has its key and runs a local build (code hash `A5Nd8YDJ…GUA3`), not a
reproducible one. The vault page says so beside every name, as it does for the other contracts'
locks. Locking it means a reproducible build with cargo-near 0.22.0, a redeploy, and
`CONFIRM_LOCK=bearer-names.testnet pnpm spike:names lock`, which refuses unless the deployed code is
that build.

## Try it

- **Simulated demo:** `NEXT_PUBLIC_NETWORK=mock pnpm dev`, connect as `ada.testnet` and open `/v/42`:
  it's named `theos-birthday.tla.testnet` and sealed, so nobody can take its NEAR out. Name `/v/63`
  (sealed) or `/v/29` (opened, so you can take NEAR out).
- **Testnet:** `pnpm dev` and open `/v/38` or `/v/1`. Scripts in `contracts/tests`:
  `pnpm spike:tla fleet|status` and `pnpm spike:names setup|run|refusal|reclaim|lock`.

## What it doesn't do

- **Nobody renews on their own.** A blockchain doesn't act by itself; someone has to renew.
- **Only NEAR comes out.** The names contract only asks the wallet for NEAR transfers; tokens sent
  to a name can't be taken out through Bearer.
- **No renaming, and no handing the name on apart from the vault.**
- **Not on mainnet.**

## Files

- `contracts/names/src/lib.rs`, `tests.rs`: the contract and 23 unit tests. There are no sandbox
  tests: the sandbox has no House of Stake fleet, so the testnet runs above stand in for them.
- `contracts/tests/spike/tla-testnet.ts` (the fleet) and `names-testnet.ts` (setup, run, refusal,
  reclaim, lock).
- `packages/sdk/src/types.ts` (`VaultName`, `NamePrice`) and `testnet/client.ts` (`getVaultName`,
  `namePrice`, `nameVault`, `withdrawFromName`, `renewName`).
- `apps/web/src/components/vault/vault-name-panel.tsx`.
- Threats N1–N10 in [docs/THREAT_MODEL.md](../THREAT_MODEL.md).
