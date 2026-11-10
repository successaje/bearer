# Feature: your account and the notifications bell

**Route:** `/account`, and a bell in the header when a wallet is connected · **Data:** each
vault's custody log on NEAR testnet, the market's own views, and NearBlocks' public index (API v3)
· **Status:** on the hosted site from 2026-11-09

**For:** whoever sells or receives vaults on the site. What it shows, where each number comes
from, and what it can't do.

## Why

The first purchase through two real wallets (vault No. 0005, 2 NEAR) worked. But the seller had no
way to tell from the site that it had sold, or that the market had paid them. The chain had it all;
the site didn't show it.

## The bell

It shows what other people did that concerns you:
- a vault you listed sold, with the buyer, the price and what the market paid you;
- a vault handed to you, or handed over to you on its date;
- a vault scheduled for you, with its date;
- a payout waiting to be claimed (the market keeps a payout that bounced, for you to claim).

A dot marks what's new since you last opened it. "Alert me in this browser" turns on the browser's
own notifications for anything new, but only while a Bearer tab is open. Nothing is sent anywhere,
and the setting stays in this browser.

## The account page

- **For sale now:** your listings, from the market contract.
- **Sales:** each sale with the buyer, the price, what you received, a Paid tag and the transaction.
- **Waiting to claim:** from the market's `claimable_of`, with a Claim button. Also any listing
  deposit no listing is using (`deposit_of`), with a button to take it back.
- **Everything that happened:** sales, purchases, handovers and schedules, newest first.

## Where the numbers come from

- **Which vaults to read.** NearBlocks' index lists the vaults that moved in or out of your account
  (`/v3/accounts/{account}/nft-txns`), plus the ones you hold now.
- **What happened to each.** Each vault's custody log on-chain lists every holder in order. A sale
  reads seller → market → buyer; a scheduled handover reads giver → schedule → recipient.
- **What you were paid.** The market's transfer to you in the sale's transaction, from NearBlocks
  (`/v3/accounts/{account}/receipts`).
- **The price.** The buyer's deposit on that transaction, read from an archival NEAR node.

NearBlocks' free index is rate-limited, so the site reads it once a minute. If a read fails, the
bell keeps what it had. The custody log keeps the last 16 holders of a vault, so older history
drops off.

Checked against testnet for `finishr.testnet`: the sale of No. 0005 to `takaba.testnet` for 2 NEAR,
paid 2.01 NEAR in [2wReQN8A…](https://testnet.nearblocks.io/txns/2wReQN8Ajer7Cx93KYFnZyxFncpo2KVQFBT3vTsxnmxm),
and the schedule and cancellation of No. 0006. In the simulated demo, `ada.testnet` sees the seeded
sale of No. 0034 (1.5 NEAR, paid 1.51 NEAR).

## Not done

- **Email.** It would need a service that watches the chain and stores email addresses, plus an
  email provider. That's a server and an account with a provider, and a privacy decision.
- **Alerts with the site closed.** Web push needs the same kind of server.
