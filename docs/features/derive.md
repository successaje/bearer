# Feature: derive it yourself

**Branch:** `feat/derive` · **Route:** `/derive?vault=N` (linked from each vault's Technical details and the footer) · **Status:** merged into main on 2026-11-09

**For:** whoever decides whether this ships. What the page proves, the exact formula, and how it
was checked.

## What it is

Brief 4.5 asks for a way to "derive it yourself" so nobody has to trust that a vault's addresses
are really the vault's. This page does it in the browser, as a six-step trace:

1. Fetch NEAR's MPC root **public** keys (`public_key` for domains 0 and 1).
2. Build each path exactly as the contract does: `bearer:v3:{id}:{btc|evm|sol}`.
3. Hash the contract's account and the path into a tweak ε.
4. Add the tweak to the root key (point addition; nothing secret).
5. Turn each key into an address: P2WPKH `tb1q…`, the Base `0x…`, the Solana base58 key.
6. Compare with what the contract stores **and** what the signer derives for itself: nine checks
   (address, key vs contract, key vs signer, for each chain), then one verdict.

Everything after step 1 is computed locally with audited libraries (`@noble/curves`,
`@noble/hashes`, `@scure/base`); the only other fetches are the two views it compares against.
In the simulated demo, vault keys are made up, so the page reads the live testnet deployment. A
simulated vault's Technical details therefore link to `/derive` (vault No. 0001 by default, which
both the spike contract and `bearer.testnet` have) rather than to their own number. If the
contract has no such vault, the form says so and offers No. 0001 in one click. The "Open vault" link after a match only appears against the real chain,
since the simulated app can't open a testnet vault.

## The formula

Matched against `v1.signer-prod.testnet`'s own `derived_public_key` on 2026-11-08 for both
domains, then for every key of vault No. 0004:

```
ε = SHA3-256("near-mpc-recovery v0.1.0 epsilon derivation:" ‖ contract ‖ "," ‖ path)
secp256k1 (domain 0):  key = root + ε·G   (ε as a big-endian integer mod n)
Ed25519   (domain 1):  key = root + ε·B   (ε as a little-endian integer mod ℓ)
```

This also closes brief 7.3 spike 5 (address parity) without chainsig.js: the derivation is
reproduced from first principles and agrees with both the contract and the signer.

## Checked

- Node, against vault No. 0004 on `v3a.bearer-1108-ffb3.testnet`: all three keys and addresses
  match the contract's.
- In the browser (headless Chrome): vaults 4 and 2 end in "All nine match". Checked at 1440 px and
  390 px, dark and light.

## Files

- `apps/web/src/lib/derive/derive.ts`: the derivation, as pure functions.
- `apps/web/src/components/derive/derive-view.tsx`, `apps/web/src/app/derive/page.tsx`.
- Links: `technical-details.tsx`, `site-footer.tsx`, `sitemap.ts`.
