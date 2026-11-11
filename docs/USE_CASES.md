# Use cases

**For:** the team, choosing which stories to tell, and anyone asking "why not just send the coins?"

Bearer does one thing: a bundle of coins on several chains becomes one object that changes hands
in one NEAR transaction, and the person receiving it can check that nobody who held it before can
take anything out. Every use case below leans on at least one of these:

- **Nothing moves on the other chains.** A hand-over costs NEAR gas, not a Bitcoin fee, and is
  final in seconds. Bitcoin's fee is paid once, by whoever finally opens the vault.
- **The receiver can check it.** Sealed, 0 signatures, coins already confirmed at the vault's own
  addresses: read from the chains, not taken on trust.
- **Many ways to hand it over.** To an account, in person by QR, through the market's escrow, on a
  date with the schedule, or as a link to someone with no wallet.
- **Opening is final.** Once opened it never moves again, so an opened vault can't be resold as
  sealed.

Status: **Live** works on the hosted site today (`bearer.testnet`). **v2** works on the v2
contract (`bearer-v2.testnet`) and in the v2 preview, not on the hosted site. **Idea** needs new
work.

## Gifts and family

| # | Use case | Why a vault, not a transfer | Status |
|---|---|---|---|
| 1 | **A Bitcoin gift card.** Birthday, wedding, graduation: send a vault as a link or hand it over by QR. | The recipient needs no wallet to receive it, can check it's untouched, and secures it before opening. | Live |
| 2 | **A child's college fund.** A parent fills it over the years and schedules the handover for their 18th birthday. | The schedule hands it over on the date by itself, and the child can check it on the way. | Live (schedule); v2 adds staking |
| 3 | **Savings that earn while they wait.** The parent stakes the vault's NEAR; the stake and its rewards go with the vault. | Staking needs no signature, so the seal still holds. Only the holder can unstake. | v2 |
| 4 | **A time capsule.** "Open on your 30th": a non-cancellable schedule to a named account. | Once scheduled without cancel, even the giver can't take it back. | Live |
| 5 | **Red envelopes and cash gifts.** Eid, Lunar New Year, weddings: a printed bearer certificate with a QR in a card. | A paper gift with real coins behind it, checkable by anyone holding the card. | Live (certificate) |

## Buying, selling and paying

| # | Use case | Why a vault, not a transfer | Status |
|---|---|---|---|
| 6 | **Sell native Bitcoin for NEAR, with no bridge.** Load BTC into a vault and list it; the buyer pays in NEAR and ends up holding real BTC, not a wrapped token. | The market holds the vault until the exact price is paid. No bridge, no custodian, no wrapped asset. | Live (market) |
| 7 | **Pay with coins that are already confirmed.** A buyer hands a merchant a vault of confirmed BTC; the merchant checks it and it's final in seconds. | No waiting for Bitcoin confirmations at the till: they happened when the vault was filled. | Live |
| 8 | **Trade the same coins many times, pay Bitcoin's fee once.** A vault passed between traders works like a bearer bond. | Each hand-over is one NEAR transaction; only the final holder pays a Bitcoin fee to open it. | Live |
| 9 | **A basket as one item.** BTC, ETH on Base and SOL, plus NEAR, tokens and NFTs in v2, sold or given in one transaction. | One object, one price, one check, instead of a transfer per chain. | Live (3 chains); v2 adds NEAR, tokens, NFTs |
| 10 | **An NFT sold with funds attached.** A game item with the coins to use it, or a membership NFT with prepaid fees. | The NFT and the coins move together and can't be split by a former holder. | v2 |

## Events, communities and onboarding

| # | Use case | Why a vault, not a transfer | Status |
|---|---|---|---|
| 11 | **Hackathon and tournament prizes.** Fill the prize vaults before the event and hand them over on stage by QR. | Anyone can check the prize is really there before the winners are named. | Live |
| 12 | **A prize promised on a date.** Schedule it, non-cancellable, to the winner's account. | The sponsor can't change their mind after scheduling: the contract hands it over. | Live |
| 13 | **Someone's first Bitcoin.** Send a link to a friend with no wallet; they open it and withdraw. | No account, no app, no seed phrase to receive it. | Live (Bearer links) |
| 14 | **A multi-chain starter pack.** A little BTC, ETH on Base, SOL and NEAR in one link, so a new developer has gas everywhere. | One link gives gas on every chain the vault holds. | Live (3 chains); v2 adds NEAR |
| 15 | **Conference giveaways and printed gift cards.** Vaults on printed cards, sold or handed out. | Each card is checkable on the spot. A card is a key, so the first step is always to secure it. | Live |
| 16 | **Tips and thank-yous in person.** Show a QR, the other person scans and checks it. | Faster than asking for an address, and nothing to copy wrong. | Live (hand-over mode) |

## Finance, next

| # | Use case | Why a vault, not a transfer | Status |
|---|---|---|---|
| 17 | **Borrow against Bitcoin on NEAR without wrapping it.** A lending contract holds a sealed vault as collateral and returns it on repayment; if it isn't repaid by the due date, the lender takes it. | A sealed vault can't be drained, so the lender knows the collateral is still there. The market and the schedule already hold vaults the same way. | Live (`bearer-lend.testnet`, locked; [docs/features/lend.md](features/lend.md)) |
| 18 | **Proof of funds before a deal.** A seller shares the vault page; the buyer sees confirmed coins and the seal before agreeing. | Live checks from the chains, not a screenshot. | Live |
| 19 | **Grants and bounties paid in native coins.** A DAO schedules a vault to each grantee for milestone day. | Paid in native BTC or SOL, scheduled from NEAR, with the date kept by a contract. | Live (schedule) |

## What Bearer doesn't do

- **Hide anything.** Every vault's contents and history are public on the chains.
- **Hold value for the giver.** A sealed vault can always be opened by whoever holds it. Escrow comes only from the market and the schedule contracts.
- **Stake NFTs.** NFTs don't earn by themselves. A v2 vault holds them and they move with it; staking is for its NEAR.
- **Mainnet.** Everything here is testnet and unaudited. Don't use real funds.
