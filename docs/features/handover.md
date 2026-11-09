# Feature: hand-over mode

**Branch:** `feat/handover` · **Route:** `/v/[id]/handover` · **Status:** merged into main on 2026-11-09

**For:** whoever decides whether this ships. What it does, how it stays honest, and how to demo it
with two phones.

## What it is

Bearer's pitch is handing someone Bitcoin like a sealed envelope, which mostly happens in person:
a birthday, an OTC desk, a prize on stage. Hand-over mode is the screen for that moment.

**The holder's screen** (`/v/42/handover`, linked as "Hand it over in person" on sealed vaults):

- A dark stage with the vault card, a live ticker ("Unopened · 0 signatures ever requested · held
  by ada.testnet · checked just now") that re-reads the chain every 2 seconds.
- Three steps: **1** the recipient scans a QR to check the vault on their own phone; **2** they say
  which NEAR account to send it to; **3** the holder transfers it (the normal transfer review sheet,
  owner only).
- When the chain shows a new holder (a custody entry newer than the moment the screen opened), the
  screen changes by itself: "It's mira.testnet's now. Nothing moved on Bitcoin, Base or Solana.",
  the card turns over to its endorsements with the new "Held by" line, and every step ticks.
- Keeps the screen awake (Wake Lock API, where the browser allows it, and says so) and offers
  full screen for the stage only.
- Opened vaults show why they can't be handed over instead of a transfer button.

**The recipient's phone** (the QR opens `/v/42?handover=1`): above the five questions, a checklist
answered from the chain, not by the person holding it: it's sealed; 0 signatures ever requested;
who holds it now ("make sure that's the person in front of you"). If the vault is opened or has
signatures, the box turns red and says "Don't accept this vault."

## Honesty

- Nothing is asserted by the holder's device: the recipient checks on their own phone, against
  NEAR, and the checklist says so.
- The hand-over moment appears only after the chain shows the new owner; there's no optimistic
  "done" screen.
- Bearer still doesn't handle payment between people (T14); the stage makes no claim about it.

## Demo with two phones

1. Phone A: connect as `ada.testnet`, open `/v/42/handover`, tap Full screen.
2. Phone B: scan the QR. The checklist shows sealed, 0 signatures, held by ada.testnet.
3. Phone A: Transfer No. 0042 → `mira.testnet` → confirm.
4. Within ~2 s phone A's stage turns the card over; phone B (connected as mira) shows "You hold
   this vault".

Checked: 1440 px and 390 px (no horizontal overflow), dark and light site themes (the stage stays
dark), and the full transfer in mock mode.

## Files

- `apps/web/src/app/v/[id]/handover/page.tsx`, `components/handover/handover-view.tsx`.
- `components/vault/recipient-checklist.tsx`, shown by `vault-detail-view.tsx` on `?handover=1`.
- `components/vault/vault-card.tsx`: optional controlled `flipped` prop.
