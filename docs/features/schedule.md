# Feature: scheduled handover

**Contract:** `contracts/schedule`, deployed as `bearer-schedule.testnet` (reproducible build, not
locked yet) · **On the site:** "Schedule a handover" on a sealed vault the owner holds; a panel on
a scheduled vault's page; "Scheduled by you" and "Coming to you" on My vaults · **Status:** merged
into main on 2026-11-09, run on testnet the same day

**For:** whoever decides whether this ships. What it does, the rules, and what was checked.

## What it is

A parent puts coins in a vault called "For your next chapter", chooses their child's account and
a date, and the vault is handed over on or after that date. Until then it stays sealed, so nobody
can withdraw, the parent included. Anyone can keep sending coins to its addresses, so it can grow.

The date is a lower bound. A blockchain doesn't wake up on its own, so on or after the date
someone sends one transaction to hand it over: the child, the parent, a friend, or a small
automated job. That call can only send it to the recipient chosen at scheduling, so it needs no
trust.

## How it works: escrow by transfer

`bearer.testnet` is locked, so the schedule is a separate contract that holds the vault, like the
market:

1. **Schedule.** The giver pays a 0.01 NEAR schedule deposit (`deposit_for_schedule`), then calls
   Bearer's `nft_transfer_call` to the schedule with this message:

   ```json
   {"recipient": "…", "release_at_ns": "…", "cancellable": true}
   ```

   Bearer's gate only lets sealed vaults through. The schedule refuses, and Bearer sends the vault
   straight back, in any of these cases:
   - the date is less than a minute away;
   - the recipient is the giver;
   - there's no deposit.
2. **Hold.** The schedule never calls `break_seal`, so the vault stays sealed and nobody can
   withdraw (S6).
3. **Release** (anyone, on or after the date; S2, S3). The schedule first sends 1 yoctoNEAR to the
   recipient:
   - A named account that doesn't exist makes that fail. The vault then stays put
     (`recipient_missing`) until the account exists (S5). Without this check, a vault sent to an
     unregistered name would go to whoever registered it first.
   - If the check passes, Bearer's own transfer gate moves the vault, still sealed, and the giver
     gets the deposit back.
4. **Cancel** (only the giver, only if they chose a cancellable schedule, and only before the date;
   S4). The vault and the deposit go back to the giver.

There are no admin methods. If a callback fails, the schedule goes back to waiting (S8). A vault
sent with a plain `nft_transfer` (never scheduled) can be returned with `return_unscheduled` (S9).

A cancellable schedule is a planned gift, not an irrevocable trust; the site says which one each
schedule is.

## Checked

- `cargo test -p schedule`: 14 unit tests.
- `contracts/tests/schedule.test.ts`: 13 sandbox tests against the locked Bearer wasm, covering
  S1–S9.
- Reproducible build: two builds of `47b5d25` from a clean checkout gave identical bytes (sha256
  `83c2ea97…a247`). `bearer-schedule.testnet` runs it (code hash `9sLo27AU…JSkE`).
- **Testnet, 2026-11-09** (`pnpm spike:schedule run`; report
  `contracts/tests/spike/reports/testnet-schedule-2026-11-09T14-37-57.715Z.json`), with alice's and
  bob's test accounts and a third account releasing:

| Step | Result | Tx |
|---|---|---|
| alice schedules vault No. 0008 for bob, cancellable, then cancels | back with alice | [schedule](https://testnet.nearblocks.io/txns/3mFVSUScJVQPgJHm9HCueVotSmKfyrX6KYRgE2FzUv5D), [cancel](https://testnet.nearblocks.io/txns/AeF5U5xnTGunHcJweFyEvoUhEEdZ9cz9KQTEavuPE4k1) |
| alice schedules vault No. 0007 for bob, not cancellable | held by the schedule | [Frr7M9xy…](https://testnet.nearblocks.io/txns/Frr7M9xyBENpMmj7Svc7yMKZ2xizqgqPknU1VP74QfVL) |
| Release before the date | refused, `ERR_TOO_EARLY` | [A3EfLqy3…](https://testnet.nearblocks.io/txns/A3EfLqy3PQz1bZG6rayRK26xo1J9rcuWWWmND1izDEVo) |
| alice cancels the irrevocable schedule | refused, `ERR_NOT_CANCELLABLE` | [4cpvA6hH…](https://testnet.nearblocks.io/txns/4cpvA6hHjt2uynaVXXqsd7spnEENDQm1af8GFBoDx1eA) |
| alice breaks the seal on her scheduled vault | refused, `ERR_NOT_OWNER` | [DiJF3L67…](https://testnet.nearblocks.io/txns/DiJF3L67hPMMWJzJiEMStEyRgXi85GKZvhMqcj3kLiwt) |
| On the date, a third account releases No. 0007 | bob holds it, sealed, 0 signatures; alice got exactly her 0.01 NEAR back. 15.2 Tgas | [76eGYPzR…](https://testnet.nearblocks.io/txns/76eGYPzRDspJi3YXLXVGU1zDnj8wcNF14kSz8Vu2HUpt) |
| Release No. 0002, scheduled for an unregistered name | the vault stays, `recipient_missing` | [zaDjCK5w…](https://testnet.nearblocks.io/txns/zaDjCK5w2x8MQG87vhQ3pL6VWdQPSymutSGDKL5NqUZ) |
| The account is created; release again | No. 0002 goes to it | [9fVdTyuJ…](https://testnet.nearblocks.io/txns/9fVdTyuJWyabMsZMbe17p1t2wv2MqJYwMUmooxbFBisB) |

One run (N = 1). An earlier attempt the same day also handed No. 0002 to bob, and showed No. 0004
waiting for `nobody.…` until that account was created. Its report wasn't saved because the
script stopped on the expected failed check, so only the run above counts as evidence.

- **Web:** in the simulated demo, scheduling vault No. 0042 for mira and cancelling it worked. The
  seeded gift No. 0021 ("For your next chapter", ada for theo, in six months, not cancellable)
  shows its schedule. Against testnet, vault No. 0007's history reads "Scheduled for a handover",
  "Back with alice", "Scheduled for a handover", then "Handed over to bob".

## Not done yet

- **Locking the schedule (S10).** Until then, whoever holds the account's key could act as the
  owner of a scheduled vault.
- **A real-wallet run** of scheduling, releasing and cancelling.
- **A gift message.** Planned for the card or certificate, off-chain by default, since anything
  stored on-chain is public forever.
- **Withdrawing yield or holdings.** v2's NEAR holdings and a NEAR staking position would move with
  the vault the same way, but neither is on the live contract.
