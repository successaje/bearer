# Spikes

**For:** whoever builds the next contract or SDK piece. What has been proven on testnet, with
measured numbers (N stated) and links you can check. Newest first.

## 2026-11-08 · Signing on testnet (brief 7.3, spikes 1, 4 and 5)

**Setup.** Contract `v3a.bearer-1108-ffb3.testnet` (spike account, not locked), the real MPC signer
`v1.signer-prod.testnet`, RPC `https://test.rpc.fastnear.com`. Accounts `alice.` and
`bob.bearer-1108-ffb3.testnet` play the sender and recipient. Script:
[`contracts/tests/spike/testnet-sign.ts`](../contracts/tests/spike/testnet-sign.ts); raw numbers:
[`testnet-sign-2026-11-08T21-40-03.590Z.json`](../contracts/tests/spike/reports/testnet-sign-2026-11-08T21-40-03.590Z.json).

```bash
cd contracts/tests
pnpm spike:testnet setup    # subaccounts, deploy, init (skips what exists)
pnpm spike:testnet run      # create, transfer, 5 × break/withdraw, 5 × Ed25519
pnpm spike:testnet gas-floor
```

### Results

| Check | Result |
|---|---|
| Signer pointers (brief 4.2) | `version` 3.18.0. Domain 0 is secp256k1 (CaitSith), domain 1 Ed25519 (Frost). `derived_public_key({path, predecessor, domain_id})` and `sign({request: {path, payload_v2, domain_id}})` take the shapes the contract sends. |
| **Spike 4:** keys at creation | `create_vault` fetched all three derived keys by cross-contract call. Keys visible 6.5 s after submitting (N = 1). Whole transaction 24.2 Tgas; each `derived_public_key` 5.29–5.37 Tgas; `on_derived_keys` 2.03 Tgas; `create_vault` itself 4.69 Tgas. Storage: 1,060 bytes for a vault with a 32-byte name and one custody entry. [tx](https://testnet.nearblocks.io/txns/HVMgfMrjDH5QPycMKYt4BmiLFdSSvWzf87LT3N2kJ5Kn) |
| **Spike 5:** parity | The stored Bitcoin, Base and Solana keys equal the signer's own `derived_public_key(contract, path)` for all three. The stored `evm_address` equals viem's address for the stored key. |
| **Spike 1:** domain 0 through the contract | 5 of 5 `withdraw_evm` requests signed. Run 1 sent `break_seal` and `withdraw_evm` as two actions in one transaction. **Median 7.7 s** from submitting to the signed transaction showing in `withdrawals` (N = 5, range 7.4–8.4 s). Every signed transaction recovers to the vault's address, on chain 84532, type 2, nonces 0–4. Gas per withdrawal 14.5 Tgas (16.7 with `break_seal`): contract 3.0, signer `sign` 4.27 + 3.46 on resume, `on_evm_signed` 2.5. |
| **Spike 1:** domain 1, called directly | 5 of 5 Ed25519 signatures verify against `derived_public_key(alice, path, 1)`. **Median 8.0 s** to the final outcome (N = 5, range 7.4–8.1 s). 8.5 Tgas each. |
| Base Sepolia accepts the format | `eth_sendRawTransaction` with run 1's transaction was refused only for balance: `insufficient funds for gas * price + value: have 0 want 43000000000000`. So the encoding and signature parse, and the sender recovers as the vault. |
| **Spike 3**, protocol level | `break_seal` + `withdraw_evm` in one transaction works and is atomic in the sandbox test. Wallet support through near-connect is not tested yet. |

Latency is measured by polling the RPC every 500 ms, so each figure includes up to half a second
of polling. An earlier, aborted run through `rpc.testnet.near.org` took 16.2–16.8 s for the same
step before that endpoint rate-limited it (HTTP 429); no report was saved from it.

### What changed because of it

- `GAS_FOR_DERIVED_KEY` went from 5 to 8 Tgas: the real signer burns more than 5, and the first run
  only worked because spare gas was shared out.
- `create_vault` now refuses less than 44 Tgas with `ERR_GAS`, so a wallet can't mint a vault whose
  key requests run short. Checked on testnet after redeploying: 40 Tgas refused, 44 Tgas stored the
  keys ([tx](https://testnet.nearblocks.io/txns/62WxydYMo6shiAwGfgH4C86e5Yn2547A71j7nNAWDi4i)).
  Sandbox test `create_vault_requires_gas_for_keys`.
- The SDK's testnet adapter must attach at least 44 Tgas to `create_vault` and 50 Tgas to each
  `withdraw_evm`.

### Still open from 7.3

- **Spike 1, Bitcoin part:** 2–4 payloads joined with `Promise::and` into one callback, its gas,
  and `max_btc_inputs`. Lands with `withdraw_btc`.
- **Spike 2:** omni-transaction in wasm for Bitcoin P2WPKH. EVM is hand-rolled and proven above.
- **Spike 3** through real wallets (near-connect).
- **Spike 5** against chainsig.js: compared with the signer's view here; the chainsig.js check
  comes with the SDK's `deriveAddresses`.
- **Spike 6, faucets (needs the human):** Base Sepolia ETH, testnet4 BTC, Solana devnet SOL.
  Vault No. 0002 (`0xc1ABcBdD132e2D965772351FA1193688Db162939` on Base Sepolia) already holds a
  signed nonce-0 transaction: a self-transfer of 0.000001 ETH. Sending 0.0001 ETH there lets us
  broadcast it as the first real Base withdrawal from an opened vault.
