# Feature: the receiving moment

**Branch:** `feat/received` · **Where:** the vault page, once per hand-over · **Status:** merged into main on 2026-11-09

**For:** whoever decides whether this ships. What the new holder sees, and why it is shaped the
way it is.

## What it is

The first time someone opens a vault that was just handed to them, the page opens with a short
ceremony before showing the vault:

1. The card slides in from the side, the way a card is handed across a table.
2. It turns over to show its back: the endorsements, ending "Held by" the viewer, with the
   "Unopened · 0 signatures" stamp.
3. It turns back, under "OTC · Desk 7 **is yours.**", who it came from and when, and: "Still
   sealed: no signature has ever been requested for it, and only you can break the seal."
4. Three facts as chips (nothing moved on Bitcoin, Base or Solana; 0 signatures; the observed value,
   est.), then **See what's inside** or **Hand it on** (opens the transfer sheet).

It appears once per hand-over: the "seen" mark is keyed to the vault and the custody entry, so a
later hand-over back to the same person shows it again.

## Why no envelope

An envelope opening would be the obvious image, but here the seal is the promise: it must stay
visibly intact. Nothing opens, cracks or tears in this moment; the card only arrives and turns.

## Behaviour

- Shows only when the connected account is the owner, the vault has changed hands, and the newest
  custody entry is the viewer.
- A Radix dialog: focus is trapped, Esc and the button close it.
- Reduced motion: no slide or flip; the card appears at rest.

## Try it

`pnpm dev`, connect as `mira.testnet` (demo accounts), open `/v/17` (tunde handed it to mira).
Or transfer any sealed vault to a demo account and open it as that account.

## Files

- `apps/web/src/components/vault/received-moment.tsx`: `ReceivedMoment` and `useJustReceived`.
- `vault-detail-view.tsx`: mounts it. `globals.css`: `received-in` keyframes.
- `vault-card.tsx`: optional controlled `flipped` prop. This is the same change as `feat/handover`,
  byte for byte, so the two branches merge cleanly.
