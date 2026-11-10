"use client";

import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { IS_SIMULATED } from "@/lib/config";
import type { ContractFacts } from "@/lib/vault/contract-facts";

/**
 * An escrow contract's lock state (the market's or the schedule's), read from the chain. Until it
 * has no full-access keys, whoever holds one could act as the owner of every vault it holds, so
 * this says so plainly.
 */
export function EscrowLock({
  name,
  account,
  holds,
  facts,
  compact = false,
}: {
  /** "Market" or "Schedule". */
  name: string;
  account: string;
  /** What the key holder could act as the owner of: "a listed vault". */
  holds: string;
  facts: ContractFacts | undefined;
  compact?: boolean;
}) {
  if (!facts) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] text-fg-3">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        Checking the {name.toLowerCase()} contract…
      </span>
    );
  }
  if (facts.locked) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] text-fg-2">
        <Check className="size-3.5 text-ok" strokeWidth={3} aria-hidden />
        {name} contract locked{IS_SIMULATED ? " (simulated)" : ": no keys, nobody can change it"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-start gap-1.5 text-[13px] leading-snug text-fg-2">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />
      <span>
        {name} contract not locked yet
        {compact
          ? "."
          : `: ${account} still has ${facts.fullAccessKeys} full-access key${facts.fullAccessKeys === 1 ? "" : "s"}, so whoever holds it could act as the owner of ${holds}. Locking deletes it for good.`}
      </span>
    </span>
  );
}
