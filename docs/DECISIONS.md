# Decisions

**For:** anyone wondering why Bearer is built the way it is.
Newest first. Each entry: date, decision, reason, alternatives considered.

## 2026-11-12 · If I go quiet: a dead man's switch as a fourth escrow contract

- **Decision:** `contracts/switch` (`bearer-switch.testnet`) holds a sealed vault while its owner checks in, and hands it to the beneficiary they named once a whole interval passes without a check-in. The owner can check in, change the beneficiary or interval (which counts as a check-in) or take the vault back at any time until it's handed over; a late check-in still counts until then. Anyone may trigger the hand-over, and it can only go to the beneficiary, after a 1-yoctoNEAR probe shows their account exists. A 0.01 NEAR deposit per switch, returned to the owner either way. Built on its own branch (`switch`).
- **Reason:** the owner asked for "savings that pass on if I'm not around": the most emotional of the use cases, and one a sealed vault answers well, because the beneficiary can check nothing has been taken out. The schedule hands over on a fixed date and can't be pushed back; a switch is a schedule whose date moves with each check-in. It follows the market, schedule and lending contracts: escrow by transfer, no `break_seal`, vault first, callbacks that never panic, no admin methods.
- **Alternatives:** letting the beneficiary claim only after the owner's late check-in window closes for good (refuses an owner who comes back after a long illness, for a beneficiary who paid nothing); notifying the owner before the deadline (needs an off-chain service holding contact details, which the project avoids); several beneficiaries with shares (a vault is one object; several heirs means several vaults).

## 2026-11-11 · Lending: a separate contract holds the vault; no price feed, a fixed term

