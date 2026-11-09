/**
 * Shared Bearer v3 types. They mirror the contract's JSON views exactly
 * (contracts/bearer/src/{lib,vault,evm,withdraw_evm}.rs); change both together.
 * Big integers and nanosecond timestamps are decimal strings, as the contract sends them.
 */

export type ChainTag = "btc" | "evm" | "sol";
export const CHAIN_TAGS: readonly ChainTag[] = ["btc", "evm", "sol"];

export type Finish = "obsidian" | "champagne" | "graphite" | "ivory" | "midnight" | "sage";

/** `sealed` → `opened` once, never back (invariant I1). */
export type VaultState = { kind: "sealed" } | { kind: "opened"; at_ns: string; by: string };

export interface DerivedKeys {
  /** `secp256k1:…` */
  btc: string;
  /** `secp256k1:…` */
  evm: string;
  /** `ed25519:…` */
  sol: string;
}

export interface Custody {
  account_id: string;
  since_ns: string;
}

/** `vault(token_id)` view. */
export interface VaultView {
  token_id: string;
  owner_id: string;
  state: VaultState;
  /** Always 0 while sealed (invariant I4). */
  signatures_requested: number;
  withdrawal_count: number;
  /** `null` until the signer's derived keys arrive (a block or two after creation). */
  keys: DerivedKeys | null;
  /** `tb1q…` P2WPKH address from `keys.btc`; `null` until keys arrive. */
  btc_address: string | null;
  evm_address: string | null;
  /** Base58 Solana address (the Ed25519 key itself); `null` until keys arrive. */
  sol_address: string | null;
  paths: Record<ChainTag, string>;
  /** Last 16 holders, oldest first. */
  custody: Custody[];
  created_at_ns: string;
  name: string | null;
  finish: Finish;
}

export interface EvmWithdrawParams {
  chain_id: string;
  nonce: string;
  to: string;
  amount_wei: string;
  gas_limit: string;
  max_fee_per_gas: string;
  max_priority_fee_per_gas: string;
}

/** Brief 4.6. Mirrors `withdraw_btc` (contracts/bearer/src/bitcoin.rs). Change goes back to the vault. */
export interface BtcWithdrawParams {
  inputs: { txid: string; vout: number; value_sat: string }[];
  to_address: string;
  amount_sat: string;
  fee_sat: string;
}

/** Brief 4.6. Mirrors `withdraw_sol` (contracts/bearer/src/solana.rs): one SystemProgram transfer, the vault pays the fee. */
export interface SolWithdrawParams {
  recent_blockhash: string;
  to: string;
  lamports: string;
}

/** Internally tagged by `chain`. Mirrors the contract's `WithdrawalParams` for all three chains. */
export type WithdrawalParams =
  | ({ chain: "evm" } & EvmWithdrawParams)
  | ({ chain: "btc" } & BtcWithdrawParams)
  | ({ chain: "sol" } & SolWithdrawParams);

export type WithdrawalStatus = "pending" | "signed" | "failed";

/** `withdrawals(token_id)` view entry. */
export interface Withdrawal {
  index: number;
  params: WithdrawalParams;
  path: string;
  /** Hex hashes that were signed, one per sign request. */
  payload_hashes: string[];
  /** Hex of the signed transaction, ready to broadcast by anyone. */
  signed_raw_tx: string | null;
  status: WithdrawalStatus;
  error: string | null;
  requested_at_ns: string;
}

/** `get_config()` view. NEAR amounts are yoctoNEAR strings. */
export interface ContractConfig {
  evm_chain_ids: number[];
  max_btc_inputs: number;
  create_deposit: string;
  withdraw_deposit: string;
  mpc_sign_deposit: string;
}

/** Stable panic codes the contract can return. */
export const ERROR_CODES = [
  "ERR_NOT_OWNER",
  "ERR_VAULT_OPENED",
  "ERR_VAULT_SEALED",
  "ERR_ALREADY_OPENED",
  "ERR_NO_VAULT",
  "ERR_NO_APPROVALS",
  "ERR_DEPOSIT",
  "ERR_GAS",
  "ERR_KEYS_PENDING",
  "ERR_KEYS_ALREADY_SET",
  "ERR_NAME_TOO_LONG",
  "ERR_CHAIN_NOT_SUPPORTED",
  "ERR_BAD_ADDRESS",
  "ERR_GAS_LIMIT_TOO_LOW",
  "ERR_PRIORITY_FEE_ABOVE_MAX_FEE",
  "ERR_CREATE_DEPOSIT_BELOW_STORAGE",
  "ERR_WITHDRAW_DEPOSIT_BELOW_STORAGE",
  "ERR_SAME_OWNER",
  "ERR_ACCOUNT_MISSING",
  "ERR_INSUFFICIENT_FUNDS",
  "MethodNotFound",
] as const;
export type BearerErrorCode = (typeof ERROR_CODES)[number];

/** Finds a known error code in a NEAR error message. */
export function errorCodeOf(error: unknown): BearerErrorCode | null {
  const text = error instanceof Error ? error.message : String(error);
  return ERROR_CODES.find((code) => text.includes(code)) ?? null;
}

