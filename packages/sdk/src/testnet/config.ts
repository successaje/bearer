import type { ChainTag } from "../types";

/** Where the testnet adapter reads and broadcasts. Every endpoint is public and keyless. */
export interface TestnetEndpoints {
  /** NEAR JSON-RPC. rpc.testnet.near.org is deprecated and rate-limits; FastNEAR doesn't. */
  near: string;
  /** Archival NEAR JSON-RPC: regular nodes forget transactions after a few epochs. */
  nearArchival: string;
  /** Esplora REST API for Bitcoin testnet4. */
  esplora: string;
  /** Base Sepolia JSON-RPC. */
  evm: string;
  /** Solana devnet JSON-RPC. */
  solana: string;
  /** NearBlocks' public index (API v3): which vaults moved through an account, and payments to it. */
  nearblocks: string;
}

export const TESTNET_ENDPOINTS: TestnetEndpoints = {
  near: "https://test.rpc.fastnear.com",
  nearArchival: "https://archival-rpc.testnet.fastnear.com",
  esplora: "https://blockstream.info/testnet4/api",
  evm: "https://sepolia.base.org",
  solana: "https://api.devnet.solana.com",
  nearblocks: "https://api-testnet.nearblocks.io/v3",
};

/** Data sources as the UI names them next to every balance (brief 3.4 Flow B). */
export const SOURCE_NAMES: Record<ChainTag, string> = {
  btc: "Blockstream Esplora testnet4",
  evm: "Base Sepolia RPC",
  sol: "Solana devnet RPC",
};

export const EXPLORERS = {
  address: {
    btc: (a: string) => `https://mempool.space/testnet4/address/${a}`,
    evm: (a: string) => `https://sepolia.basescan.org/address/${a}`,
    sol: (a: string) => `https://explorer.solana.com/address/${a}?cluster=devnet`,
  },
  tx: {
    btc: (h: string) => `https://mempool.space/testnet4/tx/${h}`,
    evm: (h: string) => `https://sepolia.basescan.org/tx/${h}`,
    sol: (h: string) => `https://explorer.solana.com/tx/${h}?cluster=devnet`,
  },
} satisfies Record<string, Record<ChainTag, (x: string) => string>>;

export const BASE_SEPOLIA_CHAIN_ID = 84532;
/** Bitcoin Core's dust limit for P2WPKH change, mirrored from the contract. */
export const BTC_DUST = 294;
/** One P2WPKH input and two outputs, in vbytes; each extra input adds 68. */
export const btcVsize = (inputs: number, outputs = 2) => 11 + 68 * inputs + 31 * outputs;
/** Solana's base fee per signature. */
export const SOL_FEE_LAMPORTS = 5000n;
