"use client";

import type { ChainObservation } from "@bearer/sdk";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { ChainIcon } from "@/components/brand/chain-icon";
import { IS_SIMULATED, MARKET_CONTRACT } from "@/lib/config";
import { CHAIN_META, formatAmount, relativeTime } from "@/lib/vault/format";
import { useMarketFacts } from "@/lib/vault/hooks";

/**
 * The market account's lock state, read from the chain. Until it has no full-access keys,
 * whoever holds one could act as the owner of every listed vault, so this says so plainly.
 */
export function MarketLock({ compact = false }: { compact?: boolean }) {
  const facts = useMarketFacts();
  const d = facts.data;
  if (!MARKET_CONTRACT) return null;
  if (!d) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] text-fg-3">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        Checking the market contract…
      </span>
    );
  }
  if (d.locked) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] text-fg-2">
        <Check className="size-3.5 text-ok" strokeWidth={3} aria-hidden />
        Market contract locked{IS_SIMULATED ? " (simulated)" : ": no keys, nobody can change it"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-start gap-1.5 text-[13px] leading-snug text-fg-2">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />
      <span>
        Market contract not locked yet
        {compact
          ? "."
          : `: ${MARKET_CONTRACT} still has ${d.fullAccessKeys} full-access key${d.fullAccessKeys === 1 ? "" : "s"}, so whoever holds it could act as the owner of a listed vault. Locking deletes it for good.`}
      </span>
    </span>
  );
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
