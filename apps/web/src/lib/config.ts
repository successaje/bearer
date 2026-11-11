import type { ChainTag } from "@bearer/sdk";

export type Network = "mock" | "testnet";

export const NETWORK: Network =
  process.env.NEXT_PUBLIC_NETWORK === "testnet" ? "testnet" : "mock";

/** Mock mode runs entirely in the browser. Everything it shows is labelled SIMULATED. */
export const IS_SIMULATED = NETWORK === "mock";

export const BEARER_CONTRACT = process.env.NEXT_PUBLIC_BEARER_CONTRACT || "bearer-v1.testnet";

/**
 * The market contract (contracts/market) that sells this contract's vaults from escrow. On
 * testnet it exists only for bearer.testnet; the simulated demo has its own.
 */
export const MARKET_CONTRACT: string | null =
  process.env.NEXT_PUBLIC_MARKET_CONTRACT ||
  (NETWORK === "mock" ? "market.testnet" : BEARER_CONTRACT === "bearer.testnet" ? "bearer-market.testnet" : null);

/** The schedule contract (contracts/schedule): hands this contract's vaults over on a chosen date. */
export const SCHEDULE_CONTRACT: string | null =
  process.env.NEXT_PUBLIC_SCHEDULE_CONTRACT ||
  (NETWORK === "mock" ? "schedule.testnet" : BEARER_CONTRACT === "bearer.testnet" ? "bearer-schedule.testnet" : null);

/**
 * The lending contract (contracts/lend): lends NEAR against this contract's vaults and holds each
 * one until it's repaid or the lender takes it. On testnet it exists only for bearer.testnet.
 */
export const LEND_CONTRACT: string | null =
  process.env.NEXT_PUBLIC_LEND_CONTRACT ||
  (NETWORK === "mock" ? "lend.testnet" : BEARER_CONTRACT === "bearer.testnet" ? "bearer-lend.testnet" : null);

/** Code hash of the market's reproducible build (contracts/res/market.wasm), deployed and locked on bearer-market.testnet. */
export const MARKET_CODE_HASH = process.env.NEXT_PUBLIC_MARKET_CODE_HASH || "7joKh4WSVFGb6EEsUpS6BeC1wtp3pepG2FQwBuAJqt7P";

/** Public, keyless endpoints the testnet adapter reads (defaults live in @bearer/sdk). */
export const NEAR_RPC = process.env.NEXT_PUBLIC_NEAR_RPC || "https://test.rpc.fastnear.com";
export const ESPLORA_API = process.env.NEXT_PUBLIC_ESPLORA_API || "https://blockstream.info/testnet4/api";
export const BASE_RPC = process.env.NEXT_PUBLIC_BASE_RPC || "https://sepolia.base.org";
export const SOLANA_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.devnet.solana.com";
export const SIGNER_CONTRACT = process.env.NEXT_PUBLIC_SIGNER_CONTRACT || "v1.signer-prod.testnet";
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
export const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL || null;

/**
 * NEAR code hash (base58 of the sha256) of the reproducible build in contracts/res, which is what
 * bearer.testnet runs, locked. Pages compare the chain's answer with it.
 */
export const CODE_HASH = process.env.NEXT_PUBLIC_CODE_HASH || "PEsHBVDKpZ3fdpmfsJekrt52amLARnwRLWNXLQDVq1S";

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
