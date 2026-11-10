# Feature: staking a vault's NEAR (v2)

**Branch:** `v2` · **Contract:** `contracts/bearer/src/staking.rs`, on `bearer-v2.testnet`
(unlocked, regular build) · **Pool:** `stakely_v2.pool.f863973.m0` · **On the site:** a "Staked"
panel on a v2 vault's page (v2 preview only; the hosted site stays on v1) · **Status:** run on
testnet 2026-11-09; the first unstaked batch came back into its vault on 2026-11-10 (epoch
5434), and the next one unlocks at epoch 5438

**For:** whoever decides whether v2 ships. What staking does, why it can't weaken the seal, and
what was checked.

## What it is

A parent puts NEAR in a vault for their child and stakes it, so it earns NEAR staking rewards
while it waits. When the vault is handed on, the stake goes with it, rewards included, and only
the new holder can unstake. Rewards depend on the pool and the network. They vary and aren't
guaranteed (Y8).

## Why it doesn't touch the seal

Bearer's rule is that a sealed vault can never get a signature. Staking needs none: the contract
itself sends the vault's NEAR to one staking pool and asks for it back. So staked NEAR is only ever
at that pool or back in the vault's NEAR, where the holdings rules apply: nothing leaves a sealed
vault, and only the owner takes it out after opening (Y4).

The pool is fixed when the contract is created, and nothing can change it (Y1). If anyone could
name a pool, a seller could "stake" a vault's NEAR into a contract of their own and sell an empty
vault. On testnet the pool is the standard staking pool code and its account has no access keys,
so nobody can change it either.

## How it works

- **Stake** (the owner, sealed or opened; Y2). The contract pings the pool, reads its own stake
  there, and gives the vault shares at that price. Then it deposits and stakes. The first stake
  also pays about 0.001 NEAR from the vault for its record (Y9).
- **Rewards.** The contract's stake at the pool grows each epoch. Each vault owns its shares of
  it, so a later stake buys in at the new price and gets none of the earlier rewards (Y5).
- **Unstake** (the owner; Y2, Y3). The vault's shares are burned at a fresh price, and the NEAR
  joins the batch now collecting requests.
- **Batches** (Y6). The standard pool restarts its 4-epoch wait for the whole account every time
  it's asked to unstake. So the contract unstakes a batch only when nothing else is unlocking. Once
  that batch unlocks, anyone can call `process_unstaking`. It withdraws the batch, which puts the
  NEAR back into each vault, then unstakes the next. A request waits at most two unlock periods.
- **One pool call at a time** (Y7). A stake or unstake started while another is going through the
  pool is refused with `ERR_STAKING_BUSY`. Callbacks never panic. If the pool refuses, the NEAR goes
  back into the vault.

## Checked

- `cargo test -p bearer staking`: 14 unit tests, including the 256-bit share maths and every
  callback's failure path.
- `contracts/tests/staking.test.ts`: 8 sandbox tests against a mock pool with the standard pool's
  rules (`contracts/mock-pool`: shares, rounding, the 4-epoch wait that restarts). The sandbox runs
  60-block epochs and fast-forwards through them.
