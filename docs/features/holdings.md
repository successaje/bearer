# Feature: NEAR-side holdings (v2)

**Branch:** `v2` · **Contract:** `contracts/bearer/src/holdings.rs`, version 0.4.0, deployed
unlocked as `bearer-v2.testnet` · **Status:** working on testnet with real wNEAR and a test NFT;
not on the hosted site (it stays on the locked v1, `bearer.testnet`)

**For:** whoever decides whether v2 ships. What a vault can now hold, the rules, and what was
checked on a real chain.

## What it is

A v1 vault holds only native coins at its Bitcoin, Base and Solana addresses. A v2 vault can also
hold NEAR, NEP-141 tokens and NEP-171 NFTs. The contract keeps them on the vault's behalf, so they
need no Chain Signatures, and they follow the vault's one rule:

- While sealed, they move with the vault, and nothing comes out, not even for the owner (H2).
- After opening, only the current owner can take them out (H3).

The rules for putting things in:

- **NEAR:** anyone can add it with `deposit_near`, since it can only help the holder.
- **Tokens and NFTs:** only the owner can load them, with `ft_transfer_call` or `nft_transfer_call`
  and `msg` set to the vault's number (H1). That way nobody can fill someone's vault with spam or
  use up its slots.
- **Storage:** each entry's storage is paid from the vault's own NEAR and refunded when it leaves
  (H6). A vault holds at most 8 kinds of token and 16 NFTs, and it can't hold another Bearer vault
  (H5).
- **Withdrawals:** each one marks what it moves as pending, and restores it if the transfer fails
  (H4, H8).

The hosted site's deposit sheet already warns that v1 vaults can't move tokens or NFTs sent to
their other-chain addresses. v2 doesn't change that: its tokens and NFTs are the ones held on
NEAR, by the contract.

## Checked

- **Sandbox:** `contracts/tests/holdings.test.ts` has 9 tests covering H1–H6 and H8, against a mock
  token and NFT contract (`contracts/mock-assets`). All 50 sandbox tests pass on the v2 build.
- **Testnet, 2026-11-09** (`BEARER_CONTRACT_ID=bearer-v2.testnet pnpm spike:testnet holdings`;
  report `contracts/tests/spike/reports/testnet-holdings-2026-11-09T13-41-25.065Z.json`). The run
  used vault No. 0002 on `bearer-v2.testnet`, with real wNEAR from `wrap.testnet` and an NFT
  from `bearer-assets.testnet` (the mock contract, deployed as a test collection).

| Step | Result | Tx |
|---|---|---|
| alice adds 0.05 NEAR | ok; 0.0484 left after the storage of three entries | [H6ZqzKEQ…](https://testnet.nearblocks.io/txns/H6ZqzKEQVMK3fX6nzYtSf1Sthn8R3uhZfFiaDToM3a7X) |
| alice loads 0.02 wNEAR | ok, 7.2 Tgas | [4guBup7B…](https://testnet.nearblocks.io/txns/4guBup7B9VVEdh5dzpK7qjjD2tQKVhWA6feVtdwXLYRN) |
| alice loads the NFT | ok, 7.2 Tgas | [CsRHjP2t…](https://testnet.nearblocks.io/txns/CsRHjP2tW2DwGUhnWa2aLrijLo1w8MhL8P2HMEgeNz7) |
| alice withdraws while sealed | refused, `ERR_VAULT_SEALED` | [37roMe3g…](https://testnet.nearblocks.io/txns/37roMe3gAAa54usMCHsUpoTEE9wuPNFpZUc8PmsJ768R) |
| alice hands the vault to bob; bob breaks the seal | ok | [CPAQ2bes…](https://testnet.nearblocks.io/txns/CPAQ2besuDhqPpgFh1EUeXXg7NQFurgsUvWon6VdsGYc), [8H5dGPMD…](https://testnet.nearblocks.io/txns/8H5dGPMDHVU4VGVdfqeSmJ9wHj5KPvjyUnE1hebPy9XQ) |
| alice, now the former owner, withdraws the NFT | refused, `ERR_NOT_OWNER` | [3STBVpjV…](https://testnet.nearblocks.io/txns/3STBVpjVPhd4da4KgWYvfPMww8fNQhuj36iai45UPDMp) |
| bob withdraws the wNEAR, the NFT, then all the NEAR | ok: bob received exactly 0.02 wNEAR and owns the NFT; the vault holds nothing | [6EqjYZsJ…](https://testnet.nearblocks.io/txns/6EqjYZsJtd7qVvmbUMqUNiFUUhWFrGyY7o66DMaUH4Sy), [9r955PT4…](https://testnet.nearblocks.io/txns/9r955PT4va9QBi7Y6oRLyfRHDc9bnwozeqA6T2pP68Xz), [Cr9PgEoZ…](https://testnet.nearblocks.io/txns/Cr9PgEoZQ4UkGjYASMVQFEDKTYmc2YCJzxpZpscvAAvZ) |

  One run (N = 1). Vault No. 0001 on `bearer-v2.testnet` is left loaded and sealed (0.0484 NEAR,
  0.02 wNEAR, NFT `bearer-v2-1`), for trying the UI.
- **Web:** the vault page's "Held on NEAR" panel shows the vault's NEAR, each token's amount,
  symbol and contract, and each NFT's title, contract and id. Add NEAR is for anyone; Load a token
  and Load an NFT for the owner; Withdraw per item once the vault is opened.
  - In the simulated demo: loading and withdrawing worked, at 1280 px, with no overflow at 375 px.
  - Locally against `bearer-v2.testnet`: it reads vault No. 0001's real holdings, including the
    symbol and decimals from `wrap.testnet`.
  - A Vercel preview of the v2 branch points at `bearer-v2.testnet`. It sits behind Vercel's login.

## Not done yet

- **Real wallet.** Loading and withdrawing through a browser wallet hasn't been done yet.
- **Lock.** `bearer-v2.testnet` still has its full-access key and was built with `build.sh`, not
  reproducibly. If v2 ships, it needs the reproducible build and the lock, as v1 had.
- **Image address.** It has no `base_uri`, because the site's NFT image route reads the contract
  the site points at.
- **Hosted site.** Moving it to v2 would also mean moving the market (which sells
  `bearer.testnet` vaults) and the recorded attacks.
- **Other chains.** Tokens and NFTs on Base, Solana and Bitcoin are a later step; see
  [roadmap below](#later).

## Later

- ERC-20 and ERC-721 on Base, SPL tokens and NFTs on Solana: the contract would build each typed
  transfer itself, so it still never signs arbitrary data (T7).
- Bitcoin inscriptions and runes last: withdrawals would need to choose coins carefully so they
  don't spend an inscription.
