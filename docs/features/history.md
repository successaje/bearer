# A vault's history

**For:** anyone reading a vault's History tab, and judges checking "a history view per NFT".
**After reading** you'll know where each row comes from, and what the tab can't show.

The History tab (`/v/[id]#history`) is one timeline of everything that happened to a vault:

- its creation;
- every change of hands;
- every sale, loan, schedule and switch it went through, with prices, terms and dates;
- the seal breaking;
- each withdrawal;
- each deposit seen at its addresses.

It's newest first. The latest 10 show, and the rest are one click away.

## Where each row comes from

| Row | Read from |
|---|---|
| Created, transferred, back with its holder | The vault's custody log on `bearer.testnet`: every holder in order, the last 16 kept |
| Listed for 0.1 NEAR · Bought by bob for 0.1 NEAR · Taken off the market | The market's `listed`, `sold` and `delisted` events |
| Scheduled for takaba on 9 Nov 2026, cancellable or not · Handed over · Cancelled | The schedule contract's `scheduled`, `released` and `cancelled` events |
| Pledged for a 1 NEAR loan, to repay 1.05 NEAR within 1 day · Repaid, and to whom · Taken by the lender · Request taken back | The lending contract's `requested`, `repaid`, `foreclosed` and `cancelled` events |
| Put in a switch for bob, with its interval · Passed on · Taken back | The switch's `armed`, `released` and `taken_back` events |
| Lent 1 NEAR by finishr, and the due date | The lending contract's record of the open loan. A loan is funded exactly one term before it's due |
| Checked in | The switch's record: its owner's latest sign of life |
| Seal broken, withdrawals | The vault and its withdrawals, on `bearer.testnet` |
| Deposits | Each chain's public RPC, as on the Inside tab |

### How the events are found

1. **NearBlocks' index lists every transaction that minted or moved the vault.** One page of 25 rows
   costs one credit of its free rate limit. A second page is read only if the first is full.
2. **Each transaction's logs are read from NEAR's archival RPC.** Only events about this vault are
   kept, and only from the four escrow contracts the site is set up with, so a look-alike contract
   can't add rows. A transaction's logs never change, so each one is read once per visit.
3. **Each event gets its transaction's transfer time.** That's the custody log's own clock, to the
   nanosecond, so "Bought by bob for 0.1 NEAR" replaces exactly the custody log's plain "Bought by
   bob" step. Rows from logs link to their transaction on NearBlocks.

The tab reads all this only when it's opened, and again only when the vault moves. Funding a loan
and checking in to a switch don't move the vault, so they're in none of its transactions. They come
from the escrow records the page already polls, so they show without another call to the index.

## When the index doesn't answer

NearBlocks' free API is rate-limited. If it refuses, the tab still shows every move from the custody
log, in plain words ("Listed on the market", "Back with alice"). The escrow that holds the vault now
is read straight from its contract, with its terms. A line under the list says the index didn't
answer, and the tab tries again a minute later.

## Checked on testnet

Checked on 17 Nov 2026, while NearBlocks was refusing this machine's calls (HTTP 429). That tested
the fallback for real. Vault No. 0027 showed its custody steps, and from `bearer-lend.testnet`:

- "Pledged for a 1 NEAR loan… to repay 1.05 NEAR within 1 day of being lent";
- "Lent 1 NEAR by finishr.testnet", with its due date of 13 Nov 2026.

To check the full path, the index's list was stood in, in the browser only, with transaction hashes
recorded in this repository's docs. Every log was then read live from the archival node:

| Vault | Rows from the escrow contracts' logs |
|---|---|
| No. 0004 | Listed for 0.1 NEAR by alice · Bought by bob for 0.1 NEAR |
| No. 0006 | Scheduled for takaba.testnet on 9 Nov 2026, finishr could cancel · Back with finishr: cancelled before its date |
| No. 0022 | Taken by bob, after alice didn't repay by the due date |
| No. 0024 | Repaid: alice paid back 0.105 NEAR, which went to bob |
| No. 0029 | Passed on to bob after alice went quiet |
| No. 0031 | Put in a switch for bob, with a 3 days 21 h interval, shown once though the switch's record has it too |

In the simulated demo (`NEXT_PUBLIC_NETWORK=mock`), the escrows log the same events as they move a
vault. On vault No. 0042, each of these showed as its own row:

- arming a switch;
- checking in;
- taking it back;
- listing it for 2.5 NEAR;
- delisting it.

## Limits

- **One check-in.** A switch keeps only its owner's latest check-in, so that's the one listed. Once
  the switch ends, it isn't listed at all.
- **Funding only while the loan is open.** Once a loan is repaid or the lender takes the vault, that
  row names the lender instead.
- **No switch changes.** A change of beneficiary or interval doesn't move the vault, so it isn't
  listed. The Overview tab shows the switch as it is now.
- **No failed attempts.** Attempts that didn't move the vault (a refused purchase, a release before
  its date) aren't listed.
- **The last 16 holders.** The custody log keeps only those, though events from earlier
  transactions are still listed.
