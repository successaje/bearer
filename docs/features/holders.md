# Holders only

**For:** judges and builders checking how a Bearer vault can gate access.
**After reading** you'll know what `/v/[id]/holders` checks, where, and what it doesn't promise.

Each vault has a page only its current holder can open: `/v/[id]/holders`. Holding a vault is
then a pass for anything put behind the same check: a members' page, an event pass, a download.

## How it opens

1. **The browser asks for a signature.** The message is
   `Open the holders' page of Bearer vault No. NNNN`, signed as a
   [NEP-413](https://github.com/near/NEPs/blob/master/neps/nep-0413.md) message for this site
   (the `recipient` is the site's host). The 32-byte nonce starts with the time in milliseconds.
   - With a wallet, near-connect's `signMessage` signs it.
   - With a Bearer link open in the tab, the link's own key signs it in the browser. A link is the
     key of the NEAR account that holds the vault.
2. **The server checks it** (`apps/web/src/app/api/holders/route.ts`), never the page:
   - the nonce is less than five minutes old;
   - the signature is valid for that message, this vault and this site;
   - the key is a **full-access** key of the account, read from NEAR testnet (`view_access_key`,
     final);
   - the account **holds the vault now**, read from the Bearer contract (`vault`, final).
3. **Only then** does the response carry the holders' room. Anyone else gets a refusal that names
   the current holder. A former holder is also told when the vault left them.

The moment a transfer is final, the page closes for the old holder and opens for the new one.
Nothing is stored and nothing is sent on chain; signing is free.

## Checked on testnet

The gate was called with real keys from the test accounts against `bearer.testnet`, where vault
No. 0001 passed from `alice.bearer-1108-ffb3.testnet` to `bob.bearer-1108-ffb3.testnet`:

| Request | Answer |
|---|---|
| Bob, the holder | Opens: verified holder, block height, holding since 9 Nov |
| Alice, who held it before | 403 `not_holder`: held by bob, "you held it until 9 Nov" |
| Bob's key, claiming to be alice | 401 `not_full_access`: that key isn't a key of alice |
| A tampered signature | 401 `bad_signature` |
| A signature made ten minutes earlier | 401 `expired` |
| A signature for vault No. 0004 sent for No. 0001 | 401 `bad_signature` |
| A vault that doesn't exist | 404 `no_vault` |

## Limits

- **The room is a demonstration.** What it shows is generic; the point is the check in front of it.
- **A signature can be replayed for up to five minutes.** No nonce is stored. Replaying one opens
  the page only for the account that signed it, and only while that account still holds the vault.
- **Escrow holds the vault.** While a vault is listed, pledged, scheduled or in a switch, the escrow
  contract holds it, so its owner is refused until it comes back. That's what the chain says.
- **It needs NEP-413 support in the wallet.** Wallets that can't sign messages can't open the page;
  a Bearer link always can.
