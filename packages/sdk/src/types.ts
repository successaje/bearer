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

/**
 * An attack sent to the live contract as a real transaction, kept so anyone can re-read the
 * contract's answer from the chain.
 */
export interface RecordedAttack {
  kind: AttackKind;
  /** Who sent it, and what they called, in words. */
  actor: string;
  call: string;
  expected: string;
  /** The test in contracts/tests that proves the same refusal. */
  testName: string;
  txHash: string;
  /** The transaction's signer, needed to look it up. */
  signerId: string;
  /** ISO date it was sent. */
  sentAt: string;
}

export interface AttackResult {
  kind: AttackKind;
  rejected: boolean;
  errorCode: string | null;
  /** The test in contracts/tests that proves this. */
  testName: string;
  txHash: string | null;
  simulated: boolean;
}

/* ---------- scheduled handover (contracts/schedule) ---------- */

export type ScheduleState = { kind: "waiting" } | { kind: "releasing" } | { kind: "cancelling" };

/** A sealed vault held by the schedule contract until `release_at_ns`, then handed to `recipient`. */
export interface HandoverSchedule {
  token_id: string;
  giver: string;
  recipient: string;
  /** Nanoseconds since the Unix epoch: anyone can release it on or after this. */
  release_at_ns: string;
  /** Whether the giver may take it back before the date. */
  cancellable: boolean;
  scheduled_at_ns: string;
  deposit: string;
  state: ScheduleState;
}

/* ---------- borrowing against a vault (contracts/lend) ---------- */

export type LoanState =
  | { kind: "requested" }
  | { kind: "cancelling" }
  | { kind: "active" | "repaying" | "foreclosing"; lender: string; due_at_ns: string };

/**
 * A sealed vault pledged to the lending contract. Until a lender funds it, the borrower can take
 * it back. Once funded, the borrower repays before `due_at_ns` to get it back, or from then on the
 * lender can take it. Amounts in yoctoNEAR.
 */
export interface VaultLoan {
  token_id: string;
  borrower: string;
  /** Exactly what the lender pays; it goes straight to the borrower. */
  principal: string;
  /** Exactly what the borrower pays back; it goes to the lender. */
  repayment: string;
  /** How long the borrower has to repay, counted from funding. */
  term_ns: string;
  /** Held from the borrower's loan balance; paid back to them when the loan ends, either way. */
  deposit: string;
  requested_at_ns: string;
  state: LoanState;
}

export interface LendConfig {
  nft_contract: string;
  loan_deposit: string;
  min_principal: string;
  min_term_ns: string;
  max_term_ns: string;
}

export interface LoanTerms {
  principalYocto: string;
  repaymentYocto: string;
  termMs: number;
}

/* ---------- a dead man's switch (contracts/switch) ---------- */

export type SwitchState = { kind: "armed" | "taking_back" | "releasing" };

/**
 * A sealed vault held by the switch. While its owner checks in, nothing happens; they can also
 * change the beneficiary or the interval, or take it back. Once a whole interval passes without a
 * check-in, anyone can hand it to the beneficiary, and only to them.
 */
export interface VaultSwitch {
  token_id: string;
  owner: string;
  beneficiary: string;
  /** How long a silence hands the vault over, in nanoseconds. */
  interval_ns: string;
  /** The owner's last sign of life: arming, a check-in or an update. */
  last_check_in_ns: string;
  armed_at_ns: string;
  /** Held from the owner's balance; paid back to them when the switch ends, either way. */
  deposit: string;
  state: SwitchState;
}

export interface SwitchConfig {
  nft_contract: string;
  switch_deposit: string;
  min_interval_ns: string;
  max_interval_ns: string;
}

/** From this moment anyone may hand the vault to the beneficiary (ms since epoch). */
export function switchDueMs(s: Pick<VaultSwitch, "last_check_in_ns" | "interval_ns">): number {
  return Number((BigInt(s.last_check_in_ns) + BigInt(s.interval_ns)) / 1_000_000n);
}

/* ---------- an account's activity: what happened to the vaults it held, sold or was sent ---------- */

/**
 * - `sold`: a vault you listed was bought; `received`: someone handed you one; `delivered`: handed
 *   to you on its date; `scheduled_for_you`: someone scheduled one for you. These are other
 *   people's doing (`byOthers`), which is what notifications count.
 * - `foreclosed`: a vault you borrowed against went to the lender. Also other people's doing.
 * - `inherited`: a switch handed you someone's vault after they went quiet; `passed_on`: your own
 *   switch handed your vault to your beneficiary. Both are triggered by someone else.
 * - `bought`, `returned` (delisted, a schedule cancelled, a loan repaid or its request cancelled,
 *   a switch taken back), `listed`, `scheduled`, `pledged`, `collected` (you took a vault you lent
 *   against), `armed` (you put a vault in a switch), `sent`: your own.
 */