- **Testnet, 2026-11-09** (`pnpm spike:staking`). `bearer-v2.testnet` was migrated in place
  ([tx](https://testnet.nearblocks.io/txns/9NJCrYL12A2oK1Srgx12VGwxXWEzAeUm6rYb9Ks3pQ3J)), and its
  3 existing vaults were unchanged. Then, with alice's and bob's test accounts:

| Step | Result | Tx |
|---|---|---|
| alice creates vault No. 0004 and puts 0.8 NEAR in it | sealed, 0.7993 NEAR held | [create](https://testnet.nearblocks.io/txns/2nNrL6fKv66ZXb9UnKHsDGTQ7g5ARtZmLmovLNBtTuPc), [deposit](https://testnet.nearblocks.io/txns/F7Mn8z6AzGpnjtSx7NoSxkvYE6HhdkZZsFASAY9hFoHp) |
| A stranger stakes alice's vault | refused, `ERR_NOT_OWNER` | [Hc31GmEQ…](https://testnet.nearblocks.io/txns/Hc31GmEQrBwYtAgHcDCCYTkRMTnv4tJmteoQFaHdMBLA) |
| alice stakes 0.6 NEAR from the sealed vault | the pool shows `bearer-v2.testnet` staking 0.6 NEAR (5 yoctoNEAR of rounding stays unstaked). The vault is still sealed with 0 signatures, holding 0.1982 NEAR. 17.4 Tgas | [9t4QvMKT…](https://testnet.nearblocks.io/txns/9t4QvMKTKZbm9XhjbZUrfLQta1wDqTLhMPurFhHVgpda) |
| alice withdraws from the sealed vault | refused, `ERR_VAULT_SEALED` | [2E4k5857…](https://testnet.nearblocks.io/txns/2E4k5857ZGaVShKNYg5Nhr9F1gxR7FG3gKV74T5om456) |
| alice hands the vault to bob, then tries to unstake | the transfer went through; her unstake was refused, `ERR_NOT_OWNER` | [transfer](https://testnet.nearblocks.io/txns/4FUZGkzkQySnMMZFm8uyD6ihpoRFkJApvTGgSXY1MMS3), [unstake](https://testnet.nearblocks.io/txns/4JVsmHTX1gFmJzE2g6qHcmcWgjq1AzEpUw6KvPdQtq8e) |
| bob unstakes 0.2 NEAR | nothing else was unlocking, so it went to the pool at once: 0.2 NEAR unstaked there, `can_withdraw: false`, unlocking at epoch 5434. 16.9 Tgas | [7wz1VszP…](https://testnet.nearblocks.io/txns/7wz1VszPSMyrZtvHN6iHVwFHdHYxKd6rjWFBfgskxXh4) |
| bob unstakes 0.1 NEAR more | queued; the pool's unstaked balance didn't change, so the first batch's wait didn't restart. 9.0 Tgas | [8M8dW1za…](https://testnet.nearblocks.io/txns/8M8dW1za3Q3dS4vWCWBzTZuHDa3WFKPgVr18UqhmHX84) |
| Anyone withdraws the batch early | refused, `ERR_NOT_UNLOCKED` | [9kGyGzb2…](https://testnet.nearblocks.io/txns/9kGyGzb2xHuzYqx3pndKaLuSgWu7RtWB4ma8LdJ6GV2d) |

One run (N = 1). Reports:
- [`testnet-staking-migrate-2026-11-09T18-36-59.689Z.json`](../../contracts/tests/spike/reports/testnet-staking-migrate-2026-11-09T18-36-59.689Z.json)
- [`testnet-staking-run-2026-11-09T18-38-14.179Z.json`](../../contracts/tests/spike/reports/testnet-staking-run-2026-11-09T18-38-14.179Z.json)

The run showed one bug: after a batch left the pool, `stake_of`'s `staked_estimate` still used the
reading from before it. It was fixed and redeployed
([tx](https://testnet.nearblocks.io/txns/8crVjGixqsSMbwfDxsPByjGrv1gCij5wxHfUVHZx2FC3)). The site
never used that field: it computes a stake's worth from the pool's own view.

- **Bringing the batch back on testnet, 2026-11-10** (`pnpm spike:staking process`, epoch 5434).
  alice, who doesn't hold the vault, called `process_unstaking`
  ([6dJWHEnD…](https://testnet.nearblocks.io/txns/6dJWHEnD3bQCHCrjTSuiHbdMyZ9aVkhNaxmvwpRTwk5Z)):
  events `batch_withdrawn` then `batch_unstaked`, 15.9 Tgas. Vault No. 0004's NEAR went from 0.1982
  to 0.3982 NEAR, exactly bob's 0.2. `withdrawn_through` is now 1, and the queued 0.1 NEAR is
  unbonding at the pool from epoch 5434, unlocking at epoch 5438. The parent test account couldn't
  send it: the 300 Tgas is paid up front, about 0.30 NEAR, and it held 0.19. N = 1. Report:
  [`testnet-staking-process-2026-11-10T23-01-57.756Z.json`](../../contracts/tests/spike/reports/testnet-staking-process-2026-11-10T23-01-57.756Z.json)
- **Rewards on testnet.** From epoch 5430 to 5434, vault No. 0004's 0.3 NEAR still staked is worth
  0.30012367 NEAR at the pool's price, so 0.00012367 NEAR of rewards so far. That's small: it
  includes the 0.2 unstaked at epoch 5430, and it's one vault at one pool (Y8).
- **Web:** in the simulated demo (one-minute epochs), vault No. 0042 staked 1 NEAR, unstaked 0.4
  (unlocking), then 0.2 (queued behind it).

## Not done yet

- **The second batch.** bob's 0.1 NEAR unlocks at epoch 5438; `pnpm spike:staking process` will
  then withdraw it into vault No. 0004.
- **A reproducible, locked build** of v2, and a real-wallet run.
