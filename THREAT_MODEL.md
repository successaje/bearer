# Every way a seller could keep the money

This page answers one question: once a Bearer vault has changed hands, can anyone who held it
before still take what's inside? Each row is a way to try, why it fails, and the proof. The full
threat model, with every test and the market, schedule, lending and switch rows, is
[docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).

## The rule

> A vault can change hands only while it is **sealed**. Breaking the seal is the only way to get a
> signature, and it can never be undone.

A sealed vault has never had a withdrawal signature requested, on any chain. Its
`signatures_requested` is 0, and anyone can read it from `bearer.testnet` (`vault`) or on the
vault's page. Every signature the contract has ever requested is public too: `withdrawals(token_id)`
returns each one with the hash of what was signed and the signed transaction, and an NEP-297 event
logs it.

## The ways to try

| # | The seller tries to | Why it fails | Proof | Row |
|---|---|---|---|---|
| 1 | **Sign a withdrawal, hold it back, sell the vault, then broadcast it** | A sealed vault can't get a signature: every `withdraw_*` on it fails `ERR_VAULT_SEALED`, and the contract has no other way to sign. To get one, the seller must break the seal, and then the vault can't be sold | Sandbox tests also assert the signer saw no call and `signatures_requested == 0`. On testnet, even the owner's withdrawal from sealed vault No. 0004 was refused, and no attack transaction reached the MPC signer ([report](docs/SPIKES.md#2026-11-09--the-attack-labs-attacks-as-real-transactions-on-the-locked-contract)) | [T3](docs/THREAT_MODEL.md#threats) |
| 2 | Withdraw after the sale | Only the current owner can withdraw or break the seal (`ERR_NOT_OWNER`) | Sandbox, on Base, Bitcoin and Solana. On testnet, the former owner's `withdraw_evm` on vault No. 0001 and `break_seal` on No. 0004 were refused | [T1](docs/THREAT_MODEL.md#threats) |
| 3 | Empty the vault first, then sell the shell | Withdrawing needs the seal broken, and an opened vault can't change hands by any path (`ERR_VAULT_OPENED`). The buyer sees *Opened* before paying | Sandbox. On testnet, `nft_transfer` of opened vault No. 0001 was refused | [T2](docs/THREAT_MODEL.md#threats) |
| 4 | Break the seal and transfer at the same moment | NEAR runs the contract's receipts one at a time: whichever runs first wins, and the other fails cleanly | Sandbox, both orders | [T4](docs/THREAT_MODEL.md#threats) |
| 5 | Sell while a withdrawal is being signed | A signature in flight means the vault is opened, which refuses transfers | Sandbox | [T5](docs/THREAT_MODEL.md#threats) |
| 6 | Move the vault around the seal check (approvals, the transfer callback, another path) | One gate for every owner change; no approvals extension; a test fails if any other code changes the owner | Sandbox and unit, including a receiver that breaks the seal inside its transfer callback | [T6](docs/THREAT_MODEL.md#threats) |
| 7 | Get the contract to sign something else (raw bytes, another vault's address) | It signs only the withdrawals it builds itself, for the vault's own paths, which are unique per vault and chain. There is no raw-signing method | Unit and sandbox. On testnet, `sign` on `bearer.testnet` failed with `MethodNotFound` | [T7](docs/THREAT_MODEL.md#threats), [T8](docs/THREAT_MODEL.md#threats) |
| 8 | Keep admin power, or upgrade the contract later | No admin, owner, pause or upgrade methods; every key on all five contracts deleted; the deployed code matches the reproducible build | `/proof` reads it live; `pnpm verify` checks it; the Locked contracts workflow rebuilds it | [T11](docs/THREAT_MODEL.md#threats) |
| 9 | Keep a copy of a Bearer link and use it after giving it away | The recipient's first step moves the vault to a new link or their own account, which leaves every old copy empty. Until they do, the link is a bearer instrument like cash, and the page says so first | On testnet, vault No. 0010 went through three links; each earlier link then read "This link is empty" | [T13](docs/THREAT_MODEL.md#threats), [T18](docs/THREAT_MODEL.md#threats) |
| 10 | Take the buyer's money and keep the vault (market) | The market holds the vault in escrow, still sealed; the buyer pays the exact price; the vault moves first, then the seller is paid; a vault that didn't move refunds the buyer | Sandbox and unit; a testnet sale of vault No. 0004 | [M2, M3](docs/THREAT_MODEL.md#market-threats) |
| 11 | Withdraw while the vault is held for a schedule, a loan or a switch | Those contracts accept only sealed vaults and never break seals, so nobody can open a vault they hold | Sandbox; on testnet a borrower's `break_seal` on a pledged vault was refused | [S6](docs/THREAT_MODEL.md#scheduled-handover-threats), [L2](docs/THREAT_MODEL.md#lending-threats), [D2](docs/THREAT_MODEL.md#dead-mans-switch-threats) |

## What is not covered

- **Off-chain payment.** If a buyer pays outside Bearer and the seller never transfers, Bearer
  can't help. It guarantees that what you receive is sealed and yours, not that a counterparty pays.
  Use the market, which settles both sides in one step ([T14](docs/THREAT_MODEL.md#threats)).
- **NEAR's MPC network.** It is trusted to sign only what the contract requests, which needs a
  threshold of independent operators to agree, and to keep its key shares safe.
- **Audit.** This is a testnet prototype and has not been audited.

## Check it yourself

- Open [vault No. 0009](https://bearer-near.vercel.app/v/9) and see *Signatures ever requested: 0*,
  read live from the chain.
- Open [vault No. 0001's attack lab](https://bearer-near.vercel.app/v/1#attack-lab) and press
  **Check all**. Each attack is a real testnet transaction, refused with its expected error.
- Run `pnpm verify`. Among its 47 claims: every sealed vault on `bearer.testnet` has 0 signatures,
  and each recorded attack failed with its expected error.
