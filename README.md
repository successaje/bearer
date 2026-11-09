# Bearer

**A sealed vault of native Bitcoin, Base and Solana that you can hand to anyone. Whoever holds it
can break the seal. Nobody before them can.**

Hand someone Bitcoin like you'd hand them a sealed envelope. Testnet prototype, built for the NEAR
Hackathon (Nov 2026). Not audited; not financial advice.

**Live on testnet: [bearer-near.vercel.app](https://bearer-near.vercel.app)**, against the spike
contract `v3a.bearer-1108-ffb3.testnet` (not locked yet). Start with
[/proof](https://bearer-near.vercel.app/proof) or the vault behind the first Bitcoin withdrawal,
[No. 0004](https://bearer-near.vercel.app/v/4).

## The problem

On every chain, coins are bound to keys, so changing who owns them means moving them. On NEAR, a
contract can control native addresses on other chains, which makes a wallet you can hand over
possible. But the old owner could get a withdrawal signed, keep it, hand the wallet over, and empty
it later: checking ownership at transfer time can't cancel a signature that already exists.

## What Bearer does

- **A vault is an NFT on NEAR** that controls its own Bitcoin (testnet4), Base (Sepolia) and
  Solana (devnet) addresses through NEAR Chain Signatures. No bridge, nothing wrapped.
- **Hand it over in one NEAR transaction.** Nothing moves on the other chains.
- **A one-way seal.** While sealed, no withdrawal signature can even be requested, so there is
  nothing for a previous owner to keep.
- **Break the seal to withdraw.** In the same transaction as the first withdrawal; after that the
  vault can never change hands, so every signature it produces pays its owner.
- **Check before you accept.** Every vault has a public page: seal state, signatures ever
  requested, custody history, observed balances with their sources, and an attack lab.

## The one rule

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

## Status, with evidence

Everything below was measured on testnet against NEAR's real MPC signer (`v1.signer-prod.testnet`
3.18.0). Details and raw reports: [docs/SPIKES.md](docs/SPIKES.md).

| Chain | Signed through the contract | On its own chain |
|---|---|---|
| Base Sepolia | 5 of 5, median 7.7 s (N = 5) | **Confirmed**: [`0xb347…20e3`](https://sepolia.basescan.org/tx/0xb347d755df6105ef2deb58158533f31fa5687586992308ee2fed0e4622ee20e3) |
| Bitcoin testnet4 | 1–4 inputs joined into one callback, 6.5–8.4 s (one run each) | **Confirmed** in block 159,948: [`ce01f9ff…58b6`](https://mempool.space/testnet4/tx/ce01f9fffdf0f362641a4f6882257295ae63de6146c5a3478704ef809bf958b6), after a transfer and a seal break in one NEAR transaction |
| Solana devnet | 2 of 2, 7.7 s and 8.3 s (N = 2) | **Finalized** in slot 520,280,234: [`jQCk6nNL…grmt`](https://explorer.solana.com/tx/jQCk6nNLGvbAfkrxGizGhvqiUpnUZeA4b58tU3SEFdNA3La2g5PqTY6uod3zWMJk7yB9wfvZebVzFa73oEdgrmt?cluster=devnet) |

Not done yet: the locked, reproducible deployment (the spike contract still has a full-access
key). The hosted site runs against the spike contract until then.

## Try it

```bash
pnpm install
pnpm demo:dry            # the whole story in ~15 s, no funds needed: ends "✓ 22/22 checks passed"
pnpm dev                 # the web app at localhost:3000, in mock mode (everything labelled SIMULATED)
pnpm test:contracts      # unit tests, then sandbox tests against a mock MPC signer
```

To run the web app against the real testnet contract, with NEAR wallets through near-connect:

```bash
NEXT_PUBLIC_NETWORK=testnet NEXT_PUBLIC_BEARER_CONTRACT=v3a.bearer-1108-ffb3.testnet pnpm dev
```

`demo:dry` runs a real NEAR sandbox with the committed contract (`contracts/res/`) and a mock MPC
signer. The three chains are simulated ledgers that apply each signed transaction (checking the
signature, spending coins or nonces, refusing anything spent twice); their lines start with
`SIMULATED`. Needs only Node 20.11+ and pnpm.

The sandbox tests check every signed transaction independently: viem for Base, bitcoinjs-lib and
noble for Bitcoin, `@solana/web3.js` for Solana. To repeat the testnet runs:

```bash
cd contracts/tests
pnpm spike:testnet setup       # needs BEARER_TESTNET_PARENT in .env (a faucet-created testnet account)
pnpm spike:testnet run         # create, transfer, 5 × break-and-withdraw on Base, 5 × Ed25519
```

## The web app

| Page | What it's for |
|---|---|
| `/v/[id]` | A vault's public page: seal, observed balances, custody, signatures, the attack lab |
| `/v/[id]/handover` | Hand a vault over in person: a QR code for the recipient, and the card flips when the transfer lands |
| `/v/[id]/certificate` | A printable bearer certificate, one A4 page, with a QR code to the live seal |
| `/proof` | Live checks against NEAR testnet, every measured number, and the threat table |
| `/derive` | Recompute a vault's three addresses in the browser from the MPC root keys |
| `/nft/[id].svg` | The vault NFT's image, drawn from its live state: seal intact, or broken once opened |

Each one is described in [docs/features](docs/features).

## How NEAR is used

| NEAR feature | Where | What it does in Bearer |
|---|---|---|
| Chain Signatures (`v1.signer-prod.testnet`, domains 0 and 1) | `contracts/bearer/src/withdraw_{evm,btc,sol}.rs` | Each vault controls native Bitcoin, Base and Solana addresses; the contract signs only withdrawals it builds, only for opened vaults, only for their owner |
| NEP-171 + NEP-177 | `contracts/bearer/src/lib.rs`, `transfer.rs` | The vault is a standard NFT; every transfer path goes through one seal gate. With `base_uri` set, its media is a live image of its seal |
| NEP-297 events | `events.rs` | Indexable history: created, transferred, opened, withdrawals requested, signed or failed |
| Yield/resume (through the signer) | the `on_*_signed` callbacks | Asynchronous signatures inside one user action; Bitcoin joins one request per input into one callback |
| Cross-contract views | `create_vault` | The signer's derived keys are fetched and stored at creation |

## Architecture

```text
 wallet ── NEAR tx ──▶ Bearer contract ── sign(payload built here) ──▶ MPC signer (v1.signer-prod)
                          │  ▲                                              │
                          │  └──────────── signature (callback, verified) ◀─┘
                          └── stores the signed Bitcoin / Base / Solana tx ──▶ anyone broadcasts it
```

The contract builds every payload itself (EIP-1559 transfers with empty calldata, Bitcoin P2WPKH
spends with SIGHASH_ALL and change back to the vault, one Solana system transfer with a recent
blockhash), verifies each signature against the vault's stored key, and stores the signed
transaction publicly. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Security

- **The seal:** no signature can exist for a sealed vault; transfers only happen while sealed. A
  recipient knows no withdrawal signature has ever been requested, on any chain.
- **Retries and late signatures are safe:** once opened, the owner is fixed forever. A retried or
  duplicated signature spends the same coins or the same nonce, and pays the same owner.
- **Threat model:** 17 rows with the tests that prove them, in
  [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).

## What you're trusting

- NEAR's MPC network, to sign only what the Bearer contract requests.
- The Bearer contract's code (open source; to be locked with no full-access keys).
- Each chain's normal fees and finality.
- Public data sources for the balances the UI shows (Blockstream Esplora, Base Sepolia RPC,
  Solana devnet RPC), labelled with source and time; the contract never relies on them.

## Repository

```text
apps/web            Next.js app: a simulated demo, or the testnet contract with NEAR wallets
contracts/bearer    the NEAR contract (near-sdk 5.30)
contracts/mock-signer   an MPC signer stand-in for the sandbox
contracts/tests     sandbox tests (near-sandbox) and testnet spikes
packages/sdk        shared types and the client interface
docs                architecture, threat model, decisions, spikes, and one page per web feature
```

## Limitations

- Once opened, a vault can't be transferred or sealed again.
- Bearer doesn't escrow payments between people; it guarantees what you receive is sealed and yours.
- Native coins only, and EVM withdrawals on Base Sepolia only.
- Balances are observed data and can lag an explorer.
- Testnet only. Not audited.

## Hackathon disclosure

Built for the NEAR Hackathon (window starting 2026-10-19). Libraries: near-sdk, near-contract-standards,
k256 and ed25519-dalek (mock signer), Next.js, React, TanStack Query, Radix, near-connect
(@hot-labs), qrcode.react, viem, bitcoinjs-lib, @noble and @scure, @solana/web3.js. AI tools: Claude Code (Anthropic) was used throughout for code,
tests and documentation. The same team lead also submitted **Sudo by Contract**, an independent
project. The two share no code.

## License

MIT. The license file is pending the owner's name.
