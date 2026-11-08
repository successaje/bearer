# Bearer architecture

**For:** contributors and reviewers.
**After reading** you'll know the moving parts, how a vault moves through its life, and where each piece lives in the repo.

## Overview

```text
 ┌───────────────────────────┐   sign (domain 0 / 1)          ┌────────────────────────┐
 │ Bearer contract (Rust)    │ ─────────────────────────────▶ │ NEAR MPC signer        │
 │ NEP-171 + vault state     │ ◀──── signature (yield/resume) │ v1.signer-prod.testnet │
 │ - Sealed → Opened (once)  │                                └────────────────────────┘
 │ - one transfer gate       │   derived keys: predecessor = Bearer contract,
 │ - custody log, events     │   path = bearer:v3:{token_id}:{chain}
 └────────────▲──────────────┘                  │
              │ near-api-js / near-connect      ▼
 ┌────────────┴──────────────┐  broadcast   ┌────────────┬────────────┬─────────────┐
 │ Web app (Next.js 16)      │ ───────────▶ │ Bitcoin    │ Base       │ Solana      │
 │ + @bearer/sdk             │ ◀── observe ─│ testnet4   │ Sepolia    │ devnet      │
 └───────────────────────────┘   balances   └────────────┴────────────┴─────────────┘
```

## Vault lifecycle

```text
            create_vault                  break_seal (owner, 1 yocto)
   (none) ───────────────▶  SEALED  ─────────────────────────────▶  OPENED
                             │  ▲                                    │
          internal_transfer  │  │ (owner changes,                    │ withdraw_* (btc / evm / sol)
          (any path)         └──┘  stays SEALED)                     ▼ (owner, repeatable)
   No arrow leaves OPENED. No arrow returns to SEALED.
```

## Contract (`contracts/bearer`)

| File | Responsibility |
|---|---|
| `lib.rs` | State, `new`, `create_vault`, views, NEP-171/177/181 wiring |
| `vault.rs` | `Vault`, `VaultState`, custody log, paths |
| `transfer.rs` | The one transfer gate: `nft_transfer`, `nft_transfer_call`, `nft_resolve_transfer` |
| `seal.rs` | `break_seal` |
| `withdraw_{evm,btc,sol}.rs` | Typed withdrawals that build payloads and call the signer (added per build order: Base, Bitcoin, Solana) |
| `mpc.rs` | Signer request and response types, signature checks |
| `events.rs` | NEP-297 events (`standard: "bearer"`, `version: "3.0.0"`) |

Every owner change goes through `transfer.rs`. No other code writes the owner.

## Mock signer (`contracts/mock-signer`)

Sandbox-only stand-in for `v1.signer-prod.testnet`. Same method names and JSON shapes (`sign`, `derived_public_key`, `public_key`), deterministic keys `sha256(seed ‖ predecessor ‖ path ‖ domain)`, and switches to return errors or wrong-key signatures so failure paths can be tested.

## Tests (`contracts/tests`)

JavaScript sandbox tests using the `near-sandbox` npm package (nearcore 2.14) and `near-api-js` 7. Each threat-model row maps to a named test.

## SDK (`packages/sdk`)

`@bearer/sdk`: shared vault types, address derivation, balance observation, withdrawal parameter building and broadcasting, with `testnet` and `simulated` adapters. The web app imports its types from here.

## Web app (`apps/web`)

Next.js 16. Talks to Bearer through the `BearerClient` interface; `NEXT_PUBLIC_NETWORK=mock` uses an in-browser mock, `testnet` will use `@bearer/sdk`.
