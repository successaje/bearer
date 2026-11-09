# Feature: the market

**Route:** `/market`, plus List for sale and a For sale panel on vault pages · **Contract:**
`contracts/market`, deployed and locked as `bearer-market.testnet` · **Status:** merged into main
on 2026-11-09; first real sale on testnet and locked the same day. `/market` shows the listings;
`/market/how` explains the rest

**For:** whoever decides whether this ships, and anyone checking that buying a vault is safe.
How a sale works, which checks protect each side, what was tested, and what isn't done yet.

## What it is

People can list a sealed vault for a NEAR price, and anyone can buy it. Before the market, a vault
could only be handed to someone the holder already knew. A reviewer suggested it so vaults can be
discovered and traded: collectibles, prizes, gifts. They also asked for honesty about why anyone
would buy the package rather than the coins inside, since anyone can already send Bitcoin directly.
The page answers that in three points:

- **A history you can check.** No withdrawal has ever been signed for a sealed vault, on any chain,
  and its custody log names every holder. Coins sent directly carry neither.
- **Made to change hands.** It can be handed on again, still sealed, without anyone moving the coins.
- **No trust in the seller.** The contract moves the vault before the seller is paid, at exactly the
  listed price, and refunds the buyer if the vault can't move.

## How a sale works: escrow by transfer

`bearer.testnet` is locked and has no NEP-178 approvals, on purpose (threat T6). So a market can't
be "approved" to move someone's vault later. Instead the seller hands the vault to the market, which
holds it until it sells or is delisted.

1. **List.** The seller pays a 0.01 NEAR listing deposit to the market (`deposit_for_listing`), then
   calls Bearer's `nft_transfer_call` to the market with `msg = {"price": "<yoctoNEAR>"}`. Bearer's
   transfer gate refuses opened vaults, so only sealed vaults arrive. The market records the listing
   and keeps the vault. Any problem (no deposit, bad price, not from Bearer) makes the market panic,
   and Bearer sends the vault straight back. The web app asks the wallet for both transactions in one
   request (`signAndSendTransactions`); whether that's one approval depends on the wallet. It skips
   the deposit while the seller's balance covers it.
2. **Buy.** The buyer calls `buy` with exactly the price. The listing is marked as selling, so nobody
   else can buy or delist it meanwhile. The market calls Bearer's `nft_transfer` to the buyer. That
   receipt is Bearer's own gate checking, as it moves the vault, that the vault is still sealed and
   still held by the market. Only after it succeeds does the market pay the seller the price plus the
   listing deposit.
3. **If something fails.**
   - If the vault didn't move, the buyer is refunded and the listing stands again.
   - If a payout bounces (the account no longer exists), it's kept as a claimable balance. `claim`
     pays it to whoever holds the account name.
   - The callbacks never panic, and `buy` and `delist` refuse less than 60 Tgas, so a settlement
     can't stop halfway.
4. **Delist.** Only the seller can delist, and not while a sale is settling. The vault and the
   deposit go back.
5. **A vault sent with plain `nft_transfer`** (so never listed) can be sent back by anyone:
   `return_unlisted` sends it to whoever held it before the market, read from Bearer's custody log.

The market has no admin, owner or upgrade methods. Prices are exact, so "at the agreed price" holds.
To change a price, the seller delists and lists again.

## The reviewer's checks, and where each one lives

| They asked | Where it's handled |
|---|---|
| At purchase, the seller still owns the vault, it's still sealed, at the agreed price | Escrow: the market holds the vault, and Bearer's gate re-checks "sealed and held here" in the receipt that moves it. Exact price only (`ERR_WRONG_PRICE`) |
| Payment and transfer complete safely; failed payouts or refunds are handled; no assumed rollbacks | Vault first, money second; explicit refund and claimable paths (M3, M4, M5) |
| Balances shown with source, last-check time and confirmation status, as observations | The buy review and listing cards list each chain's confirmed and pending amounts, the data source and when it was read, and say they're observations, not guarantees |
| Contract, signing and admin-key risks are clear | Both contracts are locked, and the buy review checks both locks live; while any key remained it would say so, because whoever held one could act as the owner of a listed vault. It also says sealed doesn't mean risk-free and that nothing is audited |

