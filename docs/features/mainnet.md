# Feature: one vault on mainnet

**Branch:** `main`, built on `next` · **Where:** `contracts/tests/spike/mainnet.ts` (`pnpm spike:mainnet`) and the
token images at `/nft/mainnet/{id}.svg` · **Contract:** `contracts/res/bearer.wasm`, the build
locked on `bearer.testnet`, on a mainnet sub-account of the project's owner · **Status:** tooling
built on 18 Nov 2026, while judging ran, and on `main` since 28 Nov 2026; not run on mainnet yet

**For:** whoever checks that Bearer works with real money, not only testnet coins, and whoever runs
the steps. What it proves, what it costs, and the commands.

## What it proves

One vault on NEAR mainnet, holding real ETH on Base, handed from one account to another while
sealed. The new holder opens it, and NEAR's MPC network signs a real Base transfer out of it. It's
the same claim as on testnet (whoever held a vault before can't take what's inside) with real
money behind it.

## Same code as testnet

Mainnet runs the exact bytes locked on `bearer.testnet`: `contracts/res/bearer.wasm`, cargo-near
0.22.0's reproducible build of `71f194e` (code hash `PEsHBVDK…Vq1S`). Only its settings, fixed at
`new`, differ:

| Setting | `bearer.testnet` | mainnet |
|---|---|---|
| Signer | `v1.signer-prod.testnet` | `v1.signer` |
| EVM chains | 84532 (Base Sepolia) | 8453 (Base) |
| Deposits | 0.05 NEAR a vault, 0.01 NEAR a withdrawal, 1 yoctoNEAR a signature | the same |
| Token images | `https://bearer-near.vercel.app/nft` | `https://bearer-near.vercel.app/nft/mainnet` |

Mainnet's signer runs the same code as testnet's (code hash `GyLc4x4i…`, version 3.19.0 on mainnet
on 18 Nov 2026), so the calls Bearer makes are the ones already measured on testnet.

**Not on mainnet:**
- **Bitcoin.** The build refuses `bc1` addresses on purpose: it was made for testnet4.
- **Solana.** It would work, since Solana transactions don't name their cluster, but this run uses
  Base.
- **The market, schedule, lending, switch, standing payments and vault names.**

## Who runs what

Every step that spends NEAR or moves ETH is run by the owner of the accounts, from their own
machine, with their own keys in `~/.near-credentials/mainnet`. Each such step refuses to run
unless `CONFIRM_MAINNET` names it. The steps that only read (`plan`, `status`) need nothing.
Claude Code wrote the script and checks the results; it doesn't send or move funds.

## Costs

| Step | Who pays | Real cost |
|---|---|---|
| `deploy` | the parent account | 3.6 NEAR sent to the contract account. About 3.45 NEAR pays for the code's storage; after the lock nobody can take any of it out |
| `create` | the holder | 0.05 NEAR for the vault's storage, and about 0.01 NEAR of gas |
| deposit | the holder, from their own wallet | a little ETH on Base, such as 0.0005 ETH |
| `handover` | the holder | 1 yoctoNEAR and about 0.001 NEAR of gas |
| `withdraw` | the recipient | 0.01 NEAR + 1 yoctoNEAR for the withdrawal record, and about 0.02 NEAR of gas |
| `broadcast` | the vault's own ETH | Base gas and the L1 data fee: about 0.0000003 ETH set aside, mostly unused |

## The steps

From `contracts/tests` in a checkout of `next`, with both accounts' keys imported (near-cli-rs:
`near account import-account`, saved to the legacy keychain):

```bash
export MAINNET_PARENT=you.near MAINNET_RECIPIENT=your-second-account.near
```

1. `pnpm spike:mainnet plan`: reads everything and spends nothing. Checks that the build is the one
   `bearer.testnet` runs, the signer's version, that Base answers as chain 8453, and that both
   accounts exist and have keys on this machine.
2. `CONFIRM_MAINNET=deploy pnpm spike:mainnet deploy`: creates `bearer.<parent>`, deploys the build
   and initialises it. Its key is saved to `~/.near-credentials/mainnet` before the account exists.
3. `CONFIRM_MAINNET=create pnpm spike:mainnet create`: the parent mints vault No. 1, sealed, and
   the script prints its Base address.
4. Send a little ETH to that address on Base, from your own wallet. Check it with
   `pnpm spike:mainnet status`.
5. `CONFIRM_MAINNET=handover pnpm spike:mainnet handover`: hands the vault to the second account,
   only if it's still sealed with 0 signatures and holds ETH.
6. `CONFIRM_MAINNET=withdraw BASE_TO=0x… pnpm spike:mainnet withdraw`: the second account breaks
   the seal and asks for everything but the fees to be sent to `BASE_TO`. The script checks that the
   signed transaction comes from the vault's address, on chain 8453, to `BASE_TO`, for that amount.
7. `CONFIRM_MAINNET=broadcast pnpm spike:mainnet broadcast`: sends the signed transaction to Base
   and waits for its receipt. The signed transaction is public in `withdrawals`, so anyone could
   send it.
8. `CONFIRM_LOCK=bearer.<parent> pnpm spike:mainnet lock`: deletes the contract's key, only if it
   runs exactly `contracts/res/bearer.wasm`.

Locking before step 3 would be a stronger proof, since the vault would never have lived under a
contract with a key. The cost: if mainnet behaved differently, fixing it would mean a new contract
account and another 3.6 NEAR.

Each step saves a report in `contracts/tests/spike/reports/mainnet-*.json`.
