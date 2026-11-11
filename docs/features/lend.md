# Feature: borrowing against a vault

**Contract:** `contracts/lend`, deployed as `bearer-lend.testnet` (reproducible build of `883873d`, locked)
· **On the site:** "Borrow against it" on a sealed vault the owner holds; a loan panel on a
pledged vault's page; `/lend` for open requests and running loans; "Borrowed against" and
"Backing your loans" on My vaults · **Status:** live on the hosted site; run on testnet and locked on 2026-11-11

**For:** whoever decides whether this ships. What it does, the rules, and what was checked.

## What it is

Someone holds a vault with Bitcoin in it and needs NEAR for a month. They pledge the vault: "lend
me 25 NEAR, I'll pay back 26 within 30 days." A lender looks at the vault's page, sees it's sealed
with 0 signatures and what's confirmed at its addresses, and funds it. The 25 NEAR goes straight
to the borrower. If they repay in time, the vault comes back to them. If not, the lender takes it,
Bitcoin and all, without a bridge or a wrapped token.

While it's pledged nobody can withdraw from it, the borrower included, so the lender knows the
collateral is still there. That's what makes a sealed vault work as collateral.

## How it works: escrow by transfer

`bearer.testnet` is locked, so lending is a separate contract that holds the vault, like the
market and the schedule:

1. **Ask.** The borrower pays a 0.01 NEAR loan deposit (`deposit_for_loan`), then calls Bearer's
   `nft_transfer_call` to the lending contract with the terms:

   ```json
   {"principal": "<yoctoNEAR>", "repayment": "<yoctoNEAR>", "term_ns": "<ns>"}
   ```

   Bearer's gate only lets sealed vaults through. The contract refuses, and Bearer sends the vault
   straight back, if there's no deposit, the loan is under 0.001 NEAR, the repayment is less than
   the loan, or the term is under a minute or over ten years (L6).
2. **Lend.** A lender calls `fund` with exactly the principal and names the repayment and term
   they agreed to; if the borrower changed them in the meantime it's refused (L7). The principal
   goes straight to the borrower and the term starts.
3. **Repay** (only the borrower, only before the due date; L8). They attach exactly the repayment.
   The vault moves back to them first; the lender is paid only once it has. If the vault doesn't
   move, the repayment comes back and the loan stands (L3).
4. **Foreclose** (only the lender, only from the due date; L8). The vault moves to the lender,
   still sealed, and the borrower gets the deposit back.
5. **Take it back** (only the borrower, only before anyone lends). The vault and the deposit go
   back to them.

Repay and foreclose never overlap, so there's no race at the deadline. There are no admin
methods. If a callback fails, the loan goes back to how it was (L5). A vault sent with a plain
`nft_transfer` can be returned with `return_unrequested` (L9).

## What it doesn't do

- **No price feed, no liquidation.** The lender decides how much to lend against what the vault
  holds. If the coins fall below the repayment, the borrower may let the lender keep the vault.
  The lend review says so (L11).
- **No early recall.** A loan runs its term.
- **No late repayment.** From the due date only the lender can act.

## Checked

- `cargo test -p lend`: 22 unit tests.
- `contracts/tests/lend.test.ts`: 16 sandbox tests against the locked Bearer wasm, covering
  L1–L9.
- On testnet against `bearer.testnet` (`pnpm spike:lend run`, docs/SPIKES.md), twice, the second
  time on the reproducible build that is now locked: one loan repaid, one foreclosed after a
  70-second term, one taken back. Each balance change was exact, and each vault stayed sealed with
  0 signatures. Changed terms, an early foreclosure, a late repayment
  and the borrower breaking the pledged seal were each refused.
- The simulated demo seeds an open request (No. 0012), a running loan of ada's (No. 0055) and an
  overdue one where ada is the lender (No. 0047), so every action can be tried without a wallet.

## Locked

`bearer-lend.testnet` runs `contracts/res/lend.wasm`, the reproducible build of `883873d` (two
builds, identical bytes; code hash `9CP3cAHg…GmyU`), and has no keys: its only one was deleted on
2026-11-11 ([tx](https://testnet.nearblocks.io/txns/Cia5mDdMobJJCPWUx6kgcAhuNDiYhBxBPukb1XW4ZFuX)), so nobody can change it or act as the owner of a pledged vault
(L10). The Locked contracts workflow rebuilds it from `883873d` and compares the result with the
code on chain, and `pnpm verify` checks the keys, the code hash and the commit.
