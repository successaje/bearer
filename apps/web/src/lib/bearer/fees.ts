import type { BaseUnits, ChainTag } from "./types";

/**
 * Network fee estimates in base units (sats, gwei, lamports).
 * The testnet adapter replaces these with live estimates from each chain's RPC.
 */
export const NETWORK_FEES: Record<ChainTag, BaseUnits> = { btc: 300, evm: 21_000, sol: 5_000 };

/** NEAR paid per signing request: signature record storage plus the MPC fee (contract config). */
export const OPEN_NEAR_COST = "0.01";

export const STORAGE_DEPOSIT_NEAR = "0.05";