## Storage

Each listing holds 0.01 NEAR from the seller's listing balance. `nft_on_transfer` measures the
storage the listing uses and refuses (`ERR_LISTING_DEPOSIT_BELOW_STORAGE`) if the deposit wouldn't
cover it, so nobody can fill the market for free. The deposit goes back with the sale or the
delisting. Unused balance can be withdrawn (`withdraw_deposit`).

## Checked

- `cargo test -p market`: 14 unit tests. They cover every settlement branch, callbacks with mocked
  failures, the gas floor, the price and deposit rules, and a second buyer being refused mid-sale.
- `contracts/tests/market.test.ts`: 13 sandbox tests against the locked Bearer wasm
  (`contracts/res/bearer.wasm`). They include:
  - the seller is paid exactly the price plus the deposit;
  - the double-buy race;
  - a failed move refunds the buyer;
  - a bounced payout becomes claimable after the seller deletes their account;
  - an opened vault can't be listed;
  - a direct `nft_on_transfer` is refused;
  - delisting and `return_unlisted`.
- Reproducible build: two builds of `579df21` from a clean checkout gave identical bytes (sha256
  `641ce46c…71ce`). `bearer-market.testnet` runs that wasm (code hash `7joKh4WS…qt7P`).
- **First real sale, on testnet, 2026-11-09.**
  - alice listed vault No. 0004 on `bearer.testnet` for 0.1 NEAR
    ([listing](https://testnet.nearblocks.io/txns/75Gdpx1BKNyi2qWGn7XuGVmQ9yH1mkYi3K3B4QRPoGk8)), and bob bought it
    ([purchase](https://testnet.nearblocks.io/txns/GCuy9zAFHGeN8ZsjgvUyaF8Uzz4xvW4UvNessKMMYv6F)).
  - The custody log reads alice → market → bob. The vault is still sealed, with 0 signatures, and
    no receipt failed.
  - alice's balance rose by exactly 0.11 NEAR, the price plus her deposit. She signed nothing during
    the purchase, so nothing else could change it.
  - Gas: 8.9 Tgas to list and 11.5 Tgas to buy, one run each.
  - Report: `contracts/tests/spike/reports/testnet-market-sale-2026-11-09T12-21-46.716Z.json`.
- The web app in the simulated demo: listing No. 0042 and buying No. 0008, at 1280 px. The market
  page also at 375 px (no horizontal scroll). In testnet mode it reads the real sale from the chain:
  vault No. 0004's history shows "Listed on the market" and "Bought by bob".

- **Locked** (M9), with the owner's go-ahead. `spike:market lock` checked that the code was the
  reproducible build, then deleted the account's only key ([tx](https://testnet.nearblocks.io/txns/G8t9cc9xKa7ymc84hCtk8xeRG2JKBao8auFLKLg1SHVK)); two RPCs then reported no
  keys. Nobody can change the market or act as its account. `/market/how` reads the key count and
  code hash live.

## Not done yet

- Buying through a real browser wallet. Listing works in one: on 2026-11-09 the owner listed vault
  No. 0005 from their own testnet wallet on the live site (deposit and transfer 1.8 s apart). Buying
  is proven with key-backed accounts only.
- Payment between people outside the market is still out of scope (T14). Inside it, the contract
  settles.

## Files

- `contracts/market/src/lib.rs`, `contracts/tests/market.test.ts`, `contracts/tests/spike/market-testnet.ts`.
- `packages/sdk/src/types.ts` (`MarketListing`, the client methods), `packages/sdk/src/testnet/client.ts`.
- `apps/web/src/components/market/*`, `apps/web/src/app/market/page.tsx`; the vault page, the
  activity feed and the received moment name market steps.
