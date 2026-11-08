import type { ChainTag } from "@bearer/sdk";

export type Network = "mock" | "testnet";

export const NETWORK: Network =
  process.env.NEXT_PUBLIC_NETWORK === "testnet" ? "testnet" : "mock";

/** Mock mode runs entirely in the browser. Everything it shows is labelled SIMULATED. */
export const IS_SIMULATED = NETWORK === "mock";

export const BEARER_CONTRACT = process.env.NEXT_PUBLIC_BEARER_CONTRACT || "bearer-v1.testnet";
export const SIGNER_CONTRACT = process.env.NEXT_PUBLIC_SIGNER_CONTRACT || "v1.signer-prod.testnet";
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
export const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL || null;

/** Code hash of the deployed contract. Placeholder until the reproducible build exists. */
export const CODE_HASH =
  process.env.NEXT_PUBLIC_CODE_HASH || "8f3c1d0a77be4e2b9d61c0f5a3e7b284a6c052c4a91e";

/** Solana blockhashes expire after ~150 blocks; the contract waits 300 s after the last signature. */
export const SOLANA_WINDOW_MS = 300_000;

/** Mirrors the contract's `pending_expiry_blocks`, expressed in time for display. */
export const PENDING_EXPIRY_MS = 10 * 60_000;

/** Base proof finality used by `prove_evm_settled` (brief 4.6: Safe by default). */
export const EVM_FINALITY: "Safe" | "Finalized" = "Safe";

/** Display-only USD estimates. Always shown with "est.". */
export const USD_PRICES: Record<ChainTag, number> = {
  btc: 100_000,
  evm: 3_000,
  sol: 150,
};

export const NEAR_ACCOUNT_SUFFIX = ".testnet";

/** Mirror the contract's `create_deposit` and `withdraw_deposit` (contracts/bearer/src/lib.rs Config). */
export const CREATE_DEPOSIT_NEAR = "0.05";
export const WITHDRAW_DEPOSIT_NEAR = "0.01";

export const explorer = {
  nearTx: (hash: string) => `https://testnet.nearblocks.io/txns/${hash}`,
  nearAccount: (id: string) => `https://testnet.nearblocks.io/address/${id}`,
  address(chain: ChainTag, address: string) {
    switch (chain) {
      case "btc":
        return `https://mempool.space/testnet4/address/${address}`;
      case "evm":
        return `https://sepolia.basescan.org/address/${address}`;
      case "sol":
        return `https://explorer.solana.com/address/${address}?cluster=devnet`;
    }
  },
  tx(chain: ChainTag, hash: string) {
    switch (chain) {
      case "btc":
        return `https://mempool.space/testnet4/tx/${hash}`;
      case "evm":
        return `https://sepolia.basescan.org/tx/${hash}`;
      case "sol":
        return `https://explorer.solana.com/tx/${hash}?cluster=devnet`;
    }
  },
};
