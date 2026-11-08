# Spikes

**For:** whoever builds the next contract or SDK piece. What has been proven on testnet, with
measured numbers (N stated) and links you can check. Newest first.

## 2026-11-08 · First Bitcoin withdrawal from an opened vault

The full Bitcoin story on testnet4, run by `pnpm spike:testnet btc-withdraw 4` as soon as the
human's deposit confirmed:

1. Vault No. 0004, sealed and held by `alice.`, received 0.00265715 tBTC
   ([funding tx](https://mempool.space/testnet4/tx/408c696c0f5b892b03500e08905fca15657fa12d457aa157108212331a2994aa),
   confirmed in block 159,945).
2. `alice.` transferred the vault to `bob.`
   ([NEAR tx](https://testnet.nearblocks.io/txns/BdKaeEoa14LRBG2W9YXAPEZVwVihUTMiQSUHusWTiHjk)). Nothing
   moved on Bitcoin.
3. `bob.` broke the seal and withdrew in **one NEAR transaction**
   ([NEAR tx](https://testnet.nearblocks.io/txns/hVm36gP4mzWCETMMtuXEg33hGCnuj1aAdrzxeF9iW9F)): one coin in,
   132,716 sats to the destination (the vault's own address, for this test) and 132,717 sats change
   back to the vault, fee 282 sats (2 sat/vB, 141 vB). NEAR's MPC signed it 6.5 s after submitting
   (N = 1); 17.4 Tgas for the whole transaction.
4. bitcoinjs-lib verified the spend; Blockstream's Esplora accepted the broadcast:
   **[`ce01f9ff…58b6`](https://mempool.space/testnet4/tx/ce01f9fffdf0f362641a4f6882257295ae63de6146c5a3478704ef809bf958b6)**
   ([alt](https://blockstream.info/testnet4/tx/ce01f9fffdf0f362641a4f6882257295ae63de6146c5a3478704ef809bf958b6)).

This meets D3's checkpoint in brief 7.2: a real Bitcoin withdrawal signed and broadcast. Raw
numbers: [`testnet-btc-withdraw-2026-11-08T23-32-00.077Z.json`](../contracts/tests/spike/reports/testnet-btc-withdraw-2026-11-08T23-32-00.077Z.json).

## 2026-11-08 · Solana: a withdrawal signed through the contract

`withdraw_sol` on vault No. 0002 (opened, held by `bob.`), with a fresh devnet blockhash: a
1,000-lamport transfer from the vault to itself. NEAR's MPC signed it with its Ed25519 domain and
the callback checked the signature with `env::ed25519_verify` (N = 1).

| | |
|---|---|
| Signed after | 8.3 s from submitting ([tx](https://testnet.nearblocks.io/txns/AWiMXRvuX3sRdVEmbcQ76TfEJahjuRE3yZssj26hpsvu)) |
| Gas | 14.8 Tgas for the whole transaction |
| Checked | `@solana/web3.js`: signature valid, the vault pays the fee, exactly one transfer |
| Devnet simulation (`sigVerify: true`) | Passed signature checks; stopped at `AccountNotFound` because the vault holds no SOL yet |

Devnet's RPC airdrop is closed ("Request test SOL at https://faucet.solana.com"), so funding
needs the human. Once `Dgx8782F7YJYYYYsKuk1uhdyPbvnu2DNRFrfKKGKgUKn` holds about 0.05 devnet SOL:

```bash
cd contracts/tests && pnpm spike:testnet sol-withdraw 2
```

signs a new withdrawal and broadcasts it. Raw numbers:
[`testnet-sol-withdraw-2026-11-08T22-51-57.356Z.json`](../contracts/tests/spike/reports/testnet-sol-withdraw-2026-11-08T22-51-57.356Z.json).

## 2026-11-08 · Bitcoin: joined signatures on the real signer (spike 1, Bitcoin part)

`withdraw_btc` asks for one signature per input and joins the requests with `Promise::and` into a
single callback, which checks every signature against the vault's key before assembling the
transaction. Run on vault No. 0002 (opened, held by `bob.`) against `v1.signer-prod.testnet`
3.18.0, one request per input count (N = 1 each). The inputs were made up: the contract can't see
UTXOs, so the signer is exercised exactly as for real coins, and these transactions are never
broadcast. Each signed spend was checked with bitcoinjs-lib (every BIP143 sighash) and noble
(every DER signature, low S).

| Inputs | Signed after | Whole transaction | Callback | Spend size | NEAR tx |
|---|---|---|---|---|---|
| 1 | 8.4 s | 15.1 Tgas | 2.8 Tgas | 141 vB | [6sgH…DfBUg](https://testnet.nearblocks.io/txns/6sgHQHE1ZF7oyANs12vo51ZjBKAwbft4ZLdSod8DfBUg) |
| 2 | 6.6 s | 24.2 Tgas | 3.3 Tgas | 209 vB | [ERyC…ivbsDp](https://testnet.nearblocks.io/txns/ERyCn7csjhWSHAFGW4e7R1628K9SkQxPCSsa6PivbsDp) |
| 3 | 7.8 s | 33.4 Tgas | 3.9 Tgas | 277 vB | [CcfM…AhHWJ](https://testnet.nearblocks.io/txns/CcfMaWKDeUKCw2HYQ9Ku7yFU8gw5KHuSNkgTkidAhHWJ) |
| 4 | 7.1 s | 42.6 Tgas | 4.4 Tgas | 345 vB | [36qY…dkE3g](https://testnet.nearblocks.io/txns/36qY45goGQa5ugznPh9ixF2ENVLshfY9ZnYcG23dkE3g) |

Each extra input adds about 9.2 Tgas (the signer's `sign` 4.2 + 3.4 on resume, plus the contract's
share). Four inputs use 42.6 of the 300 Tgas a transaction may carry, so `max_btc_inputs` stays at
4 with plenty of room; `GAS_FOR_BTC_CALLBACK` (30 Tgas) covers the measured 4.4 several times over.
Raw numbers: [`testnet-btc-joined-2026-11-08T22-26-24.540Z.json`](../contracts/tests/spike/reports/testnet-btc-joined-2026-11-08T22-26-24.540Z.json).

**Funded and done** (see "First Bitcoin withdrawal" above). Vault No. 0004 was sealed and held by `alice.`; its Bitcoin address,
`tb1qf6fqncrezc8qu8lpg5pqqssv3jaxkxkpjkxqjp`, was checked three ways (contract, signer's derived
key, bitcoinjs-lib). Once it holds confirmed testnet4 coins:

```bash
cd contracts/tests && pnpm spike:testnet btc-withdraw 4
```

transfers it to `bob.`, has bob break the seal and withdraw in one NEAR transaction, verifies the
spend and broadcasts it. `mempool.space` didn't answer from this machine, so the script uses
Blockstream's testnet4 Esplora API (`ESPLORA_API` to change it).

## 2026-11-08 · First Base withdrawal broadcast from an opened vault

Vault No. 0002 on `v3a.bearer-1108-ffb3.testnet` was opened by `bob.bearer-1108-ffb3.testnet`, and
its withdrawal #0 was signed by NEAR's MPC network (section below). After the human funded the
vault's Base address with 0.0001 ETH, the stored transaction was read from the contract's public
`withdrawals` view, checked to recover to the vault's address, and broadcast:

| | |
|---|---|
| Transaction | [`0xb347…20e3`](https://sepolia.basescan.org/tx/0xb347d755df6105ef2deb58158533f31fa5687586992308ee2fed0e4622ee20e3) on Base Sepolia, block 56,270,095 |
| From → to | `0xc1ABcBdD132e2D965772351FA1193688Db162939` (the vault) → itself, 0.000001 ETH |
| Result | Success, 21,000 gas, nonce 0 → the vault's nonce is now 1 |
| Receipt | 2.0 s after `eth_sendRawTransaction` (N = 1) |

```bash
cd contracts/tests && pnpm spike:testnet broadcast 2 0
```

This meets D2's acceptance in brief 7.2: one real Base withdrawal from an opened vault. The vault
still holds signed transactions for nonces 1–4, which anyone can broadcast in order.

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

- ~~**Spike 1, Bitcoin part**~~: done (joined signatures, above).
- ~~**Spike 2**~~: decided against omni-transaction; Bitcoin is hand-rolled like EVM (docs/DECISIONS.md).
- **Spike 3** through real wallets (near-connect).
- **Spike 5** against chainsig.js: compared with the signer's view here; the chainsig.js check
  comes with the SDK's `deriveAddresses`.
- **Spike 6, faucets (needs the human):** Base Sepolia ETH and testnet4 BTC are funded. Still
  needed: devnet SOL for vault No. 0002's Solana address (above).
