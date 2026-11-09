"use client";

import type { ChainObservation } from "@bearer/sdk";
import { ChainIcon } from "@/components/brand/chain-icon";
import { EscrowLock } from "@/components/vault/escrow-lock";
import { MARKET_CONTRACT } from "@/lib/config";
import { CHAIN_META, formatAmount, relativeTime } from "@/lib/vault/format";
import { useMarketFacts } from "@/lib/vault/hooks";

/** The market account's lock state, read from the chain. */
export function MarketLock({ compact = false }: { compact?: boolean }) {
  const facts = useMarketFacts();
  if (!MARKET_CONTRACT) return null;
  return <EscrowLock name="Market" account={MARKET_CONTRACT} holds="a listed vault" facts={facts.data} compact={compact} />;
}

/** What is at the vault's addresses, as public data shows it: amounts, confirmation, source, time. */
export function ObservedHoldings({ observations, now }: { observations: ChainObservation[] | undefined; now: number }) {
  if (!observations) {
    return <p className="text-[13.5px] text-fg-3">Checking Bitcoin, Base and Solana…</p>;
  }
  const held = observations.filter((o) => o.confirmed !== "0" || o.pending !== "0");
  if (!held.length) return <p className="text-[13.5px] text-fg-2">Nothing at its addresses yet, confirmed or pending.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {held.map((o) => (
        <li key={o.chain} className="flex items-start gap-2.5 text-[13.5px]">
          <ChainIcon chain={o.chain} className="mt-0.5 size-[18px]" />
          <span className="min-w-0">
            <span className="tabular font-medium text-fg">
              {formatAmount(o.chain, o.confirmed)} {CHAIN_META[o.chain].unit}
            </span>{" "}
            <span className="text-fg-3">confirmed</span>
            {o.pending !== "0" ? (
              <span className="text-info">
                {" "}
                · {formatAmount(o.chain, o.pending)} pending, not final yet
              </span>
            ) : null}
            <span className="block text-[12px] text-fg-3">
              {o.source}, {now ? relativeTime(o.observedAt, now) : ""}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
