# Feature: if I go quiet (a dead man's switch)

**Contract:** `contracts/switch`, deployed as `bearer-switch.testnet` · **On the site:** "If I go
quiet" on a sealed vault the owner holds; a switch panel on the vault's page ("I'm still here",
"Change who or how long", "Take it back", or "Take what's yours" for the beneficiary once it's
due); "If you go quiet" and "Left to you" on My vaults · **Status:** on branch `switch`; run on
testnet on 2026-11-12 on the reproducible build of `c74b2c8`, not locked yet

**For:** whoever decides whether this ships. What it does, the rules, and what was checked.

## What it is

Someone keeps savings in a vault for their daughter. They want it to reach her if anything happens
to them, without a lawyer, a custodian or a date fixed years ahead. They put the vault in a switch:
"if I don't check in for a year, it goes to zara.testnet." Every so often they tap "I'm still
here" and the year starts again. They can keep adding coins to the vault's addresses, change who
it goes to or how long the silence has to be, or take it back, at any time.

If they go quiet for a whole year, anyone can hand the vault to her: the daughter, a relative, a
stranger. It can only go to her. It arrives sealed, with everything at its addresses, and only she
can open it.

While it's in the switch nobody can withdraw from it, the owner included. That's what lets the
beneficiary trust it's all still there.

## How it works: escrow by transfer

`bearer.testnet` is locked, so the switch is a separate contract that holds the vault, like the
market, the schedule and the lending contract:

1. **Set it.** The owner pays a 0.01 NEAR switch deposit (`deposit_for_switch`), then calls
   Bearer's `nft_transfer_call` to the switch with:

   ```json
   {"beneficiary": "<account>", "interval_ns": "<ns>"}
   ```

   Bearer's gate only lets sealed vaults through. The switch refuses, and Bearer sends the vault
   straight back, if there's no deposit, the beneficiary is the owner, the switch or Bearer, or
   the interval is under a minute or over ten years (D6, D7). The site also checks the
   beneficiary's account exists before letting you continue.
2. **Check in** (only the owner; D3). `check_in` restarts the clock. `update` changes the
   beneficiary or the interval and counts as a check-in.
3. **Take it back** (only the owner, any time before it's handed over). The vault and the deposit
   go back to them.
4. **Hand it over** (anyone, once a whole interval has passed since the last check-in; D4).
   `release` first sends the beneficiary 1 yoctoNEAR: a transfer to a named account that doesn't
   exist fails, and then the switch stays as it was, so a mistyped name can't swallow the vault
   (D7). Otherwise the vault moves to the beneficiary, still sealed, and the owner's deposit goes
   back to the owner's account.

A late check-in still counts until someone actually hands the vault over (D10): the owner might
have been in hospital, and the beneficiary paid nothing for it. Once a hand-over is in flight,
check-ins are refused until it settles. There are no admin methods. If a callback fails, the
switch goes back to how it was (D5). A vault sent with a plain `nft_transfer` can be returned
with `return_unarmed` (D8).

## What it doesn't do

- **No reminders.** Nothing emails or texts the owner. The vault page and My vaults show the
  clock; the site's notifications are per browser.
- **No partial hand-over.** The whole vault goes to one beneficiary. Several heirs means several
  vaults.
- **No withdrawals while it's held.** Take it back first.
- **No secrecy.** Who the beneficiary is and when the owner last checked in are public on NEAR.

## Checked

- `cargo test -p switch`: 18 unit tests.
- `contracts/tests/switch.test.ts`: 13 sandbox tests against the locked Bearer wasm, covering
  D1–D8 and D10.
- On testnet against `bearer.testnet` (`pnpm spike:switch run`, docs/SPIKES.md): one vault taken
  back after a check-in and a change; one handed to bob by a stranger once alice went quiet, sealed,
  with alice's deposit back to the yoctoNEAR; one kept by the switch while its beneficiary didn't
  exist, then taken back. The owner opening the vault, someone else checking in, and an early
  hand-over were each refused. `pnpm verify` re-reads the hand-over and the kept vault on chain.
- The simulated demo seeds ada's switch for zara (No. 0031) and tunde's overdue one naming ada
  (No. 0033), so every action can be tried without a wallet.

## Before it's locked

`bearer-switch.testnet` runs the reproducible build and still has its key (D9), so whoever holds
that key could act as the owner of a vault in the switch. The site says so on every switch panel.
To lock it like the other escrow contracts: `CONFIRM_LOCK=bearer-switch.testnet pnpm spike:switch
lock`, which refuses unless the deployed code is `contracts/res/switch.wasm`. Locking can't be
undone.
