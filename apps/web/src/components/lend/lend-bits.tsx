"use client";

import type { VaultLoan } from "@bearer/sdk";
import { EscrowLock } from "@/components/vault/escrow-lock";
import { LEND_CONTRACT } from "@/lib/config";
import { useLendFacts } from "@/lib/vault/hooks";
import { nsToMsNumber } from "@/components/schedule/when";

/** The lending account's lock state, read from the chain. */
export function LendLock({ compact = false }: { compact?: boolean }) {
  const facts = useLendFacts();
  if (!LEND_CONTRACT) return null;
  return <EscrowLock name="Lending" account={LEND_CONTRACT} holds="a pledged vault" facts={facts.data} compact={compact} />;
}

/** "10 min", "1 day", "3 days 21 h", "30 days", "1 year". Under a week, leftover hours are kept. */
export function termText(ms: number) {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h`;
  const whole = Math.floor(h / 24);
  if (h % 24 && whole < 7) return `${whole === 1 ? "1 day" : `${whole} days`} ${h % 24} h`;
  const d = Math.round(h / 24);
  if (d % 365 === 0) return d === 365 ? "1 year" : `${d / 365} years`;
  return d === 1 ? "1 day" : `${d} days`;
}

/** What the lender earns on top of the principal, in yoctoNEAR. */
export const interestOf = (l: Pick<VaultLoan, "principal" | "repayment">) => BigInt(l.repayment) - BigInt(l.principal);

/** The interest as a share of the principal, for the whole term: "5%". Not annualised. */
export function interestPercent(l: Pick<VaultLoan, "principal" | "repayment">) {
  const p = BigInt(l.principal);
  if (p === 0n) return "0%";
  const bp = Number((interestOf(l) * 10_000n) / p);
  return `${(bp / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })}%`;
}

export const termMs = (l: VaultLoan) => nsToMsNumber(l.term_ns);
export const dueMs = (l: VaultLoan) => (l.state.kind === "requested" || l.state.kind === "cancelling" ? null : nsToMsNumber(l.state.due_at_ns));
export const lenderOf = (l: VaultLoan) => (l.state.kind === "requested" || l.state.kind === "cancelling" ? null : l.state.lender);
