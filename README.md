# Bearer

**A sealed vault you can hand over, with native assets inside.**

You want to give someone Bitcoin as a gift. Or pass a prize to the winner of a competition. Or sell
a set of assets as one package. But handing over a wallet has a catch: how can the next owner know
you didn't sign a withdrawal before giving it away?

Bearer is an answer to that, built on NEAR. A vault is a NEAR NFT that controls its own addresses
on Bitcoin, Base and Solana. While the vault is sealed, its owner can transfer it but can't request
a withdrawal signature. Once the owner opens it, withdrawals work and transfers are disabled for
good. So control of native assets can change hands without moving them, and without the previous
owner keeping a way to take them back.

[Try Bearer](https://bearer-near.vercel.app) · [Verify the deployment](https://bearer-near.vercel.app/proof) · [Read the threat model](docs/THREAT_MODEL.md)

Testnet prototype, built for the NEAR Hackathon (Nov 2026). Not audited. Don't use real funds.

## The problem

Alice creates a wallet holding Bitcoin and sells control of it to Bob.

Even if Bob becomes the new owner, Alice may already have signed a Bitcoin transaction that sends
the coins somewhere else. She can keep it and broadcast it after the sale. Changing who owns an NFT
can't revoke a Bitcoin transaction that has already been signed.

A transferable wallet has to rule that out, not just show a new owner on a screen.

## How Bearer works

Transfer and withdrawal signing are mutually exclusive:

1. **Create.** Minting a vault (a NEAR NFT) fetches its Bitcoin testnet4, Base Sepolia and Solana
   devnet addresses, derived by NEAR's MPC signer for this contract and this vault.
2. **Deposit.** Native testnet coins are sent to those addresses. Nothing is bridged or wrapped.
3. **Hand over.** While sealed, the NFT can move to any NEAR account in one transaction. Nothing
   moves on the other chains, and no withdrawal signature can be requested in this state.
4. **Open.** The current holder breaks the seal. It can't be undone, and the vault can never change
   hands again.
5. **Withdraw.** Once opened, the holder asks the contract for signed withdrawals to any address
   they choose. The contract builds each transaction itself and signs nothing else.

> A vault can change hands only while it is sealed. Breaking the seal is the only way to get a
> signature, and it can never be undone.

```text
            create_vault                  break_seal (owner, 1 yocto)
   (none) ───────────────▶  SEALED  ─────────────────────────────▶  OPENED
                             │  ▲                                    │
          internal_transfer  │  │ (owner changes,                    │ withdraw_* (btc / evm / sol)
          (any path)         └──┘  stays SEALED)                     ▼ (owner, repeatable)
                                                               signature records
   No arrow leaves OPENED. No arrow returns to SEALED.
```

So a vault that is still sealed has never had a withdrawal signature requested, on any chain, and
anyone can check that on its public page before accepting it.

## Why NEAR

NEAR is where the ownership and the rules live:

- A NEAR contract records who holds each vault and enforces sealed or opened.
- NEAR Chain Signatures lets that contract request signatures for vault-specific addresses on other
  chains, but only through the withdrawal methods its rules allow.
- Transferring the NFT changes who may authorise a future withdrawal, without moving the assets.

This depends on the deployed contract and NEAR's signing network behaving as specified. It doesn't
remove network, contract or key-management risk.

| NEAR feature | Where | What it does in Bearer |
|---|---|---|
| Chain Signatures (`v1.signer-prod.testnet`, domains 0 and 1) | `contracts/bearer/src/withdraw_{evm,btc,sol}.rs` | Each vault controls native Bitcoin, Base and Solana addresses; the contract signs only withdrawals it builds, only for opened vaults, only for their owner |
| NEP-171 + NEP-177 | `contracts/bearer/src/lib.rs`, `transfer.rs` | The vault is a standard NFT; every transfer path goes through one seal gate. Its media is a live image of its seal |
| NEP-297 events | `events.rs` | Indexable history: created, transferred, opened, withdrawals requested, signed or failed |
| Yield/resume (through the signer) | the `on_*_signed` callbacks | Asynchronous signatures inside one user action; Bitcoin joins one request per input into one callback |
| Cross-contract calls | `create_vault`, `contracts/market` | Keys fetched at creation; the market settles a sale by moving the vault, then the money |

## What has been demonstrated

Three kinds of evidence, kept apart so they aren't confused. Raw reports and every identifier are
in [docs/SPIKES.md](docs/SPIKES.md).

**1. Local sandbox (simulated chains).** The contracts run in a real NEAR sandbox with a mock MPC
signer. These are simulations, not transactions on Bitcoin, Base or Solana.

- 41 sandbox tests (28 for the vault, 13 for the market) and 37 unit tests. Each signed
  transaction is checked independently: viem for Base, bitcoinjs-lib and noble for Bitcoin,
  `@solana/web3.js` for Solana.
- `pnpm demo:dry` runs the vault's lifecycle and the attacks against simulated ledgers that apply
  each signed transaction and refuse anything spent twice. It ends with "22/22 checks passed".

**2. Real transactions on an earlier test contract** (`v3a.bearer-1108-ffb3.testnet`, against NEAR's
real MPC signer). Each paid the vault's own address. So each proves the contract can sign and the
other chain accepts it, not a payout to a separate person.

| Chain | Signed through the contract | On its own chain |
|---|---|---|
| Bitcoin testnet4 | 1–4 inputs joined into one callback, 6.5–8.4 s (one run each) | **Confirmed** in block 159,948: [`ce01f9ff…58b6`](https://mempool.space/testnet4/tx/ce01f9fffdf0f362641a4f6882257295ae63de6146c5a3478704ef809bf958b6). alice transferred the sealed vault to bob first; bob broke the seal and withdrew in one NEAR transaction |
| Base Sepolia | 5 of 5, median 7.7 s (N = 5) | **Confirmed**: [`0xb347…20e3`](https://sepolia.basescan.org/tx/0xb347d755df6105ef2deb58158533f31fa5687586992308ee2fed0e4622ee20e3) |
| Solana devnet | 2 of 2, 7.7 s and 8.3 s (N = 2) | **Finalized** in slot 520,280,234: [`jQCk6nNL…grmt`](https://explorer.solana.com/tx/jQCk6nNLGvbAfkrxGizGhvqiUpnUZeA4b58tU3SEFdNA3La2g5PqTY6uod3zWMJk7yB9wfvZebVzFa73oEdgrmt?cluster=devnet) |

**3. The final contract, `bearer.testnet`.**

- **Reproducible and locked.** It runs the reproducible build: two rebuilds gave identical bytes,
  and the on-chain code hash matches. It's locked: its only key was deleted
  ([tx](https://testnet.nearblocks.io/txns/J87dPH7D1LG7PLwvyzqwFbBKMsQ7pAd7Nxfn1DrvsaVT)). The proof
  page checks both from your browser.
- **The same signing checks passed:**
  - Base: 5 of 5, median 7.6 s.
  - Ed25519: 5 of 5.
  - Bitcoin: 1–4 joined inputs, verified.
  - Solana: signed and verified.

  None was broadcast: these vaults hold no funds yet.
- **Five attacks, sent as real transactions, all refused.** A former owner withdrawing and breaking
  a seal, an opened vault transferred, a sealed vault withdrawn, a raw `sign` call. Each got its
  expected error and none reached the signer. The attack lab on the site re-reads these
  transactions from NEAR when you press Check.
- **One market sale.** Vault No. 0004 for 0.1 NEAR, alice to bob
  ([purchase](https://testnet.nearblocks.io/txns/GCuy9zAFHGeN8ZsjgvUyaF8Uzz4xvW4UvNessKMMYv6F)). It
  arrived sealed with 0 signatures, and alice received exactly the price plus her listing deposit.
  The market contract (`bearer-market.testnet`) is reproducibly built and locked too
  ([tx](https://testnet.nearblocks.io/txns/G8t9cc9xKa7ymc84hCtk8xeRG2JKBao8auFLKLg1SHVK)).

**Through a browser wallet.** On the live site, the owner's own testnet wallet created two vaults and
listed one on the market (docs/SPIKES.md).

A signature, a self-transfer or one sale is not proof of every possible withdrawal, or of the full
flow in a browser wallet. What's left is listed under [What comes next](#what-comes-next).

## Try it

**Hosted, read-only** at [bearer-near.vercel.app](https://bearer-near.vercel.app), against
`bearer.testnet`:

1. Open [/proof](https://bearer-near.vercel.app/proof). It reads, from your browser:
   - that the contract has no access keys;
   - that its code hash matches the reproducible build;
   - the MPC signer's version and the deployed settings.

   Then follow the evidence, with its limits next to it.
2. Open vault [No. 0001](https://bearer-near.vercel.app/v/1) (opened, with signatures for all three
   chains) and press **Check all** in its attack lab.
3. Open the [market](https://bearer-near.vercel.app/market). Connecting a testnet wallet lets you
   create, transfer, list and buy.

**Local, simulated.** Needs Node 20.11+ and pnpm 10.2.1:

```bash
pnpm install
pnpm demo:dry            # the whole story in ~15 s, no funds needed: ends "✓ 22/22 checks passed"
pnpm dev                 # the web app at localhost:3000, in mock mode (everything labelled SIMULATED)
pnpm test:contracts      # unit tests, then sandbox tests (also needs Rust and the wasm32 target)
```

`demo:dry` uses the committed contracts (`contracts/res/`) and simulated ledgers; their lines start
with `SIMULATED`. It isn't a live three-chain test.

**Against testnet, locally**, with NEAR wallets through near-connect:

```bash
NEXT_PUBLIC_NETWORK=testnet NEXT_PUBLIC_BEARER_CONTRACT=bearer.testnet pnpm dev
```

**Rebuild the deployed contract and compare.** This needs Docker and cargo-near 0.22.0. The source
metadata embeds the commit, so build from the one the contract names, `71f194e`:

```bash
git checkout 71f194e
cargo near build reproducible-wasm --manifest-path contracts/bearer/Cargo.toml
shasum -a 256 contracts/target/near/bearer/bearer.wasm   # 05b27506…8619, as in contracts/res/SHA256SUMS
```

**Repeat the testnet runs** from `contracts/tests`. This needs `BEARER_TESTNET_PARENT` in `.env`,
a faucet-created testnet account:

```bash
pnpm spike:testnet setup
pnpm spike:testnet run
```

## What you can use it for

- **Gifts.** Put coins in a sealed vault and hand it to someone, who opens it when they want.
- **Prizes.** Fund a vault and hand it to the winner, who can check it's untouched first.
- **Collectibles.** A named, finished vault with a printable certificate, holding native assets, that
  can be handed on again while sealed.
- **Selling.** The market contract lists sealed vaults for a NEAR price and settles each sale itself:
  the vault moves first, then the seller is paid; a vault that can't move refunds the buyer
  ([docs/features/market.md](docs/features/market.md)).

These show what the model can do. The market is a testnet prototype like the rest.

## The web app

| Page | What it's for |
|---|---|
| `/v/[id]` | A vault's public page: seal, observed balances, custody, signatures, the attack lab |
| `/market` | Sealed vaults for sale, held in escrow by the market contract; list from a vault's page, buy at exactly the listed price |
| `/v/[id]/handover` | Hand a vault over in person: a QR code for the recipient, and the card flips when the transfer lands |
| `/v/[id]/certificate` | A printable bearer certificate, one A4 page, with a QR code to the live seal |
| `/proof` | Live checks against NEAR testnet, every measured number, and the threat table |
| `/derive` | Recompute a vault's three addresses in the browser from the MPC root keys |
| `/nft/[id].svg` | The vault NFT's image, drawn from its live state: seal intact, or broken once opened |

Each one is described in [docs/features](docs/features).

## Architecture

```text
 wallet ── NEAR tx ──▶ Bearer contract ── sign(payload built here) ──▶ MPC signer (v1.signer-prod)
                          │  ▲                                              │
                          │  └──────────── signature (callback, verified) ◀─┘
                          └── stores the signed Bitcoin / Base / Solana tx ──▶ anyone broadcasts it
```

The contract builds every payload itself:
- Base: EIP-1559 transfers with empty calldata;
- Bitcoin: P2WPKH spends with SIGHASH_ALL and change back to the vault;
- Solana: one system transfer with a recent blockhash.

It verifies each signature against the vault's stored key and stores the signed transaction
publicly. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Security and limitations

- **Testnet prototype, not audited.**
- **Trust.** It relies on NEAR, its MPC signing network, the deployed contracts and each external
  chain's normal operation. Both contracts, Bearer's and the market's, are open source,
  reproducibly built and locked.
- **Opened is final.** Once opened, a vault can't be transferred or sealed again.
- **Balances.** The ones shown come from public data sources (Blockstream Esplora, Base Sepolia RPC,
  Solana devnet RPC), with their source, time and confirmation status. They can lag or be
  incomplete, and the contract never relies on them.
- **Mind which evidence you're reading.** The earlier test contract and the final locked one have
  different evidence; read the reports before drawing conclusions.
- **The certificate isn't proof.** A printed certificate or QR code helps a person find and inspect
  a vault; ownership is what the contract says.
- **Not every threat is fully tested.** The [threat model](docs/THREAT_MODEL.md) marks each row as
  tested, partly tested or handled by policy, with the test that covers it.

## What comes next

- Finish the browser-wallet flow by hand. Creating vaults and listing one worked from a real testnet
  wallet on the live site (9 Nov); transfer, opening, withdrawal and buying are proven with
  key-backed test accounts but not yet through a wallet.
- A funded withdrawal from the final contract to a separate recipient.
- More adversarial tests: the `nft_transfer_call` return path (T6) and duplicate signatures on real
  chains (T10, so far shown on a simulated ledger).
- An independent security review before anything on mainnet.

## Repository

```text
apps/web            Next.js app: a simulated demo, or the testnet contract with NEAR wallets
contracts/bearer    the NEAR contract (near-sdk 5.30)
contracts/market    the market: sells sealed vaults from escrow
contracts/mock-signer   an MPC signer stand-in for the sandbox
contracts/tests     sandbox tests (near-sandbox) and testnet scripts
packages/sdk        shared types and the client interface
docs                architecture, threat model, decisions, spikes, and one page per web feature
```

## Hackathon disclosure

Built for the NEAR Hackathon (window starting 2026-10-19). Libraries: near-sdk,
near-contract-standards, k256 and ed25519-dalek (mock signer), Next.js, React, TanStack Query,
Radix, near-connect (@hot-labs), qrcode.react, viem, bitcoinjs-lib, @noble and @scure,
@solana/web3.js. AI tools: Claude Code (Anthropic) was used throughout for code, tests and
documentation. The same team lead also submitted **Sudo by Contract**, an independent project. The
two share no code.

## License

[MIT](LICENSE), © 2026 Success Aje.