export type AccountEventKind =
  | "sold"
  | "received"
  | "delivered"
  | "scheduled_for_you"
  | "foreclosed"
  | "inherited"
  | "passed_on"
  | "bought"
  | "returned"
  | "listed"
  | "scheduled"
  | "pledged"
  | "collected"
  | "armed"
  | "sent";

export interface AccountEvent {
  /** Stable across reads: kind, vault and time. */
  id: string;
  kind: AccountEventKind;
  tokenId: string;
  atMs: number;
  /** The buyer, seller, sender, recipient or giver, where there is one. */
  counterparty: string | null;
  byOthers: boolean;
  /** Sales: what the buyer paid, and what the market sent the seller (the price plus the listing deposit back). */
  priceYocto?: string | null;
  paidYocto?: string | null;
  /** The transaction that paid the seller, where it was found. */
  tx?: string | null;
  /** `scheduled_for_you`: on or after when. */
  releaseAtMs?: number;
}

export interface AccountActivity {
  /** Newest first. */
  events: AccountEvent[];
  /** Where it came from, as the UI names it. */
  source: string;
  /** True if the index couldn't be read, so only vaults the account holds now are covered. */
  partial: boolean;
}

/** What the market holds for an account: bounced payouts to claim, and listing deposit not in use. */
export interface MarketBalances {
  claimable: string;
  deposit: string;
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

  /** The schedule contract's account, or null where this deployment has none. */
  readonly scheduleId: string | null;
  schedules(): Promise<HandoverSchedule[]>;
  getSchedule(tokenId: string): Promise<HandoverSchedule | null>;
  /** Sends a sealed vault to the schedule for `recipient`, to be handed over on or after `releaseAtMs`. */
  scheduleHandover(tokenId: string, recipient: string, releaseAtMs: number, cancellable: boolean, signer: string): Promise<HandoverSchedule>;
  /** Anyone may, on or after the date; resolves once the vault is the recipient's. */
  releaseHandover(tokenId: string, signer: string): Promise<VaultView>;
  /** The giver takes it back before the date, if they made it cancellable. */
  cancelHandover(tokenId: string, signer: string): Promise<VaultView>;

  /** The lending contract's account, or null where this deployment has none. */
  readonly lendId: string | null;
  loans(): Promise<VaultLoan[]>;
  getLoan(tokenId: string): Promise<VaultLoan | null>;
  lendConfig(): Promise<LendConfig>;
  /** Pledges a sealed vault for a loan on these terms, paying the loan deposit first if needed. */
  requestLoan(tokenId: string, terms: LoanTerms, signer: string): Promise<VaultLoan>;
  /** Pays exactly the principal, against the terms shown; it goes straight to the borrower. */
  fundLoan(loan: VaultLoan, signer: string): Promise<VaultLoan>;
  /** The borrower pays exactly the repayment, before the due date; resolves once the vault is back. */
  repayLoan(tokenId: string, signer: string): Promise<VaultView>;
  /** From the due date, the lender takes the vault; resolves once it's theirs. */
  forecloseLoan(tokenId: string, signer: string): Promise<VaultView>;
  /** The borrower takes back a request nobody has funded, with its deposit. */
  cancelLoanRequest(tokenId: string, signer: string): Promise<VaultView>;

  /** The switch contract's account, or null where this deployment has none. */
  readonly switchId: string | null;
  switches(): Promise<VaultSwitch[]>;
  getSwitch(tokenId: string): Promise<VaultSwitch | null>;
  switchConfig(): Promise<SwitchConfig>;
  /** Puts a sealed vault in the switch for `beneficiary`, paying the switch deposit first if needed. */
  armSwitch(tokenId: string, beneficiary: string, intervalMs: number, signer: string): Promise<VaultSwitch>;
  /** "I'm still here": the owner restarts the clock. */
  checkIn(tokenId: string, signer: string): Promise<VaultSwitch>;
  /** The owner names a new beneficiary or interval; it counts as a check-in. */
  updateSwitch(tokenId: string, changes: { beneficiary?: string; intervalMs?: number }, signer: string): Promise<VaultSwitch>;
  /** The owner takes the vault back, with its deposit; resolves once it's back. */
  takeBackSwitch(tokenId: string, signer: string): Promise<VaultView>;
  /** Anyone may, once a whole interval has passed without a check-in; resolves once the beneficiary has it. */
  releaseSwitch(tokenId: string, signer: string): Promise<VaultView>;

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
  marketBalances(accountId: string): Promise<MarketBalances>;
  /** Collects payouts that bounced (the seller's account couldn't receive them at the time). */
  claimPayout(signer: string): Promise<MarketBalances>;
  /** Takes back listing deposit that no listing is using. */
  withdrawListingDeposit(signer: string): Promise<MarketBalances>;

  /** What happened to the vaults this account has held: sales, handovers, schedules, loans. */
  accountActivity(accountId: string): Promise<AccountActivity>;

  /** Simulated adapter only: pretend a deposit arrived. */
  simulateDeposit?(tokenId: string, chain: ChainTag): Promise<void>;
  /** Simulated adapter only: restore the seeded demo vaults. */
  reset?(): void;
}
