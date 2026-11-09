# Feature: testnet mode (the live adapter)

**Branch:** `feat/testnet-mode` · **Switch:** `NEXT_PUBLIC_NETWORK=testnet` · **Status:** merged into main on 2026-11-09; wallet signing still needs a human to try

**For:** whoever decides whether this ships. What changes when the web app runs against the real
contract, what was verified, and what still needs a person with a wallet.

## What it is

Until now the web app ran only against the in-browser mock. This branch adds the SDK's testnet
adapter (brief 4.12) and wires the app to it:

- **`@bearer/sdk` testnet adapter** (`packages/sdk/src/testnet/`): `TestnetBearerClient`
  implements the same `BearerClient` the mock does, using only `fetch` and public, keyless
  endpoints. NEAR views over FastNEAR, Bitcoin over Blockstream's testnet4 Esplora, Base over
  `sepolia.base.org`, Solana over devnet RPC.
  - Reads: vaults by owner (`nft_tokens_for_owner`), vault and withdrawals views, balances and
    pending deposits per chain with their source, fee estimates.
  - Writes go through a small `WalletAdapter` interface: create, transfer, break the seal, and
    break-the-seal-plus-withdraw as **one transaction with two actions** (brief 4.8). Parameters are
    built from live data: Base nonce and fees, Bitcoin coin selection (largest first, up to
    `max_btc_inputs`, sub-dust change folded into the fee), a fresh Solana blockhash.
  - `trackWithdrawal` is read-only: it computes each signed transaction's ID itself (Bitcoin txid
    without witness, Base keccak hash, Solana first signature) and asks that chain. A new optional
    `broadcast()` sends it. A Base nonce already used elsewhere, or a Solana blockhash that
    expired, shows as failed with the reason.
- **Web app**: near-connect (`@hot-labs/near-connect` 0.11.4) replaces the demo-account dialog
  in testnet mode, with its own wallet picker (HOT, Meteor, Intear, MyNearWallet, …). The
  withdrawal tracker broadcasts once the owner's withdrawal is signed; any signed row waiting to be
  sent gets a **Broadcast** button (anyone may; it only pays where the owner chose).

## Honesty fixes that came with it

- The seal panel's **Contract locked** and **Code identity** rows were hard-coded passes. They
  now read the chain: the spike deployment shows **Not locked yet · 1 full-access key: a test
  deployment**. The same false "locked" claim is gone from the seal panel footer and the five
  questions.
- Tiny real amounts (a 0.0000001 ETH fee) show as "< 0.000001" instead of rounding to 0.
- Polling is gentler against public RPCs (4 s instead of 0.7 s).

## Verified

- `pnpm spike:adapter` (contracts/tests): six checks against live testnet, all passing. Vault No.
  0002 and its withdrawals read correctly; vault No. 0004's pending Bitcoin deposit is observed;
  the Base withdrawal that landed is found by its real hash (`0xb347…20e3`); every Bitcoin txid
  matches bitcoinjs-lib's; the expired Solana withdrawal reports why it failed.
- `SPEND=1 pnpm spike:adapter`: the write path with a key-backed wallet: create (vault No. 0005),
  transfer to bob, then break the seal and withdraw in one transaction; the signature arrives and
  the withdrawal waits to be broadcast.
- The web app on `NEXT_PUBLIC_NETWORK=testnet` against `v3a.bearer-1108-ffb3.testnet`: vault pages
  show real data; typecheck, lint and a production build pass.

## Not verified yet (needs a human)

- Every step through a real wallet. On 2026-11-09 the owner created two vaults and listed one on
  the market from their own testnet wallet on the live site (docs/SPIKES.md). Transfer, breaking
  the seal, withdrawing and buying through a wallet are still to do; the adapter's write path for
  them is proven with keys instead.
- Sending attacks from the visitor's own wallet. Instead, the five attacks were sent once to
  `bearer.testnet` as real transactions by the test accounts (`pnpm spike:testnet attacks`), and
  the lab's Check buttons re-read each one's outcome from an archival RPC in the browser.

## Try it

```bash
NEXT_PUBLIC_NETWORK=testnet NEXT_PUBLIC_BEARER_CONTRACT=bearer.testnet pnpm dev
```

On the locked contract, open `/v/1` (opened, with Base, Bitcoin and Solana signatures) or `/v/2`
(sealed). Its test signatures used made-up Bitcoin inputs and unfunded addresses, so broadcasting
them is refused. With `v3a.bearer-1108-ffb3.testnet` instead, `/v/2` and `/v/4` show the
withdrawals that landed. Connect a testnet wallet to create or transfer.