/** Derivation path, exactly as the contract builds it (invariant I5). */
export function vaultPath(tokenId: string, chain: ChainTag): string {
  return `bearer:v3:${tokenId}:${chain}`;
}

/* ---------- off-chain observation (SDK adapters fill these) ---------- */

export interface ChainObservation {
  chain: ChainTag;
  address: string;
  /** Confirmed balance in base units: sats, wei, lamports. */
  confirmed: string;
  /** Unconfirmed deposits in base units. */
  pending: string;
  /** Named data source, shown in the UI ("mempool.space testnet4"). */
  source: string;
  /** ms since epoch. */
  observedAt: number;
  explorerUrl: string;
  /** Recent deposits seen at the address, newest first. */
  deposits: ObservedDeposit[];
  /** Network fee estimate for one withdrawal, in base units. */
  feeEstimate: string;
  /** True when this came from the simulated adapter. */
  simulated: boolean;
}

export interface ObservedDeposit {
  txHash: string;
  amount: string;
  confirmed: boolean;
  /** ms since epoch. */
  at: number;
  explorerUrl: string | null;
}

/** Off-chain life of a withdrawal after the contract signs it. */
export type WithdrawalStage = "signing" | "broadcasting" | "confirming" | "confirmed" | "failed";

export interface WithdrawalProgress {
  tokenId: string;
  index: number;
  stage: WithdrawalStage;
  chainTxHash: string | null;
  explorerUrl: string | null;
  error: string | null;
}

/* ---------- the web app's client seam ---------- */

export type WithdrawRequest =
  | { chain: "evm"; to: string; amountWei: string }
  | { chain: "btc"; to: string; amountSats: string }
  | { chain: "sol"; to: string; lamports: string };

export type AttackKind =
  | "former_owner_withdraws"
  | "former_owner_breaks_seal"
  | "transfer_opened_vault"
  | "withdraw_sealed_vault"
  | "sign_arbitrary_bytes";

export interface AttackResult {
  kind: AttackKind;
  rejected: boolean;
  errorCode: string | null;
  /** The test in contracts/tests that proves this. */
  testName: string;
  txHash: string | null;
  simulated: boolean;
}

/* ---------- the market (contracts/market) ---------- */

export type ListingState = { kind: "listed" } | { kind: "selling"; buyer: string } | { kind: "returning" };

/** A vault for sale, held in escrow by the market contract. Amounts in yoctoNEAR. */
export interface MarketListing {
  token_id: string;
  seller: string;
  /** Exactly what a buyer attaches. */
  price: string;
  /** Held from the seller's listing balance; paid back with the sale or the delisting. */
  deposit: string;
  listed_at_ns: string;
  state: ListingState;
}

export interface MarketConfig {
  nft_contract: string;
  listing_deposit: string;
  min_price: string;
}

/**
 * What the web app needs from Bearer. Mock (in-browser) and testnet (this SDK)
 * implementations both satisfy it. `signer` is the connected NEAR account.
 */
export interface BearerClient {
  listVaults(owner: string): Promise<VaultView[]>;
  getVault(tokenId: string): Promise<VaultView | null>;
  getWithdrawals(tokenId: string): Promise<Withdrawal[]>;
  observe(vault: VaultView): Promise<ChainObservation[]>;

  createVault(input: { name?: string; finish: Finish }, signer: string): Promise<VaultView>;
  transfer(tokenId: string, receiver: string, signer: string): Promise<VaultView>;
  /** One NEAR transaction: `break_seal` then the first `withdraw_*` (atomic). */
  breakSealAndWithdraw(tokenId: string, first: WithdrawRequest, signer: string): Promise<Withdrawal>;
  breakSeal(tokenId: string, signer: string): Promise<VaultView>;
  withdraw(tokenId: string, request: WithdrawRequest, signer: string): Promise<Withdrawal>;

  /** Where a withdrawal stands: signing on NEAR, then on its own chain. Read-only. */
  trackWithdrawal(tokenId: string, index: number): Promise<WithdrawalProgress>;
  /** Live adapter only: sends a signed withdrawal to its chain. Anyone may; it pays where the owner chose. */
  broadcast?(tokenId: string, index: number): Promise<WithdrawalProgress>;

  runAttack(kind: AttackKind, tokenId: string): Promise<AttackResult>;
  accountExists(accountId: string): Promise<boolean>;

  /** The market contract's account, or null where this deployment has none. */
  readonly marketId: string | null;
  listings(): Promise<MarketListing[]>;
  getListing(tokenId: string): Promise<MarketListing | null>;
  marketConfig(): Promise<MarketConfig>;
  /** Sends a sealed vault to the market at this price, paying the listing deposit first if needed. */
  listVault(tokenId: string, priceYocto: string, signer: string): Promise<MarketListing>;
  /** Pays exactly the price; resolves once the vault is the signer's. */
  buyVault(tokenId: string, priceYocto: string, signer: string): Promise<VaultView>;
  /** The seller takes the vault back, with the listing deposit. */
  delistVault(tokenId: string, signer: string): Promise<VaultView>;

  /** Simulated adapter only: pretend a deposit arrived. */
  simulateDeposit?(tokenId: string, chain: ChainTag): Promise<void>;
  /** Simulated adapter only: restore the seeded demo vaults. */
  reset?(): void;
}
