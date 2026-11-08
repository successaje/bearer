# Decisions

**For:** anyone wondering why Bearer is built the way it is.
Newest first. Each entry: date, decision, reason, alternatives considered.

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