- **Decision:** `contracts/lend` (`bearer-lend.testnet`) lends NEAR against a sealed vault. The borrower sends the vault with `nft_transfer_call` and the loan's terms (principal, repayment, term). A lender calls `fund` with exactly the principal, naming the repayment and term they saw; the principal goes straight to the borrower and the term starts. Before the due date only the borrower can `repay` (vault back first, then the lender is paid); from the due date only the lender can `foreclose`. Before anyone lends, the borrower can take it back. A 0.01 NEAR deposit per loan, checked against the storage a funded loan uses, returned to the borrower whichever way it ends. Reproducibly built from `883873d` (sha256 `79c7cf83…7ec3`, code hash `9CP3cAHg…GmyU`) and locked on 2026-11-11, like the market and the schedule.
- **Reason:** borrowing against Bitcoin without wrapping it is the use case the owner picked from docs/USE_CASES.md (#17). A sealed vault is collateral that can't be drained while pledged, because only its holder can break the seal and the contract never does; the market and the schedule already hold vaults the same way. Repay and foreclose never overlap in time, so there's no race at the deadline. `fund` names the terms so a borrower can't swap them between a lender's look and their transaction (L7).
- **Alternatives:** a price feed with liquidation (needs an oracle and a keeper, and a liquidation would sell the vault to someone, which needs a market inside the loan; a fixed term is a pawn-shop loan anyone can reason about); letting the borrower repay late until the lender acts (a race at every deadline, and the lender couldn't plan); anyone may repay for the borrower (refunds would have to go to whoever paid; not needed yet).

## 2026-11-10 · Card art by category, read from the name

- **Decision:** a vault's card shows art for what it's for (gift, birthday, prize, savings, time capsule, love letter, and three fun ones: pizza money, to the moon, treasure). The category is read from the name: a leading emoji, which the create form adds, or else a few whole words; no match keeps the classic card. The same SVG art is drawn on the site, in the NFT image and in link previews.
- **Reason:** the owner asked for images that fit the occasion, not only cards. The contract is locked and stores just a name and a finish, so the name is the only place a category can live; an emoji there is visible in wallets too and costs 4 or 5 of its 32 bytes.
- **Alternatives:** mapping categories onto the six finishes (would change what existing vaults look like, and ties colour to occasion); a category stored off chain (the site has no database, and wallets wouldn't see it); a new contract field (the contract is locked).

## 2026-11-10 · Bearer links: the new key is saved before anything moves

- **Decision:** "Pass it on" stores the new link in the browser and shows it to be saved before any transaction; every step checks what already happened, so the old link resumes or cancels an interrupted pass-on. `pnpm spike:links mint` writes each key to disk before any transaction and finishes unfinished links on the next run.
- **Reason:** a reviewer reading the code found that the new key lived only in the page's memory (and, in the script, was saved only after the vault and its coins had moved). An interruption at the wrong moment would have left a vault nobody could reach. Tested by interrupting both on testnet (T19).
- **Alternatives:** keeping the new key in sessionStorage only (lost with the tab); sending the vault and the key in one step (no such thing: the key has to exist before the vault can move to it).

## 2026-11-10 · Bearer links: a vault sent as a link, with no contract change

- **Decision:** a link `/claim#<seed>` holds a vault through the seed's NEAR implicit account. The page signs with the key in the browser (`apps/web/src/lib/vault/bearer-link.ts`: Borsh, ed25519, `send_tx`), and the app's wallet bridge uses it while the link is open, so every vault page works without a wallet. "Pass it on" moves the vault to a new link's account, which empties the old link. `pnpm spike:links` makes links: a sealed vault per link, handed to a fresh key's account with 0.2 NEAR for fees, its Bitcoin paid from one opened treasury vault.
- **Reason:** judges and recipients without a NEAR wallet could only read; now they can hold, pass on and open a vault with real testnet coins from a link. It also shows Bearer's point directly: an old copy of a passed-on link is worth nothing. The contracts are locked, so the brief's claim keys in the contract (T13) were out; this needs none, and T13 is met by moving the vault, not by deleting a key.
- **Alternatives:** claim keys inside the contract (needs a new deployment); a server that holds the keys and claims for you (custody); near-api-js in the browser (a much larger bundle for one transaction type).

## 2026-11-09 · Scheduled handover: a separate contract, released by anyone after the date

- **Decision:** `contracts/schedule` (`bearer-schedule.testnet`) holds a sealed vault sent with `nft_transfer_call` and a message naming the recipient, the date and whether the giver may cancel. On or after the date anyone may call `release`, which sends the recipient 1 yoctoNEAR first and moves the vault only if that succeeds; the giver may cancel only if they chose to and only before the date. A 0.01 NEAR deposit per schedule, paid back at the end. Reproducibly built and locked, like Bearer and the market.
- **Reason:** a reviewer suggested a gift that arrives on a day (a parent's vault for a child's graduation). Bearer is locked, so escrow by transfer is the only way, and it keeps the seal: the schedule never breaks one. A blockchain doesn't act on its own, so release is a call anyone can make; it can only go to the recipient, so it needs no trusted keeper. The existence check exists because a NEAR NFT can be sent to a name nobody has registered, and whoever registered it later would get the vault.
- **Alternatives:** a keeper service that releases on time (a trusted party and a server); letting the giver change the recipient (turns a promise into a draft; cancel and reschedule instead, when cancellable); an on-chain message (public forever; a message on the card instead, later).

## 2026-11-09 · Market: a separate contract that holds listed vaults in escrow

- **Decision:** sales go through `contracts/market` (`bearer-market.testnet`). The seller sends the vault with `nft_transfer_call` and a price; the market keeps it until `buy` (exact price) or `delist`. Settlement moves the vault first and money second: a vault that didn't move refunds the buyer, a bounced payout becomes claimable. Each listing holds a 0.01 NEAR deposit, checked against the storage it uses and returned with the sale or delisting; it's paid in its own transaction because `nft_transfer_call` forwards only 1 yoctoNEAR. Reproducibly built like Bearer. See docs/features/market.md.
- **Reason:** the reviewer asked for a marketplace with a safe exchange. Bearer is locked and has no NEP-178 approvals (T6), so escrow by transfer is the only way to sell without the seller online. It also answers "is it still the seller's, and still sealed?" by construction: the market holds it, and Bearer's gate checks again in the receipt that moves it.
- **Alternatives:** approvals (Bearer refuses them on purpose and can't change); a signed offer the seller settles later (needs the seller online, and the price check moves off-chain); the market paying listing storage itself with a cap (a full market would block new listings for free).

## 2026-11-09 · The committed contract is the reproducible build

- **Decision:** `contracts/res/bearer.wasm` is the output of `cargo near build reproducible-wasm --manifest-path contracts/bearer/Cargo.toml` at commit `71f194e`, run with the official cargo-near 0.22.0 binary (release checksum verified) in the image pinned in `contracts/bearer/Cargo.toml` (`sourcescan/cargo-near:0.22.0-rust-1.98.1`, by digest). Two builds from fresh clones gave the same bytes, sha256 `05b27506…8619`, code hash `PEsHBVDK…Vq1S`. `contracts/build.sh` stays for tests and development (`contracts/out/`). The contract's NEP-330 metadata now names its standards: NEP-171, 177, 181 and 297 besides 330 (no NEP-178 approvals, T6).
- **Reason:** brief 4.10 and D5: anyone can rebuild the deployed code byte for byte and compare hashes, and the metadata says how (image, command, commit), so explorers and verifiers can check it without asking us. cargo-near 0.22 passes `--cfg near` (panic messages survive: `ERR_GAS` on testnet) and runs a current wasm-opt, which fixes both reasons for the earlier `cargo` build.
- **Alternatives:** compiling cargo-near from source (filled the disk); keeping the `build.sh` output (not reproducible; `build_info` empty).

## 2026-11-09 · Hosting: Vercel, built locally and deployed prebuilt

- **Decision:** the web app runs on Vercel at `https://bearer-near.vercel.app` (project `bearer`, the owner's personal scope), in testnet mode. `scripts/deploy-web.sh` pulls the project's production settings and env vars, builds at the repo root with `apps/web` as the root and Node 22, refuses a build that still points at `localhost:3000`, and deploys the output with `vercel deploy --prebuilt --prod`. Production env vars on the project: `NEXT_PUBLIC_NETWORK=testnet`, `NEXT_PUBLIC_BEARER_CONTRACT`, `NEXT_PUBLIC_SITE_URL`. `NEXT_PUBLIC_REPO_URL` is left out while the repository is private.
- **Reason:** the app imports `packages/sdk` from the pnpm workspace, so Vercel must build with Root Directory `apps/web` from an upload of the whole repo. The project was created with Root Directory "." and Vercel CLI 48.9 can't change it (nor does it accept the project's default Node 26.x), while `vercel build` reads those settings from the local `.vercel/project.json`. Vercel's Linux runtime has no system fonts, so the Open Graph image draws the card's words itself (see docs/features/nft-media.md).
- **Alternatives:** set Root Directory to `apps/web` in the Vercel dashboard and connect the Git repository for remote builds on every push (better long term; needs the owner's dashboard login); a `vercel.json` at the root (Vercel's Next.js builder looks for `next` in the root package.json, so it doesn't work for this layout).

## 2026-11-09 · `demo:dry` with committed wasm and simulated ledgers

- **Decision:** `pnpm demo:dry` deploys `contracts/res/bearer.wasm` and `mock_signer.wasm` (committed, with `SHA256SUMS`) to a local `near-sandbox`, and simulates the three chains as ledgers that really apply each signed transaction. It is plain JavaScript (`contracts/tests/demo/dry.mjs`) so it runs on Node 20.
- **Reason:** brief 6.4: a judge with only Node and pnpm sees the story and every attack, and T10 needs a ledger that refuses a second spend. Since 2026-11-09 the `res/` wasm is the reproducible build (see that entry).
- **Alternatives:** only the sandbox tests (no story for a judge); testnet only (needs funds).

## 2026-11-08 · Solana transfers hand-rolled; recent blockhash only

- **Decision:** `withdraw_sol` builds a legacy message with exactly one SystemProgram transfer (the vault signs and pays the fee) in `contracts/bearer/src/solana.rs`; the callback checks the MPC's Ed25519 signature with `env::ed25519_verify`. `payload_hashes` holds the SHA-256 of the message (the signer signs the message itself, which is inside `signed_raw_tx`).
- **Reason:** brief 7.3 spike 2 asked whether omni-transaction covers Solana; one fixed shape is ~100 lines and leaves no room for extra instructions. Always using a recent blockhash means no durable nonce can ever be signed (T7), so a signature can't wait in a drawer: it dies with its blockhash. Since an opened vault's owner is fixed, an expired withdrawal just gets re-requested.
- **Alternatives:** omni-transaction or a Solana SDK crate in wasm (much more code than one message shape).

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

- **Decision:** Bearer's testnet accounts live under `bearer-1108-ffb3.testnet` (faucet-created). The spike contract is `v3a.`; later deploys use fresh `v3b.`, `v3c.` … subaccounts. (The final contract became `bearer.testnet`, created through the faucet on 2026-11-09 and locked.) Keys stay in `~/.near-credentials`; `.env` holds names only.
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
