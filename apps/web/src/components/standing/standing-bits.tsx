"use client";

import type { ChainTag, StandingPlan } from "@bearer/sdk";
import { nsToMsNumber } from "@/components/schedule/when";
import { EscrowLock } from "@/components/vault/escrow-lock";
import { STANDING_CONTRACT } from "@/lib/config";
import { CHAIN_META, formatAmount } from "@/lib/vault/format";
import { useStandingFacts } from "@/lib/vault/hooks";

export { termText as periodText } from "@/components/lend/lend-bits";

/** The standing-payments account's lock state, read from the chain. */
export function StandingLock({ compact = false }: { compact?: boolean }) {
  const facts = useStandingFacts();
  if (!STANDING_CONTRACT) return null;
  return (
    <EscrowLock
      name="Standing payments"
      account={STANDING_CONTRACT}
      holds="a vault that pays"
      facts={facts.data}
      compact={compact}
    />
  );
}

export const periodMs = (p: StandingPlan) => nsToMsNumber(p.interval_ns);

/** "0.0005 tBTC" */
export const coins = (chain: ChainTag, base: string | bigint) =>
  `${formatAmount(chain, base)} ${CHAIN_META[chain].unit}`;

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
/** The first is short so the whole thing can be tried in one sitting. */
export const PERIODS = [MIN, DAY, 7 * DAY, 30 * DAY];

/** The highest network fee a payment may carry, by chain, unless the giver changes it. Solana's is fixed. */
export const DEFAULT_MAX_FEE: Record<ChainTag, bigint> = {
  // About 14 sat/vB for a one-coin payment.
  btc: 2_000n,
  // 21,000 gas at 2 gwei: far above Base Sepolia's usual price.
  evm: 21_000n * 2_000_000_000n,
  sol: 0n,
};
