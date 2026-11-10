# Spikes

**For:** whoever builds the next contract or SDK piece. What has been proven on testnet, with
measured numbers (N stated) and links you can check. Newest first.

## 2026-11-09 · Bitcoin that changed hands without a Bitcoin transaction, with real coins

On `bearer.testnet`, through the owner's own wallets on the live site:

| Step | Result | Tx |
|---|---|---|
| The owner funds sealed vault No. 0006 | 684,666 sats at `tb1qqtlw…g4g` (testnet4 block 160,224), 1 SOL, 0.001 ETH | [address](https://blockstream.info/testnet4/address/tb1qqtlwr0xlr8ex8qldu3nea5s2kc4ajzrsnd2g4g) |
| `finishr.testnet` creates vault No. 0009, "1st Son College Fund" | sealed, keys set | [7YMBr4VB…](https://testnet.nearblocks.io/txns/7YMBr4VBUJW99szKvjFg1aXJXeqF7RU1HTC2BnHSpQT8) |
| `finishr.testnet` hands sealed No. 0006 to `takaba.testnet` | one NEAR transaction, 4.2 Tgas. Nothing on Bitcoin: the address's whole history is the deposit and the withdrawal below, which spends that same coin (`def9e35c…:0`) | [H3XPWh2n…](https://testnet.nearblocks.io/txns/H3XPWh2n5cvDKaqKS8pY4kSCjXDCaPgG3fp6E8beJJYj) |
| `takaba.testnet` breaks the seal and asks for a Bitcoin withdrawal, in one transaction | events `vault_opened`, `withdrawal_requested` and `withdrawal_signed`; 17.2 Tgas | [3vEJFVpA…](https://testnet.nearblocks.io/txns/3vEJFVpAM5TQjNRz57mmFHsnHPs8QUi65SyQFR4tMpQQ) |
| The signed Bitcoin spend | 300,000 sats to No. 0009's `tb1qw7v4…tzct`, 384,384 sats change back to No. 0006, 282 sats fee. Confirmed in testnet4 block 160,228 | [6002c967…](https://blockstream.info/testnet4/tx/6002c967889d8185b4457837db9c44369b06af0208998cb445a64cea2b5e1e23) |
| `takaba.testnet` asks for a Solana withdrawal | 14.8 Tgas | [4dABcJcu…](https://testnet.nearblocks.io/txns/4dABcJcuWaHzzJA4Z2kaGLqR1qT1c4A9wgjW3bQEqekp) |
| The signed Solana transfer | 0.5 SOL to No. 0009's `2xrCWyaN…diuDW`, fee 5,000 lamports. Finalized in devnet slot 520,527,063 | [5FQ1wbWQ…](https://explorer.solana.com/tx/5FQ1wbWQrcLEpb4aqBgpCb3KC5D1UQvPR1aWFjaeEfLBW3eNqFQp2aLMxMKd4NwSeBy86sznnyDvAgoXe4T5XSqm?cluster=devnet) |

No. 0009 is now a sealed vault holding testnet Bitcoin and SOL, with 0 signatures. N = 1.

## 2026-11-09 · Every flow through browser wallets, including a funded withdrawal

The owner used the live site with two of their own testnet wallets. Read back from the chain:

| Step | Result | Tx |
|---|---|---|
| `finishr.testnet` schedules vault No. 0006 for `takaba.testnet`, cancellable | `deposit_for_schedule` (0.01 NEAR), then `nft_transfer_call` to `bearer-schedule.testnet`; event `scheduled` | [deposit](https://testnet.nearblocks.io/txns/3Kapx6YPAhsAp5HK7sWhQqFYWzE5RsaH8Q4kSEedGPCE), [schedule](https://testnet.nearblocks.io/txns/FcWrDXuxvEWdu7nxyVm3vcWvbGESDUtGKvYxspJ3QXUn) |
| `finishr.testnet` cancels it two minutes later | the vault came back sealed, and the 0.01 NEAR deposit with it; event `cancelled` | [HK2Si4jG…](https://testnet.nearblocks.io/txns/HK2Si4jGa4YBg4DbCUBxEBhXbg74wj68tfLwa8zGiBdf) |
| `takaba.testnet` buys vault No. 0005, listed by `finishr.testnet` at 2 NEAR | event `sold` (price 2 NEAR); the vault moved to the buyer, then the market paid `finishr.testnet` 2.01 NEAR, the price plus the listing deposit | [2wReQN8A…](https://testnet.nearblocks.io/txns/2wReQN8Ajer7Cx93KYFnZyxFncpo2KVQFBT3vTsxnmxm) |

| `takaba.testnet` hands vault No. 0005 back to `finishr.testnet` with `nft_transfer` | 3.8 Tgas; the vault arrived sealed with 0 signatures. Its custody log reads `finishr.testnet` → market → `takaba.testnet` → `finishr.testnet` | [ER7uyXcZ…](https://testnet.nearblocks.io/txns/ER7uyXcZiQsHnz7QoiAGepwx5gJKd4nYZasRHY1BwSxf) |

| `finishr.testnet` breaks the seal on vault No. 0005 and withdraws 0.0002 ETH to `0x9384…edda`, in one transaction | events `vault_opened`, `withdrawal_requested` and `withdrawal_signed`; 16.6 Tgas. The vault is opened, with 1 signature | [9ioTWzeb…](https://testnet.nearblocks.io/txns/9ioTWzebJRgkTaRLG9ZVNQzFKdyX9RSqkxMKwjN4UKwf) |
| The signed transaction on Base Sepolia | from the vault's address `0x9df2…6d4b` to `0x9384…edda`, 0.0002 ETH, nonce 0. Confirmed in block 56,685,109; fee 0.000000126 ETH. The vault's address then held 0.00029987 ETH | [0x1678…5017](https://sepolia.basescan.org/tx/0x167897cae482d693f5a321ec459c3204270efcd735d11bb5ff95c0ea0ab65017) |

Through a wallet, every flow is now done: creating, listing, buying, transferring, scheduling,
cancelling, breaking the seal and withdrawing. It's also the first funded withdrawal from the final
contract to a separate address.

The seller had no way to see the sale on the site, which is why the notifications bell and the
account page exist (docs/features/account.md).

## 2026-11-09 · Two signatures for one nonce on Base Sepolia (T10)

Vault No. 0001 on `bearer.testnet` (opened, held by bob's test account) got 0.0005 Base Sepolia
ETH from the owner. `BEARER_CONTRACT_ID=bearer.testnet pnpm spike:testnet same-nonce 1` then:

1. requested two `withdraw_evm` for nonce 0, paying the vault's own address 1,000 and 2,000 gwei
   (withdrawals 15 and 16, [signed](https://testnet.nearblocks.io/txns/45FpKwNt4KrjSLJiudXC94tEoFpupx6cMxKWHq5199Qj)
   [twice](https://testnet.nearblocks.io/txns/7bW2Nvxza4zZhMyMAb1eGkpLnESdvd6Ns3398TtNDahE)), as a
   retry after a timeout could leave them;
2. broadcast both at once. Base Sepolia accepted the first and confirmed it in block 56,635,535
   ([0xcda9…ed00](https://sepolia.basescan.org/tx/0xcda94fc2657424ccc34d972c4015e517f12a75bfaca0aeeeea52d7b89ffded00));
   it refused the second (`0xec7e7f86…8b60`, "replacement transaction underpriced");
3. 17 s later the second, read again from the contract's public view, was sent again: "nonce too
   low: next nonce 1, tx nonce 0". It can never confirm.

The vault's nonce went from 0 to 1, and its balance fell by the fee only (126,000,000,095 wei),
since it paid itself. N = 1. Report:
[`base-same-nonce-2026-11-09T18-29-49.254Z.json`](../contracts/tests/spike/reports/base-same-nonce-2026-11-09T18-29-49.254Z.json).

## 2026-11-09 · A sealed handover: time to final and cost

`BEARER_CONTRACT_ID=bearer.testnet pnpm spike:testnet handover 7 6` handed sealed vault No. 0007
between alice's and bob's test accounts six times with `nft_transfer`. N = 6:

- **Final after** a median 4.6 s (4.0–5.8 s), timed on a laptop from sending the signed
  transaction to the RPC answering with `wait_until: FINAL`. That includes the round trip to the
  RPC, so the chain itself is faster.
- **Gas** 3.97–4.04 Tgas each (it grows slightly as the custody log fills up), which is 0.0004 NEAR
  at testnet's gas price of 100,000,000 yoctoNEAR per gas.
- After every handover the vault was sealed with 0 signatures requested. Nothing moved on Bitcoin,
  Base or Solana, so there was no fee there.

Report: [`testnet-handover-2026-11-09T18-05-40.934Z.json`](../contracts/tests/spike/reports/testnet-handover-2026-11-09T18-05-40.934Z.json).

## 2026-11-09 · Scheduled handover, on the locked contract

`bearer-schedule.testnet` (faucet-created) runs `contracts/res/schedule.wasm`, the reproducible
build of `47b5d25`: two builds from a clean checkout gave identical bytes (sha256
`83c2ea97…a247`); on-chain code hash `9sLo27AU…JSkE`, which matches. It sells nothing: it holds a
sealed `bearer.testnet` vault until a date, then hands it to the recipient chosen at scheduling.
Locked the same day (S10): `CONFIRM_LOCK=bearer-schedule.testnet pnpm spike:schedule lock`
checked the code hash, then deleted its one full-access key
([tx](https://testnet.nearblocks.io/txns/6wAyfjD218s7DvCwuzK7nEtAdLDQK5eZujY3caDJRekx)). Afterwards
three RPCs (rpc.testnet.near.org, test.rpc.fastnear.com, archival-rpc.testnet.fastnear.com)
reported 0 keys and the same code hash. Report:
[`testnet-schedule-lock-2026-11-09T16-11-33.926Z.json`](../contracts/tests/spike/reports/testnet-schedule-lock-2026-11-09T16-11-33.926Z.json).

`pnpm spike:schedule run`:
- A cancellable schedule (No. 0008) was cancelled and the vault returned.
- An early release was refused (`ERR_TOO_EARLY`).
- Cancelling an irrevocable schedule was refused (`ERR_NOT_CANCELLABLE`).
- The giver breaking the seal on a scheduled vault was refused (`ERR_NOT_OWNER`).
- On the date, a third account released No. 0007 to bob ([tx](https://testnet.nearblocks.io/txns/76eGYPzRDspJi3YXLXVGU1zDnj8wcNF14kSz8Vu2HUpt)):
  - it arrived sealed with 0 signatures;
  - custody shows alice, then the schedule, then bob;
  - alice's balance rose by exactly the 0.01 NEAR deposit.
- No. 0002, scheduled for an unregistered name, stayed put on release (`recipient_missing`,
  [tx](https://testnet.nearblocks.io/txns/zaDjCK5w2x8MQG87vhQ3pL6VWdQPSymutSGDKL5NqUZ)), and went to that account once it existed
  ([tx](https://testnet.nearblocks.io/txns/9fVdTyuJWyabMsZMbe17p1t2wv2MqJYwMUmooxbFBisB)).

Release took 15.2 Tgas and scheduling 9.0–9.3 Tgas, one run each. Report:
[`testnet-schedule-2026-11-09T14-37-57.715Z.json`](../contracts/tests/spike/reports/testnet-schedule-2026-11-09T14-37-57.715Z.json).

An earlier attempt the same day also handed No. 0002 to bob and showed No. 0004 waiting for
`nobody.…` until that account was created; its script stopped on the expected failed account
check before saving a report, so it isn't counted as evidence.

## 2026-11-09 · v2 staking with a real pool

`bearer-v2.testnet` was migrated in place to the staking build (3 vaults kept) and stakes with
`stakely_v2.pool.f863973.m0`: standard pool code, no access keys, a 3% fee. In `pnpm spike:staking
run`:
- **Staking.** alice staked 0.6 NEAR from a sealed vault (No. 0004) in 17.4 Tgas. The pool then
  showed the contract staking 0.6 NEAR less 5 yoctoNEAR of rounding.
- **Refused:**
  - a stranger staking it;
  - alice withdrawing while it was sealed;
  - alice unstaking after handing it to bob.
- **Unstaking.** bob's first unstake (0.2 NEAR, 16.9 Tgas) went straight to the pool, unlocking at
  epoch 5434. His second (0.1 NEAR) queued, and the pool's unstaked balance didn't change. An early
  withdrawal was refused (`ERR_NOT_UNLOCKED`).

N = 1. Details and links: [docs/features/staking.md](features/staking.md).

## 2026-11-09 · First vaults created and listed through a browser wallet

The owner used their own testnet account, `finishr.testnet`, on https://bearer-near.vercel.app
(near-connect, testnet mode, against `bearer.testnet` and `bearer-market.testnet`). Read back from
the chain afterwards:

| Step | Result |
|---|---|
| Create | Two `create_vault` calls ([No. 0005](https://testnet.nearblocks.io/txns/J8a6kuCnezWVEQerAvJTkY1pnnGjabRm39ZgbRhTNJHo), [No. 0006](https://testnet.nearblocks.io/txns/76ZVYp3sHgJ6sduZ7zLz5RqWDSsRAqsVrHejZ5TeB1d9)). Both vaults sealed, with the signer's keys stored |
| List | `deposit_for_listing` (0.01 NEAR, [tx](https://testnet.nearblocks.io/txns/6EYwtNXGeJ8TLLMyZs6ExXDqEC6AvkxUj8PXaGFaBDPf)), then `nft_transfer_call` to the market at 2 NEAR ([tx](https://testnet.nearblocks.io/txns/8GBRkYobpx3JiQHkrgKjmMYWfKCYXfE5ocgS8i6u7mX1)), 1.8 s apart: the site asks the wallet for both in one request |
| After | Vault No. 0005 ("Obsidian") held by the market for `finishr.testnet`, sealed, 0 signatures, for sale at 2 NEAR |

This is the first time a human wallet, rather than a key-backed test account, signed Bearer
transactions through the site. Not yet done through a wallet: transfer, breaking the seal,
withdrawing, buying.

## 2026-11-09 · The attack lab's attacks, as real transactions on the locked contract

`pnpm spike:testnet attacks` sent each of the attack lab's five attacks to `bearer.testnet` from
the test accounts, with the normal deposits and 100 Tgas so that each one reaches the check it
targets. Vault No. 0001 is opened and bob's; No. 0004 is sealed and bob's (bought on the market);
alice held both before him.

| Attack | Sent by | Answer | Tx |
|---|---|---|---|
| Former owner withdraws: `withdraw_evm(vault 1)` | alice | `ERR_NOT_OWNER` | [F9X8pHP1…](https://testnet.nearblocks.io/txns/F9X8pHP1m2dKZq1JqZixnC9uao9gLL9YusifzEeo8RHz) |
| Former owner breaks the seal: `break_seal(vault 4)` | alice | `ERR_NOT_OWNER` | [2BQmo5kJ…](https://testnet.nearblocks.io/txns/2BQmo5kJmdRxMyaRUbT8zvT56jGMsh3ZZCCexqCPA6Zm) |
| Transfer an opened vault: `nft_transfer(vault 1)` | bob | `ERR_VAULT_OPENED` | [6GutSDN8…](https://testnet.nearblocks.io/txns/6GutSDN8MNpS4vq1FGAHeusLehLSpgz7aS4f9VUpA7Ed) |
| Withdraw from a sealed vault: `withdraw_evm(vault 4)` | bob | `ERR_VAULT_SEALED` | [44XdgiB2…](https://testnet.nearblocks.io/txns/44XdgiB2NDJYBrh5mx2PJZd5Z3hRfJR5gVPhXWFMKPP8) |
| Ask for a raw signature: `sign(32 bytes)` | bob | `MethodNotFound` | [4FA4AK5p…](https://testnet.nearblocks.io/txns/4FA4AK5psEtSx1h8fW2P5DRM43HV5AnWYwMmhi88QLHv) |

None of the transactions has a receipt on `v1.signer-prod.testnet`, and both vaults' owners,
seals and signature counts are unchanged afterwards. 1.4–2.3 Tgas each. Report:
[`testnet-attacks-2026-11-09T12-34-55.181Z.json`](../contracts/tests/spike/reports/testnet-attacks-2026-11-09T12-34-55.181Z.json).
The site's attack lab on testnet re-reads these five transactions from FastNEAR's archival RPC in
the visitor's browser (regular nodes forget transactions after a few epochs), so the refusals it
shows are the chain's, not a copy.

## 2026-11-09 · The market's first sale, on the locked contract

`bearer-market.testnet` (faucet-created) runs `contracts/res/market.wasm`, the reproducible build of
`579df21`: two builds from a clean checkout gave identical bytes (sha256 `641ce46c…71ce`); on-chain
code hash `7joKh4WS…qt7P`, which matches. It was initialised with `nft_contract = bearer.testnet` and
a 0.01 NEAR listing deposit ([tx](https://testnet.nearblocks.io/txns/WoVQHNTwGGRzMUqPdcNrh8QzdMikeVneAaDN1Zt3JHZ)).
It was locked after the sale (below), so nothing about it can change.

| Step | Result |
|---|---|
| Listing deposit | alice, 0.01 NEAR ([tx](https://testnet.nearblocks.io/txns/8j5C1Xiw3NUHAZABBJnaLTqzAYkkDtwLDuFdnt6rh4uT)) |
| List | alice sent vault No. 0004 (sealed) with `nft_transfer_call`, price 0.1 NEAR: 8.9 Tgas, events `nft_transfer`, `listed`, no failed receipts ([tx](https://testnet.nearblocks.io/txns/75Gdpx1BKNyi2qWGn7XuGVmQ9yH1mkYi3K3B4QRPoGk8)) |
| Buy | bob attached 0.1 NEAR: 11.5 Tgas, events `nft_transfer`, `sold`, no failed receipts ([tx](https://testnet.nearblocks.io/txns/GCuy9zAFHGeN8ZsjgvUyaF8Uzz4xvW4UvNessKMMYv6F)) |
| After | Vault No. 0004: owner bob, sealed, 0 signatures; custody alice → market → bob; no listing left |
| Seller paid | alice's balance rose by exactly 0.11 NEAR (price + deposit), read once pending receipts had landed; she signed nothing in between |

One run each (N = 1). Report:
[`testnet-market-sale-2026-11-09T12-21-46.716Z.json`](../contracts/tests/spike/reports/testnet-market-sale-2026-11-09T12-21-46.716Z.json).
The script first recorded a "final after" time that also included waiting for alice's balance to
settle, so it measured nothing useful; it was removed from the report and the script now times the
purchase to finality only.

```bash
cd contracts/tests
pnpm spike:market setup
pnpm spike:market sale 4 0.1
```

**Locked**, with the owner's go-ahead: `CONFIRM_LOCK=bearer-market.testnet pnpm spike:market lock`
checked the deployed code hash against `contracts/res/market.wasm`, then deleted the only key, a
full-access key ([tx](https://testnet.nearblocks.io/txns/G8t9cc9xKa7ymc84hCtk8xeRG2JKBao8auFLKLg1SHVK)). `view_access_key_list` returns no keys on both
`rpc.testnet.near.org` and `test.rpc.fastnear.com`. Report:
[`testnet-market-lock-2026-11-09T13-01-47.736Z.json`](../contracts/tests/spike/reports/testnet-market-lock-2026-11-09T13-01-47.736Z.json).

## 2026-11-09 · `bearer.testnet` locked

With the owner's go-ahead, `CONFIRM_LOCK=bearer.testnet BEARER_CONTRACT_ID=bearer.testnet
BEARER_WASM=../res/bearer.wasm pnpm spike:testnet lock` checked that the deployed code hash was
the reproducible build's (`PEsHBVDK…Vq1S`), then deleted the account's only access key, a
full-access key, in one transaction ([tx](https://testnet.nearblocks.io/txns/J87dPH7D1LG7PLwvyzqwFbBKMsQ7pAd7Nxfn1DrvsaVT)).
Afterwards `view_access_key_list` returns no keys, read from both `test.rpc.fastnear.com` and
`rpc.testnet.near.org`; the code hash, settings, `base_uri` and the four vaults are unchanged.
Nobody can change the code, settings or `base_uri` again, or move the account's NEAR. Report:
[`testnet-lock-2026-11-09T11-42-33.968Z.json`](../contracts/tests/spike/reports/testnet-lock-2026-11-09T11-42-33.968Z.json).

The hosted site now reads this contract; its measured runs and landed withdrawals stay labelled as
the spike contract's.

## 2026-11-09 · `bearer.testnet`: the final contract, reproducibly built, deployed and checked

`bearer.testnet` was created through NEAR's testnet faucet service (10 NEAR), initialised with
the spike's settings and `base_uri` `https://bearer-near.vercel.app/nft` (each token's media is
the site's live image of its seal), then redeployed in place with the reproducible build:

| | |
|---|---|
| Source | commit [`71f194e`](https://github.com/successaje/bearer/tree/71f194ec6a5ade7fd8f3bc37b30b11c47981652d), `contracts/bearer` |
| Build | `cargo near build reproducible-wasm --manifest-path contracts/bearer/Cargo.toml` (cargo-near 0.22.0) in `sourcescan/cargo-near:0.22.0-rust-1.98.1@sha256:90cf2abe…cb8a` |
| Output | `contracts/res/bearer.wasm`, 344,850 bytes, sha256 `05b2750673387a0328157935c7238cc810016bb081a1bf639782a50e59248619` |
| Rebuilt | twice, each from a fresh clone in a fresh container: identical bytes |
| On chain | code hash `PEsHBVDKpZ3fdpmfsJekrt52amLARnwRLWNXLQDVq1S` = base58(sha256(wasm)); `contract_source_metadata` names the image, command, commit and standards (NEP-171, 177, 181, 297, 330) |

Locked afterwards (above). Same signer
(`v1.signer-prod.testnet` 3.18.0) and RPC as the spike; same test accounts. Checks on the
reproducible build:

| Check | Result |
|---|---|
| Keys at creation | Vault No. 0003: keys visible 5.9 s after submitting (N = 1), 25.3 Tgas ([tx](https://testnet.nearblocks.io/txns/FDWrG7iFQDVAj8gLU63LJttfSgVFVESy8o9headRkVKU)) |
| Parity | All three stored keys equal the signer's own `derived_public_key`; the stored Base address equals viem's |
| Base, through the contract | 5 of 5 signed, **median 7.6 s** (N = 5, range 6.9–8.6 s). Each recovers to the vault on chain 84532, nonces 0–4. 14.4 Tgas each, 16.6 with `break_seal`. Not broadcast: the vault's Base address holds no ETH |
| Ed25519, called directly | 5 of 5 verify, **median 7.5 s** (N = 5, range 6.9–8.2 s), 8.5 Tgas each |
| Gas floor | 40 Tgas refused with `ERR_GAS` (panic messages survive this build); 44 Tgas stored the keys of vault No. 0004 ([tx](https://testnet.nearblocks.io/txns/FxzNc9taGhXY1nJH3ZVZqanQmqgfDHi1DqvZEzLkVhB3)) |
| Bitcoin, joined signatures | Vault No. 0001: 1–4 inputs signed in 7.4–8.2 s (one run each), 14.9–42.4 Tgas, callback 2.7–4.3 Tgas; every spend checked with bitcoinjs-lib. Made-up inputs, never broadcast |
| Solana | Vault No. 0001: signed in 7.7 s (N = 1), 14.6 Tgas, checked with `@solana/web3.js`; devnet's simulation stops at `AccountNotFound` because the vault holds no SOL |

```bash
cd contracts/tests
BEARER_CONTRACT_ID=bearer.testnet BEARER_WASM=../res/bearer.wasm pnpm spike:testnet redeploy
BEARER_CONTRACT_ID=bearer.testnet pnpm spike:testnet run
```

Raw numbers:
[`testnet-sign-2026-11-09T11-36-50.011Z.json`](../contracts/tests/spike/reports/testnet-sign-2026-11-09T11-36-50.011Z.json),
[`testnet-btc-joined-2026-11-09T11-39-24.300Z.json`](../contracts/tests/spike/reports/testnet-btc-joined-2026-11-09T11-39-24.300Z.json),
[`testnet-sol-withdraw-2026-11-09T11-39-37.556Z.json`](../contracts/tests/spike/reports/testnet-sol-withdraw-2026-11-09T11-39-37.556Z.json).
The same checks passed earlier that day on the first deploy, the `build.sh` wasm (code hash
`BwzhMbAg…RMLG`, empty `build_info`), which made vaults No. 0001 and 0002:
[`testnet-sign-2026-11-09T09-00-46.070Z.json`](../contracts/tests/spike/reports/testnet-sign-2026-11-09T09-00-46.070Z.json),
[`testnet-btc-joined-2026-11-09T09-03-48.362Z.json`](../contracts/tests/spike/reports/testnet-btc-joined-2026-11-09T09-03-48.362Z.json),
[`testnet-sol-withdraw-2026-11-09T09-04-10.188Z.json`](../contracts/tests/spike/reports/testnet-sol-withdraw-2026-11-09T09-04-10.188Z.json).

Withdrawals land on other chains only once these vaults' addresses hold funds.

## 2026-11-09 · First Solana withdrawal broadcast from an opened vault

After the human funded vault No. 0002's Solana address with 0.5 devnet SOL, `pnpm spike:testnet
sol-withdraw 2` signed a new withdrawal and broadcast it:

| | |
|---|---|
| Withdrawal | `withdraw_sol` by `bob.` on vault No. 0002 (opened): 1,000 lamports from the vault to itself, with a fresh finalized blockhash |
| Signed after | 7.7 s from submitting, through NEAR's MPC Ed25519 domain; checked in the callback with `env::ed25519_verify` (N = 1) ([NEAR tx](https://testnet.nearblocks.io/txns/7K7pbrjU9h7vXZHzuJkjTgVoga53NvMrFnjgAsFW3bBt)) |
| Gas | 14.7 Tgas for the whole transaction |
| Checked before broadcast | `@solana/web3.js`: signature valid, the vault pays the fee, exactly one instruction |
| Transaction | **[`jQCk6nNL…grmt`](https://explorer.solana.com/tx/jQCk6nNLGvbAfkrxGizGhvqiUpnUZeA4b58tU3SEFdNA3La2g5PqTY6uod3zWMJk7yB9wfvZebVzFa73oEdgrmt?cluster=devnet)** on Solana devnet |
| Result | **Finalized** in slot 520,280,234 (2026-11-09 05:43 UTC), no error. One system transfer, the vault the only signer, fee 5,000 lamports. Devnet reported it finalized 1.4 s after `sendTransaction` (N = 1, polled every second) |

Read back with `getTransaction` at `finalized` commitment, independently of the script. With this,
withdrawals from opened vaults have landed on all three chains: Base, Bitcoin and Solana. Raw
numbers: [`testnet-sol-withdraw-2026-11-09T05-43-03.639Z.json`](../contracts/tests/spike/reports/testnet-sol-withdraw-2026-11-09T05-43-03.639Z.json).

## 2026-11-08 · First Bitcoin withdrawal from an opened vault

The full Bitcoin story on testnet4, run by `pnpm spike:testnet btc-withdraw 4` as soon as the
human's deposit confirmed:

1. Vault No. 0004, sealed and held by `alice.`, received 0.00265715 tBTC
   ([funding tx](https://mempool.space/testnet4/tx/408c696c0f5b892b03500e08905fca15657fa12d457aa157108212331a2994aa),
   confirmed in block 159,945).
2. `alice.` transferred the vault to `bob.`
   ([NEAR tx](https://testnet.nearblocks.io/txns/BdKaeEoa14LRBG2W9YXAPEZVwVihUTMiQSUHusWTiHjk)). Nothing
   moved on Bitcoin.
3. `bob.` broke the seal and withdrew in **one NEAR transaction**
   ([NEAR tx](https://testnet.nearblocks.io/txns/hVm36gP4mzWCETMMtuXEg33hGCnuj1aAdrzxeF9iW9F)): one coin in,
   132,716 sats to the destination (the vault's own address, for this test) and 132,717 sats change
   back to the vault, fee 282 sats (2 sat/vB, 141 vB). NEAR's MPC signed it 6.5 s after submitting
   (N = 1); 17.4 Tgas for the whole transaction.
4. bitcoinjs-lib verified the spend; Blockstream's Esplora accepted the broadcast:
   **[`ce01f9ff…58b6`](https://mempool.space/testnet4/tx/ce01f9fffdf0f362641a4f6882257295ae63de6146c5a3478704ef809bf958b6)**
   ([alt](https://blockstream.info/testnet4/tx/ce01f9fffdf0f362641a4f6882257295ae63de6146c5a3478704ef809bf958b6)).
5. **Confirmed** in testnet4 block 159,948 (2026-11-08 23:49 UTC).

This meets D3's checkpoint in brief 7.2: a real Bitcoin withdrawal signed and broadcast. Raw
numbers: [`testnet-btc-withdraw-2026-11-08T23-32-00.077Z.json`](../contracts/tests/spike/reports/testnet-btc-withdraw-2026-11-08T23-32-00.077Z.json).

## 2026-11-08 · Solana: a withdrawal signed through the contract

`withdraw_sol` on vault No. 0002 (opened, held by `bob.`), with a fresh devnet blockhash: a
1,000-lamport transfer from the vault to itself. NEAR's MPC signed it with its Ed25519 domain and
the callback checked the signature with `env::ed25519_verify` (N = 1).

| | |
|---|---|
| Signed after | 8.3 s from submitting ([tx](https://testnet.nearblocks.io/txns/AWiMXRvuX3sRdVEmbcQ76TfEJahjuRE3yZssj26hpsvu)) |
| Gas | 14.8 Tgas for the whole transaction |
| Checked | `@solana/web3.js`: signature valid, the vault pays the fee, exactly one transfer |
| Devnet simulation (`sigVerify: true`) | Passed signature checks; stopped at `AccountNotFound` because the vault holds no SOL yet |

Devnet's RPC airdrop is closed ("Request test SOL at https://faucet.solana.com"), so funding
needed the human. **Funded and done** (see "First Solana withdrawal" above): once
`Dgx8782F7YJYYYYsKuk1uhdyPbvnu2DNRFrfKKGKgUKn` holds devnet SOL,

```bash
cd contracts/tests && pnpm spike:testnet sol-withdraw 2
```

signs a new withdrawal and broadcasts it. Raw numbers:
[`testnet-sol-withdraw-2026-11-08T22-51-57.356Z.json`](../contracts/tests/spike/reports/testnet-sol-withdraw-2026-11-08T22-51-57.356Z.json).

## 2026-11-08 · Bitcoin: joined signatures on the real signer (spike 1, Bitcoin part)

`withdraw_btc` asks for one signature per input and joins the requests with `Promise::and` into a
single callback, which checks every signature against the vault's key before assembling the
transaction. Run on vault No. 0002 (opened, held by `bob.`) against `v1.signer-prod.testnet`
3.18.0, one request per input count (N = 1 each). The inputs were made up: the contract can't see
UTXOs, so the signer is exercised exactly as for real coins, and these transactions are never
broadcast. Each signed spend was checked with bitcoinjs-lib (every BIP143 sighash) and noble
(every DER signature, low S).

| Inputs | Signed after | Whole transaction | Callback | Spend size | NEAR tx |
|---|---|---|---|---|---|
| 1 | 8.4 s | 15.1 Tgas | 2.8 Tgas | 141 vB | [6sgH…DfBUg](https://testnet.nearblocks.io/txns/6sgHQHE1ZF7oyANs12vo51ZjBKAwbft4ZLdSod8DfBUg) |
| 2 | 6.6 s | 24.2 Tgas | 3.3 Tgas | 209 vB | [ERyC…ivbsDp](https://testnet.nearblocks.io/txns/ERyCn7csjhWSHAFGW4e7R1628K9SkQxPCSsa6PivbsDp) |
| 3 | 7.8 s | 33.4 Tgas | 3.9 Tgas | 277 vB | [CcfM…AhHWJ](https://testnet.nearblocks.io/txns/CcfMaWKDeUKCw2HYQ9Ku7yFU8gw5KHuSNkgTkidAhHWJ) |
| 4 | 7.1 s | 42.6 Tgas | 4.4 Tgas | 345 vB | [36qY…dkE3g](https://testnet.nearblocks.io/txns/36qY45goGQa5ugznPh9ixF2ENVLshfY9ZnYcG23dkE3g) |

Each extra input adds about 9.2 Tgas (the signer's `sign` 4.2 + 3.4 on resume, plus the contract's
share). Four inputs use 42.6 of the 300 Tgas a transaction may carry, so `max_btc_inputs` stays at
4 with plenty of room; `GAS_FOR_BTC_CALLBACK` (30 Tgas) covers the measured 4.4 several times over.
Raw numbers: [`testnet-btc-joined-2026-11-08T22-26-24.540Z.json`](../contracts/tests/spike/reports/testnet-btc-joined-2026-11-08T22-26-24.540Z.json).

**Funded and done** (see "First Bitcoin withdrawal" above). Vault No. 0004 was sealed and held by `alice.`; its Bitcoin address,
`tb1qf6fqncrezc8qu8lpg5pqqssv3jaxkxkpjkxqjp`, was checked three ways (contract, signer's derived
key, bitcoinjs-lib). Once it holds confirmed testnet4 coins:

```bash
cd contracts/tests && pnpm spike:testnet btc-withdraw 4
```

transfers it to `bob.`, has bob break the seal and withdraw in one NEAR transaction, verifies the
spend and broadcasts it. `mempool.space` didn't answer from this machine, so the script uses
Blockstream's testnet4 Esplora API (`ESPLORA_API` to change it).

## 2026-11-08 · First Base withdrawal broadcast from an opened vault

Vault No. 0002 on `v3a.bearer-1108-ffb3.testnet` was opened by `bob.bearer-1108-ffb3.testnet`, and
its withdrawal #0 was signed by NEAR's MPC network (section below). After the human funded the
vault's Base address with 0.0001 ETH, the stored transaction was read from the contract's public
`withdrawals` view, checked to recover to the vault's address, and broadcast:

| | |
|---|---|
| Transaction | [`0xb347…20e3`](https://sepolia.basescan.org/tx/0xb347d755df6105ef2deb58158533f31fa5687586992308ee2fed0e4622ee20e3) on Base Sepolia, block 56,270,095 |
| From → to | `0xc1ABcBdD132e2D965772351FA1193688Db162939` (the vault) → itself, 0.000001 ETH |
| Result | Success, 21,000 gas, nonce 0 → the vault's nonce is now 1 |
| Receipt | 2.0 s after `eth_sendRawTransaction` (N = 1) |

```bash
cd contracts/tests && pnpm spike:testnet broadcast 2 0
```

This meets D2's acceptance in brief 7.2: one real Base withdrawal from an opened vault. The vault
still holds signed transactions for nonces 1–4, which anyone can broadcast in order.

## 2026-11-08 · Signing on testnet (brief 7.3, spikes 1, 4 and 5)

**Setup.** Contract `v3a.bearer-1108-ffb3.testnet` (spike account, not locked), the real MPC signer
`v1.signer-prod.testnet`, RPC `https://test.rpc.fastnear.com`. Accounts `alice.` and
`bob.bearer-1108-ffb3.testnet` play the sender and recipient. Script:
[`contracts/tests/spike/testnet-sign.ts`](../contracts/tests/spike/testnet-sign.ts); raw numbers:
[`testnet-sign-2026-11-08T21-40-03.590Z.json`](../contracts/tests/spike/reports/testnet-sign-2026-11-08T21-40-03.590Z.json).

```bash
cd contracts/tests
pnpm spike:testnet setup    # subaccounts, deploy, init (skips what exists)
pnpm spike:testnet run      # create, transfer, 5 × break/withdraw, 5 × Ed25519
pnpm spike:testnet gas-floor
```

### Results

| Check | Result |
|---|---|
| Signer pointers (brief 4.2) | `version` 3.18.0. Domain 0 is secp256k1 (CaitSith), domain 1 Ed25519 (Frost). `derived_public_key({path, predecessor, domain_id})` and `sign({request: {path, payload_v2, domain_id}})` take the shapes the contract sends. |
| **Spike 4:** keys at creation | `create_vault` fetched all three derived keys by cross-contract call. Keys visible 6.5 s after submitting (N = 1). Whole transaction 24.2 Tgas; each `derived_public_key` 5.29–5.37 Tgas; `on_derived_keys` 2.03 Tgas; `create_vault` itself 4.69 Tgas. Storage: 1,060 bytes for a vault with a 32-byte name and one custody entry. [tx](https://testnet.nearblocks.io/txns/HVMgfMrjDH5QPycMKYt4BmiLFdSSvWzf87LT3N2kJ5Kn) |
| **Spike 5:** parity | The stored Bitcoin, Base and Solana keys equal the signer's own `derived_public_key(contract, path)` for all three. The stored `evm_address` equals viem's address for the stored key. |
| **Spike 1:** domain 0 through the contract | 5 of 5 `withdraw_evm` requests signed. Run 1 sent `break_seal` and `withdraw_evm` as two actions in one transaction. **Median 7.7 s** from submitting to the signed transaction showing in `withdrawals` (N = 5, range 7.4–8.4 s). Every signed transaction recovers to the vault's address, on chain 84532, type 2, nonces 0–4. Gas per withdrawal 14.5 Tgas (16.7 with `break_seal`): contract 3.0, signer `sign` 4.27 + 3.46 on resume, `on_evm_signed` 2.5. |
| **Spike 1:** domain 1, called directly | 5 of 5 Ed25519 signatures verify against `derived_public_key(alice, path, 1)`. **Median 8.0 s** to the final outcome (N = 5, range 7.4–8.1 s). 8.5 Tgas each. |
| Base Sepolia accepts the format | `eth_sendRawTransaction` with run 1's transaction was refused only for balance: `insufficient funds for gas * price + value: have 0 want 43000000000000`. So the encoding and signature parse, and the sender recovers as the vault. |
| **Spike 3**, protocol level | `break_seal` + `withdraw_evm` in one transaction works and is atomic in the sandbox test. Wallet support through near-connect is not tested yet. |

Latency is measured by polling the RPC every 500 ms, so each figure includes up to half a second
of polling. An earlier, aborted run through `rpc.testnet.near.org` took 16.2–16.8 s for the same
step before that endpoint rate-limited it (HTTP 429); no report was saved from it.

### What changed because of it

- `GAS_FOR_DERIVED_KEY` went from 5 to 8 Tgas: the real signer burns more than 5, and the first run
  only worked because spare gas was shared out.
- `create_vault` now refuses less than 44 Tgas with `ERR_GAS`, so a wallet can't mint a vault whose
  key requests run short. Checked on testnet after redeploying: 40 Tgas refused, 44 Tgas stored the
  keys ([tx](https://testnet.nearblocks.io/txns/62WxydYMo6shiAwGfgH4C86e5Yn2547A71j7nNAWDi4i)).
  Sandbox test `create_vault_requires_gas_for_keys`.
- The SDK's testnet adapter must attach at least 44 Tgas to `create_vault` and 50 Tgas to each
  `withdraw_evm`.

### Still open from 7.3

- ~~**Spike 1, Bitcoin part**~~: done (joined signatures, above).
- ~~**Spike 2**~~: decided against omni-transaction; Bitcoin is hand-rolled like EVM (docs/DECISIONS.md).
- **Spike 3** through real wallets (near-connect).
- **Spike 5** against chainsig.js: compared with the signer's view here; the chainsig.js check
  comes with the SDK's `deriveAddresses`.
- ~~**Spike 6, faucets**~~: Base Sepolia ETH, testnet4 BTC and devnet SOL were all funded by the
  human, and each chain has a confirmed withdrawal (above).
