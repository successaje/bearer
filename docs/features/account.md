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
  (`/v3/accounts/{account}/nft-txns?contract=bearer.testnet`), plus the ones you hold now and any
  seen before.
- **What happened to each.** Each vault's custody log on-chain lists every holder in order. A sale
  reads seller → market → buyer; a scheduled handover reads giver → schedule → recipient.
- **What you were paid.** The market's transfer to you in the sale's transaction, from NearBlocks
  (`/v3/accounts/{account}/receipts?predecessor=bearer-market.testnet`).
- **The price.** The buyer's deposit on that transaction, read from an archival NEAR node.

The chain is read once a minute. NearBlocks' free index is rate-limited, and every 25 rows it
returns cost a credit, so it's read far less often:

- **The first read** goes through up to four pages of your Bearer transfers.
- **After that, every 10 minutes**, the newest page only. A vault that leaves your account in
  between is still followed, because it was seen there.
- **Payouts** are looked up only while a sale's payout is missing: on the next read for a sale in
  the last 15 minutes, since the index takes a moment to catch up, and every 10 minutes for older
  ones.

So an open tab costs one or two credits every 10 minutes. Before 17 Nov 2026 it cost eight a
minute (100 rows of transfers and 100 of receipts); that day NearBlocks refused this development
machine's calls for hours. If the first read fails, the bell says so and tries again a minute later; after that
a failed read keeps what it had. The custody log keeps the last 16 holders of a vault, so older
history drops off.

Checked against testnet for `finishr.testnet`: the sale of No. 0005 to `takaba.testnet` for 2 NEAR,
paid 2.01 NEAR in [2wReQN8A…](https://testnet.nearblocks.io/txns/2wReQN8Ajer7Cx93KYFnZyxFncpo2KVQFBT3vTsxnmxm),
and the schedule and cancellation of No. 0006. In the simulated demo, `ada.testnet` sees the seeded
sale of No. 0034 (1.5 NEAR, paid 1.51 NEAR).

## Not done

- **Email.** It would need a service that watches the chain and stores email addresses, plus an
  email provider. That's a server and an account with a provider, and a privacy decision.
- **Alerts with the site closed.** Web push needs the same kind of server.
