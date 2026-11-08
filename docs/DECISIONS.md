# Decisions

**For:** anyone wondering why Bearer is built the way it is.
Newest first. Each entry: date, decision, reason, alternatives considered.

## 2026-11-08 · Bitcoin spends hand-rolled in the contract

- **Decision:** `withdraw_btc` builds P2WPKH spends itself (BIP143 sighash, segwit serialization, bech32/bech32m, strict DER) in `contracts/bearer/src/bitcoin.rs`, without omni-transaction.
- **Reason:** one transaction shape is allowed (vault inputs, one payment, change to the vault, SIGHASH_ALL), so the code is small and every byte is ours to audit; it matches the hand-rolled EVM path and keeps the wasm lean (+32 KB). Spike 2's fallback, taken on purpose. Checked against BIP143/173/350 vectors and, in the sandbox, against bitcoinjs-lib and noble for every sighash and signature. That cross-check caught a `hashOutputs` bug the unit vector missed.
- **Alternatives:** omni-transaction 0.5 (more surface than one shape needs; would still need the same independent checks).

## 2026-11-08 · Bitcoin withdrawal details

- **Decision:** the deposit is `withdraw_deposit + mpc_sign_deposit` **per input** (brief 4.6 has one `withdraw_deposit` per withdrawal); inputs use sequence `0xfffffffd` (opt-in RBF); `verify_ecdsa` flips a high S to low S (and the recovery id) instead of rejecting it; change below 294 sats and payments below the dust limit are refused rather than silently given to fees.
- **Reason:** a 4-input record with its signed transaction is about 2 KB, twice one deposit; RBF is how a stuck withdrawal gets a higher fee (brief 4.9); Bitcoin (BIP146) and Ethereum (EIP-2) both require low S and the signer doesn't promise it; silent fee bumps would surprise the owner.
- **Alternatives:** a flat larger `withdraw_deposit` (overcharges Base withdrawals); final sequence (no fee bumps).

## 2026-11-08 · 8 Tgas per derived-key request; `create_vault` needs 44 Tgas

- **Decision:** `GAS_FOR_DERIVED_KEY` is 8 Tgas (was 5) and `create_vault` refuses less than 44 Tgas of prepaid gas with `ERR_GAS`.
- **Reason:** on testnet the signer's `derived_public_key` burns 5.29–5.37 Tgas (docs/SPIKES.md). With 5 Tgas static, creation only worked when the caller attached spare gas; with a tight budget the vault would be minted without keys until someone called `fetch_keys`.
- **Alternatives:** keep 5 Tgas and rely on `fetch_keys` (a needless failure on every tight wallet); `function_call_weight` alone (doesn't protect the low end).

## 2026-11-08 · FastNEAR RPC for testnet scripts

- **Decision:** testnet scripts default to `https://test.rpc.fastnear.com`, overridable with `NEAR_RPC`; the SDK's testnet adapter will use the same default.
- **Reason:** `rpc.testnet.near.org` is deprecated and returned HTTP 429 part-way through the signing spike; through it the same signature took about twice as long.
- **Alternatives:** other providers listed at docs.near.org/api/rpc/providers.

## 2026-11-08 · A dedicated testnet account for Bearer

- **Decision:** Bearer's testnet accounts live under `bearer-1108-ffb3.testnet` (faucet-created). The spike contract is `v3a.`; later deploys use fresh `v3b.`, `v3c.` … subaccounts. Keys stay in `~/.near-credentials`; `.env` holds names only.
- **Reason:** keeps Bearer separate from the sibling project's accounts (Q-015 disclosure) and follows brief 4.10: never upgrade a locked contract.
- **Alternatives:** reuse the sibling project's account (mixes the two projects on-chain).

## 2026-11-08 · Build contracts with `cargo` and `--cfg near`, not the local cargo-near

- **Decision:** build wasm with `RUSTFLAGS="--cfg near" cargo build --target wasm32-unknown-unknown --release`. Move to `cargo near build reproducible-wasm` with a current cargo-near for the committed, locked build (D5).
- **Reason:** the installed cargo-near is 0.11.0, which doesn't pass `--cfg near`, so every panic message would surface as `unreachable` (brief 6.6, gotcha 1), and its bundled wasm-opt can't read current Rust output (gotcha 2).
- **Alternatives:** upgrade cargo-near now (changes the global toolchain mid-sprint; deferred to D5).

## 2026-11-08 · Sandbox tests in JavaScript with the `near-sandbox` npm package

- **Decision:** contract integration tests live in `contracts/tests` and use `near-sandbox` 0.3.5 (nearcore 2.14) with `near-api-js` 7.
- **Reason:** brief 6.6 gotcha 4: it's the known-good path for nearcore 2.14; the v3 design has no time-based rules, so we don't need `fast_forward` from Rust near-workspaces.
- **Alternatives:** Rust `near-workspaces` (its bundled sandbox version must be checked; not needed).

## 2026-11-08 · No NEP-178 approvals

- **Decision:** the NFT has no approvals extension; `approval_id` must be `None`.
- **Reason:** every transfer path must go through the seal gate (T6). Approvals add paths for no v1 benefit.
- **Alternatives:** approvals with revocation on `break_seal` (later, if a marketplace needs them).

## 2026-11-08 · Custody log: 16 entries on-chain, prepaid at creation

- **Decision:** each vault stores its last 16 holders; full history comes from NEP-297 events.
- **Reason:** the NFT track asks for "who held it" per NFT. `nft_transfer` carries exactly 1 yoctoNEAR and can't pay for storage, so the log's storage is paid once by `create_vault`.
- **Alternatives:** events only (depends on an indexer for the history view); unbounded log (storage drain, T12).

## 2026-11-08 · Multi-chain, Bitcoin as the headline; build order Base → Bitcoin → Solana

- **Decision:** one seal covers all three addresses. Build Base first to prove the pipeline, then Bitcoin (headline), then Solana (first to cut). Day-3 checkpoint for Bitcoin.
- **Reason:** the sealed-vault rule is chain-agnostic, so extra chains cost adapter work only. Bitcoin is what only NEAR can do; EVM-only invites comparison with ERC-6551.
- **Alternatives:** Bitcoin only (reviewer's first suggestion); all three in parallel.

## 2026-11-08 · Adopt the sealed-vault model (brief v3)

- **Decision:** a vault is `Sealed` (transferable, no signatures possible) until its owner breaks the seal; then `Opened` forever (withdrawals only).
- **Reason:** a design review showed v2's per-chain proofs were the riskiest part of the build and still left room for pre-signed transactions. A one-way seal removes the attack instead of detecting it.
- **Alternatives:** v2 (Read RPC proofs for Base, Solana expiry window, Bitcoin encumbrance accounting).
