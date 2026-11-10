#!/usr/bin/env bash
# Builds the Bearer contract, the market, the schedule and the sandbox mocks (signer, NFT receiver) to contracts/out/.
# Uses --cfg near so panic messages survive (docs/DECISIONS.md, brief 6.6 gotcha 1).
# The committed, locked build will use `cargo near build reproducible-wasm` (D5).
set -euo pipefail
cd "$(dirname "$0")"
RUSTFLAGS="--cfg near -C link-arg=-s" cargo build --target wasm32-unknown-unknown --release -p bearer -p market -p mock-receiver -p mock-signer -p schedule
mkdir -p out
cp target/wasm32-unknown-unknown/release/{bearer,market,mock_receiver,mock_signer,schedule}.wasm out/
ls -l out/*.wasm
