# Bearer

**Bitcoin that changes hands without a Bitcoin transaction.**

A Bearer vault is a NEAR NFT that controls its own Bitcoin address, plus Base and Solana ones.
While it's sealed, it moves to its next owner in one NEAR transaction: final in about 5 seconds,
for 0.0004 NEAR in gas, with no Bitcoin fee and nothing moving on Bitcoin. Whoever receives it can
check that no withdrawal was ever signed for it. On Bitcoin itself, coins change owner only through
a Bitcoin transaction, and handing over a key leaves the giver a copy.

So you can give someone Bitcoin as a gift, pass a prize to a winner, sell a set of assets as one
package, or schedule a vault to be handed over on a date. The question each of those raises is how
the next owner can know you didn't sign a withdrawal before giving it away. Bearer answers it.

While the vault is sealed, its owner can transfer it but can't request a withdrawal signature. Once
the owner opens it, withdrawals work and transfers are disabled for good. So control of native
assets changes hands without moving them, and without the previous owner keeping a way to take
them back.

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

- 54 sandbox tests (28 for the vault, 13 for the market, 13 for the schedule) and 51 unit tests. Each signed
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

  These weren't broadcast: those vaults held no funds.
- **A funded withdrawal through a wallet.** The owner opened vault No. 0005 and withdrew 0.0002 ETH
  to a separate Base Sepolia address, in one NEAR transaction from their own wallet
  ([NEAR](https://testnet.nearblocks.io/txns/9ioTWzebJRgkTaRLG9ZVNQzFKdyX9RSqkxMKwjN4UKwf)). Base Sepolia confirmed it in block 56,685,109
  ([0x1678…5017](https://sepolia.basescan.org/tx/0x167897cae482d693f5a321ec459c3204270efcd735d11bb5ff95c0ea0ab65017)).
- **Two signatures for one nonce, on a real chain (T10).** Vault No. 0001 requested two Base
  withdrawals for the same nonce, as a retry could leave them, and both were broadcast together.
  Base Sepolia confirmed one
  ([0xcda9…ed00](https://sepolia.basescan.org/tx/0xcda94fc2657424ccc34d972c4015e517f12a75bfaca0aeeeea52d7b89ffded00))
  and refused the other; sent again afterwards, it got "nonce too low".
- **Five attacks, sent as real transactions, all refused.** A former owner withdrawing and breaking
  a seal, an opened vault transferred, a sealed vault withdrawn, a raw `sign` call. Each got its
  expected error and none reached the signer. The attack lab on the site re-reads these
  transactions from NEAR when you press Check.
- **One market sale.** Vault No. 0004 for 0.1 NEAR, alice to bob
  ([purchase](https://testnet.nearblocks.io/txns/GCuy9zAFHGeN8ZsjgvUyaF8Uzz4xvW4UvNessKMMYv6F)). It
  arrived sealed with 0 signatures, and alice received exactly the price plus her listing deposit.
  The market contract (`bearer-market.testnet`) is reproducibly built and locked too
  ([tx](https://testnet.nearblocks.io/txns/G8t9cc9xKa7ymc84hCtk8xeRG2JKBao8auFLKLg1SHVK)).

**Through a browser wallet.** On the live site, the owner's own testnet wallets did every flow:
- created two vaults;
- listed one and bought it from a second account (the seller was paid 2.01 NEAR: the price plus
  the listing deposit);
- handed it back;
- scheduled a handover, then cancelled it;
- opened the vault and withdrew Base Sepolia ETH to a separate address.

Details are in docs/SPIKES.md.

**A scheduled handover.** Vault No. 0007, scheduled by alice for bob and not cancellable, was
handed over on its date by a third account
([tx](https://testnet.nearblocks.io/txns/76eGYPzRDspJi3YXLXVGU1zDnj8wcNF14kSz8Vu2HUpt)). It arrived
sealed with 0 signatures. Earlier moves were refused: an early release, a cancel, and alice
breaking the seal. A vault scheduled for an unregistered name waited until that account existed.
The schedule contract (`bearer-schedule.testnet`) is reproducibly built and locked
([tx](https://testnet.nearblocks.io/txns/6wAyfjD218s7DvCwuzK7nEtAdLDQK5eZujY3caDJRekx)).

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

## Three ways a vault changes hands

All three are deployed on NEAR testnet, reproducibly built and locked, and each keeps the vault
sealed until it arrives.

| | How | Measured on testnet |
|---|---|---|
| **Hand over** | `nft_transfer` on `bearer.testnet`, or in person with a QR code (`/v/[id]/handover`) | 6 handovers of vault No. 0007: final in a median 4.6 s (4.0–5.8 s, timed from a laptop), 4.0 Tgas = 0.0004 NEAR each; sealed, 0 signatures after every one ([report](contracts/tests/spike/reports/testnet-handover-2026-11-09T18-05-40.934Z.json)) |
| **Sell** | `bearer-market.testnet` holds a listed vault in escrow; the buyer pays the exact price, gets the vault, then the seller is paid | Vault No. 0004 sold for 0.1 NEAR ([purchase](https://testnet.nearblocks.io/txns/GCuy9zAFHGeN8ZsjgvUyaF8Uzz4xvW4UvNessKMMYv6F)); it arrived sealed with 0 signatures |
| **Schedule** | `bearer-schedule.testnet` holds it until a date; on or after it, anyone can hand it over, only to the chosen recipient | Vault No. 0007 handed to bob on its date by a third account ([tx](https://testnet.nearblocks.io/txns/76eGYPzRDspJi3YXLXVGU1zDnj8wcNF14kSz8Vu2HUpt)) |

What people could use them for:

- **Gifts.** Put coins in a sealed vault and hand it to someone, who opens it when they want.
- **Gifts for a day.** Schedule a vault for a birthday or a graduation. Until then it stays sealed
  and nobody can withdraw, the giver included. The giver chooses whether they can cancel
  ([docs/features/schedule.md](docs/features/schedule.md)).
- **Prizes.** Fund a vault and hand it to the winner, who can check it's untouched first.
- **OTC hand-offs.** Sell a position without moving it: the market settles in one transaction
  ([docs/features/market.md](docs/features/market.md)).
- **Collectibles.** A named, finished vault with a printable certificate, holding native assets,
  that can be handed on again while sealed.

These show what the model can do. Like the rest, the market and the schedule are testnet
prototypes.

## The web app

| Page | What it's for |
|---|---|
| `/v/[id]` | A vault's public page: seal, observed balances, custody, signatures, the attack lab |
| `/market` | Sealed vaults for sale, held in escrow by the market contract; list from a vault's page, buy at exactly the listed price |
| `/account` | Your account: what you have for sale, what sold and what you were paid, payouts to claim, and everything that happened to your vaults. The bell in the header shows what others did: a sale, a vault handed or scheduled to you |
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
  chain's normal operation. Bearer's, the market's and the schedule's contracts are open source,
  reproducibly built and locked: none has a key, so nobody can change them.
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

- Email alerts. The bell and browser alerts only work while the site is open; email needs a small
  service that watches the chain and keeps addresses, which isn't built.
- Funded Bitcoin and Solana withdrawals from the final contract. Both confirmed from the earlier test
  contract; from `bearer.testnet` so far only Base has been broadcast.
- More adversarial tests: the `nft_transfer_call` return path (T6), and duplicate Bitcoin spends on
  testnet4 (T10 is shown on Base Sepolia, and for Bitcoin on a simulated ledger).
- An independent security review before anything on mainnet.

## Sustainability

- **Revenue.** The market contract on testnet takes no fee. The mainnet market would take 0.5% of
  each sale; it would be a new contract, since the testnet one is locked and can't change.
- **Integration.** `packages/sdk` is the surface for wallets and OTC desks: read a vault, check its
  seal and signatures, then create, transfer, list, buy or schedule, with its testnet client.
- **Mainnet.** An independent audit is the gate to mainnet. We'd fund it with a NEAR ecosystem
  grant.

## Repository

```text
apps/web            Next.js app: a simulated demo, or the testnet contract with NEAR wallets
contracts/bearer    the NEAR contract (near-sdk 5.30)
contracts/market    the market: sells sealed vaults from escrow
contracts/schedule  the scheduled handover: holds a sealed vault until a date
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
