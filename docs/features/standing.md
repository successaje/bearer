# Feature: standing payments

**Branch:** `next` · **Where:** a vault's page ("Pay someone regularly"), and the panel on a vault
that pays · **Contract:** `contracts/standing`, deployed on `bearer-standing.testnet` (not locked
yet) · **Status:** built on 18 Nov 2026, after the hackathon's judging window; not on `main`

**For:** whoever decides whether this ships, and anyone checking what "an NFT that does something"
means here. What it does, what it can't do, and why it's shaped this way.

## What it is

A vault can pay someone a fixed amount every period, from its own coins: an allowance, a salary,
rent, a subscription. The giver sets it up once on the vault's page:

- **who collects:** a NEAR account, the payee;
- **what and where:** Bitcoin testnet4, ETH on Base Sepolia or SOL on devnet, and the payee's address
  on that chain;
- **how much and how often:** an amount per payment, and a period (a minute, to try it; a day; a
  week; 30 days);
- **for how long:** 3, 12 or 52 payments, or until the giver stops it;
- **whether it can be stopped.** If not, nobody can stop it, the giver included, until the last
  payment; the payee can count on it.

From the first due date, the payee opens the vault's page and presses **Collect**. The contract
asks Bearer to sign exactly that amount to exactly that address, with a network fee no higher than
the plan allows, and the page broadcasts it. One payment per period; a missed period can be
collected later.

## Why the vault stays with the contract

Paying from a vault means asking for a signature, and Bearer only signs for an opened vault. So the
first payment breaks the seal. Bearer never moves an opened vault (its invariant I2), so from then
on the vault stays with the standing-payments contract for good, and the giver acts through it:

| | Before the first payment (sealed) | After it (opened) |
|---|---|---|
| Payee | collects the first payment, which opens the vault | collects one payment per period |
| Giver, cancellable plan | stops it; takes the vault back, sealed, with the deposit | stops it; withdraws anything, anywhere, through the contract |
| Giver, irrevocable plan | waits until the plan ends, then takes it back | waits until it ends, then withdraws through the contract |
| Anyone else | nothing | nothing |

A plan ends when it's stopped, when every payment has been collected, or one whole period after the
last payment fell due. A payment not collected by then lapses.

The locked Bearer contract couldn't be changed for this, and didn't need to be: its withdrawal
methods only check that the caller owns the vault, and the standing-payments contract owns it.

## How it's built

- **One receipt opens and pays.** Before the first payment, `break_seal` and `withdraw_*` go to
  Bearer as two actions in one receipt. If Bearer refuses the withdrawal, the seal stays unbroken.
- **The payee chooses only what they must.** The coins to spend (Bitcoin), the nonce and gas price
  (Base) or a recent blockhash (Solana). The address, the amount and the EVM chain come from the
  plan; the fee is capped by it.
- **Nothing counts until Bearer says so.** After each request the contract reads Bearer's own
  withdrawal record at the index it expected. Signed: the payment counts. Recorded but not signed (the
  signer failed): it counts nothing, and the payee can try again. No record: Bearer refused it, and the
  deposit goes back to the caller. If that read itself fails, the plan stays locked until anyone calls
  `recheck`.
- **One request at a time.** While a payment or withdrawal is with Bearer, every other request is
  refused (`ERR_IN_PROGRESS`).
- **A 0.01 NEAR plan deposit**, checked against the plan's storage, as on the other escrow
  contracts. It comes back when a sealed vault is taken back; a vault that has paid stays, so its
  record does too.

## On testnet

Vault No. 0037 (`alice.` → `bearer-standing.testnet`, payee `bob.`): 0.00005 Base Sepolia ETH every
2 minutes, 3 payments, cancellable, paid back to vault No. 0001's address so no coins were lost.

- Planned: [tx](https://testnet.nearblocks.io/txns/12svmfvGeVUCAfBEM5LkQikEyrhk5SVsNnV2tkS3WSkS).
- Payment 1 opened the vault and paid in one NEAR transaction, 24.988 Tgas in all
  ([NEAR](https://testnet.nearblocks.io/txns/4WpbZyGjXaxxwTs2HSb1RyMEDSAxA2ZyrfoRKz8uLgaq),
  [Base Sepolia](https://sepolia.basescan.org/tx/0x39297f516c04f6f73e6aed05aa7e708125aca17b5ba3753ad177e88bef813037)).
- Payment 2, one period later, 22.761 Tgas
  ([NEAR](https://testnet.nearblocks.io/txns/FtmfgmqHdJn8hpYptZCA8fnadPfyneABuF3n63rbVT1U),
  [Base Sepolia](https://sepolia.basescan.org/tx/0x481ea868bb1080300326e20544b1d02f067ea9c9e7c0c19401d0193f89abb2bb)).
  Each time, the address received exactly 50,000,000,000,000 wei.
- Refused on testnet: a non-payee collecting (`ERR_NOT_PAYEE`), a fee over the cap
  (`ERR_FEE_TOO_HIGH`), a second payment in the same period (`ERR_NOT_DUE`), taking an opened vault
  back (`ERR_VAULT_OPENED`), moving it on Bearer (`ERR_VAULT_OPENED`), and the payee stopping it
  (`ERR_NOT_GIVER`). Reports in `contracts/tests/spike/reports/testnet-standing-*`.
- The third payment wasn't collected within its period, so the plan ended after two, as designed.

## Try it

- **Simulated demo:** `NEXT_PUBLIC_NETWORK=mock pnpm dev`, connect as `mira.testnet` and open
  `/v/38`: ada's vault pays mira 0.0005 tBTC a week and one payment is due. As `ada.testnet`, open
  `/v/42` and press **Pay someone regularly**.
- **Testnet:** `pnpm dev` and open `/v/37`. To run it yourself: `pnpm spike:standing vault`, fund
  it, then `plan <id> evm`, `collect <id>` and `refusals <id>` (contracts/tests/spike/standing-testnet.ts).

## What it doesn't do

- **Nobody pushes payments.** A blockchain doesn't act on its own; the payee collects. There is no
  keeper service.
- **It doesn't check the balance.** The contract can't see Bitcoin, Base or Solana balances. A payment
  the vault can't cover is refused by Bearer or fails on its chain; a payment signed but never
  broadcast still counts, because the payee holds a valid signed transaction.
- **A paying vault can't be sold or handed on.** It's opened; that's Bearer's core rule.
- **Not locked yet.** `bearer-standing.testnet` still has its deployer's key, and runs the
  `contracts/build.sh` build, not a reproducible one. The page says so beside the plan. Locking it
  is `CONFIRM_LOCK=bearer-standing.testnet pnpm spike:standing lock`, after a reproducible build.

## Files

- `contracts/standing/src/lib.rs`, `tests.rs`: the contract and 41 unit tests.
- `contracts/tests/standing.test.ts`: 15 sandbox tests against the locked Bearer wasm.
- `contracts/tests/spike/standing-testnet.ts`: deploy, plan, collect, refusals, lock.
- `packages/sdk/src/types.ts` (`StandingPlan`, `standing`), `testnet/client.ts` (`planPayments`,
  `collectPayment`, `stopPayments`, `takeBackPlanned`, `withdrawThroughPlan`).
- `apps/web/src/components/standing/`: the set-up sheet and the panel.
- Threats P1–P12 in [docs/THREAT_MODEL.md](../THREAT_MODEL.md).
