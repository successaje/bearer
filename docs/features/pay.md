# Payment links

**For:** anyone who wants to be paid into a Bearer vault, and judges checking what "a vault that
gets paid" means here.
**After reading** you'll know what `/v/[id]/pay` shows, what a payment link carries, and what it
doesn't promise.

Every vault has a page anyone can pay through: `/v/[id]/pay`. It shows the vault's Bitcoin
testnet4, Base Sepolia and Solana devnet addresses with QR codes, says who a payment reaches, and
lists what has arrived. Add an amount and a note and it becomes a payment request you can share:

```
/v/32/pay?chain=btc&amount=0.00002&note=Invoice%2042
```

## What a link carries

- **A coin, an amount and a note. Never an address.** The page reads the vault's addresses from
  `bearer.testnet` every time, so a link can't send a payer anywhere but the vault it names.
- **Nothing secret.** A payment link is safe to post anywhere. A Bearer link is different: it's
  the vault's key, and the page says so next to the copy button.
- **A note is unchecked text.** It's cut to one line of 80 characters, with control and bidi
  characters removed, and shown as "a note from whoever made this link".
- **Anything that doesn't parse is dropped.** An unknown coin, a negative amount or too many decimals
  (more than 8 for tBTC, 18 for ETH, 9 for SOL) leaves the page as a plain "pay this vault" page.

With an amount, the QR code is the chain's payment URI, so a wallet fills the amount in:

| Coin | QR code |
|---|---|
| tBTC | BIP 21: `bitcoin:tb1q…?amount=0.00002&label=Bearer%20vault%20No.%200032&message=…` |
| ETH on Base Sepolia | EIP-681 with the chain id: `ethereum:0x…@84532?value=<wei>` |
| SOL | Solana Pay: `solana:<address>?amount=0.25&label=…&message=…` |

Without an amount, the QR code is the bare address, which every wallet reads.

## Who gets paid

Whoever holds the vault. The page says who that is now, and where the vault goes next while an
escrow contract holds it:

- **Listed for sale:** the buyer, if it sells (`a_deposit_during_a_pending_sale_belongs_to_the_buyer`
  in `contracts/tests/market.test.ts`); the seller, if they take it back.
- **Scheduled:** the recipient on the date; the giver, if the schedule is cancellable and they cancel.
- **Pledged for a loan:** the borrower, if they repay by the due date; after it, the lender, who can
  then take it.
- **In a switch:** the owner while they check in; the beneficiary if they go quiet.

A sealed vault has never had a withdrawal signed, so everything paid in is still inside. That's
what lets a vault be sold as a receivable: the right to be paid moves with it. An opened vault can't
be handed on, so its payments stay with its holder.

## What has arrived

The page reads the address on its chain every few seconds:

- **Bitcoin and Solana** list each payment, marked *seen, not confirmed yet* until its chain confirms
  it (a block on testnet4, finalized on Solana). A payment of exactly the requested amount is tagged
  *same amount as this request*; that's a hint, not proof of who paid.
- **Base Sepolia** shows the balance only: a plain RPC has no list of payments, so the page links to
  the explorer.

## Checked on testnet

Run against `bearer.testnet` on 17 Nov 2026:

| Page | Shows |
|---|---|
| `/v/32/pay?chain=btc&amount=0.00002&note=…` | "Pay 0.00002 tBTC", for sale by alice; the 2,000-sat payment confirmed and tagged as the requested amount |
| `/v/27/pay` | The loan to alice was due on 13 Nov and not repaid, so it goes to the lender |
| `/v/14/pay?chain=evm&amount=0.001` | Opened on 12 Nov, so payments stay with its holder; QR is an EIP-681 URI on chain 84532 |
| `/v/36/pay?chain=btc` | For sale by bob; the 1,500-sat payment confirmed |
| `/v/99999/pay` | There's no vault No. 99999 |

The QR codes on the first page and on a Solana request were read back with Apple's Vision framework;
both decoded to the exact URIs above.

## Limits

- **Testnet coins only.** Mainnet coins sent to these addresses are lost.
- **Native coins only.** Tokens and NFTs sent to a vault can't be withdrawn by this version.
- **A request isn't an invoice.** Nothing on chain ties a payment to a request, so the page can't
  tell who paid which one.
- **Wallet support varies.** Testnet wallets don't all read payment URIs. The address and amount are
  always there to copy.
