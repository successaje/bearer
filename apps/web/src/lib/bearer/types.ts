export type ChainTag = "btc" | "evm" | "sol";

export const CHAINS: readonly ChainTag[] = ["btc", "evm", "sol"] as const;

export type Finish = "obsidian" | "champagne" | "graphite" | "ivory" | "midnight" | "sage";

/**
 * Amounts are integers in each chain's display base unit:
 * satoshis for Bitcoin, gwei for Base (EVM), lamports for Solana.
 */
export type BaseUnits = number;

export interface BtcCoin {
  outpoint: string;
  amount: BaseUnits;
  /** Referenced by an issued signature. Excluded from the sealed value until spent. */
  encumbered: boolean;
  signedAt?: number;
}

export interface BtcSlot {
  chain: "btc";
  address: string;
  coins: BtcCoin[];
}

export interface EvmSlot {
  chain: "evm";
  address: string;
  balance: BaseUnits;
  /** Highest nonce the contract has ever signed for, or null if none. */
  maxSignedNonce: number | null;
  /** Every nonce below this is proven consumed on Base Sepolia. */
  provenFloor: number;
}

export interface SolSlot {
  chain: "sol";
  address: string;
  balance: BaseUnits;
  lastSignedAt: number | null;
}

export interface Slots {
  btc: BtcSlot;
  evm: EvmSlot;
  sol: SolSlot;
}

export interface PendingRequest {
  idx: number;
  requestId: string;
  chain: ChainTag;
  requestedAt: number;
  summary: string;
}

export interface Listing {
  priceNear: string;
  listedAt: number;
}

export interface ClaimLinkState {
  createdAt: number;
}

export type ActivityKind =
  | "created"
  | "deposit"
  | "signed"
  | "broadcast"
  | "proven"
  | "handed_over"
  | "listed"
  | "delisted"
  | "sold"
  | "claim_created"
  | "claim_cancelled"
  | "claimed"
  | "expired";

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  chain?: ChainTag;
  title: string;
  detail: string;
  at: number;
  link?: { label: string; href: string };
}

export interface Card {
  id: string;
  name: string;
  finish: Finish;
  owner: string;
  createdAt: number;
  epoch: number;
  slots: Slots;
  pending: PendingRequest[];
  listing: Listing | null;
  claimLink: ClaimLinkState | null;
  /** Bumped on every change to the signature log; `buy` must match it. */
  logVersion: number;
  activity: ActivityItem[];
}

export type RequestStage = "recorded" | "signing" | "broadcasting" | "confirmed" | "failed";

export interface OpenRequest {
  id: string;
  cardId: string;
  chain: ChainTag;
  to: string;
  amount: BaseUnits;
  fee: BaseUnits;
  stage: RequestStage;
  createdAt: number;
  error?: string;
  nearTxHash: string;
  chainTxHash?: string;
}

export interface OpenInput {
  chain: ChainTag;
  to: string;
  amount: BaseUnits;
}

export type ClaimLookup =
  | { status: "valid"; card: Card; from: string }
  | { status: "claimed" }
  | { status: "cancelled" }
  | { status: "invalid" };

export type CardStatus =
  | "sealed"
  | "pending_signature"
  | "listed"
  | "claim_pending"
  | "action_needed";

export type BearerErrorCode =
  | "NOT_FOUND"
  | "NOT_OWNER"
  | "NOT_ACTIVE"
  | "NOT_SEALED"
  | "STALE_SEAL"
  | "ACCOUNT_MISSING"
  | "ACCOUNT_TAKEN"
  | "INSUFFICIENT_FUNDS"
  | "LINK_CLAIMED"
  | "LINK_CANCELLED"
  | "LINK_INVALID"
  | "NOT_EXPIRED"
  | "NOTHING_TO_PROVE"
  | "NOT_SUPPORTED";

export class BearerError extends Error {
  constructor(
    public code: BearerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BearerError";
  }
}
