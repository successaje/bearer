"use client";

import type { ChainObservation, VaultLoan, VaultView } from "@bearer/sdk";
import { Check, HandCoins, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { ObservedHoldings } from "@/components/market/market-bits";
import { formatWhen } from "@/components/schedule/when";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ReviewBlock } from "@/components/vault/transfer-sheet";
import { LEND_CONTRACT } from "@/lib/config";
import { errorCopy } from "@/lib/vault/errors";
import { formatNear, formatUsd, vaultNumber } from "@/lib/vault/format";
import { useContractFacts, useFundLoan, useLendFacts, useNow } from "@/lib/vault/hooks";
import { isSealed, observedUsd } from "@/lib/vault/report";
import { interestPercent, termMs, termText } from "./lend-bits";

/**
 * Lending: what backs the loan (as public data shows it now), the checks that matter, where the
 * money goes and when it comes back, and what happens if it doesn't. Then one transaction.
 */
export function LendSheet({
  open,
  onOpenChange,
  vault,
  loan,
  observations,
  signer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vault: VaultView;
  loan: VaultLoan;
  observations: ChainObservation[] | undefined;
  signer: string;
}) {
  const fund = useFundLoan();
  const now = useNow(5000);
  const bearerLocked = useContractFacts().data?.locked ?? null;
  const lendLocked = useLendFacts().data?.locked ?? null;
  const principal = formatNear(loan.principal);
  const repayment = formatNear(loan.repayment);
  const term = termText(termMs(loan));

  const checks: [string, boolean | null][] = [
    ["Sealed", isSealed(vault)],
    ["0 signatures ever requested", vault.signatures_requested === 0],
    [`Held by the lending contract for ${loan.borrower}`, vault.owner_id === LEND_CONTRACT],
    ["Bearer contract locked", bearerLocked],
    ["Lending contract locked", lendLocked],
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title={`Lend ${principal}`} description={`To ${loan.borrower}, against vault ${vaultNumber(vault.token_id)}.`}>
        <div className="flex flex-col gap-5">
          <div className="rounded-[14px] border border-gold/35 bg-gold/[0.06] px-4 py-3.5">
            <p className="text-[12px] font-medium uppercase tracking-[0.12em] text-fg-3">Backed by</p>
            <p className="mt-2 text-[13.5px] leading-relaxed">
              The vault and whatever is at its three addresses. Now, observed
              {observations ? <span className="text-fg-3"> ({formatUsd(observedUsd(observations))} est.)</span> : null}:
            </p>
            <div className="mt-3">
              <ObservedHoldings observations={observations} now={now} />
            </div>
            <p className="mt-3 text-[12.5px] leading-relaxed text-fg-3">
              Observations, not guarantees: what public data shows right now. Pending deposits can still fail, and prices move.
            </p>
          </div>

          <div className="overflow-hidden rounded-[14px] border border-line bg-bg">
            <p className="border-b border-line px-3.5 py-3 text-[13.5px] font-medium">Checked just now</p>
            <ul className="py-1.5 text-[13.5px] text-fg-2">
              {checks.map(([label, ok]) => (
                <li key={label} className="flex items-center gap-2.5 px-3.5 py-1.5">
                  {ok === null ? (
                    <Loader2 className="size-3.5 animate-spin text-fg-3" aria-label="Checking" />
                  ) : ok ? (
                    <Check className="size-3.5 text-ok" strokeWidth={3} aria-label="Passed" />
                  ) : (
                    <X className="size-3.5 text-danger" strokeWidth={3} aria-label="Not passed" />
                  )}
                  {label}
                </li>
              ))}
            </ul>
          </div>

          <ReviewBlock title="You pay" tone="neutral">
            <li>Exactly {principal}, passed straight to {loan.borrower}</li>
            <li>The vault stays with the lending contract, sealed. Nobody can withdraw from it, {loan.borrower} included</li>
          </ReviewBlock>

          <ReviewBlock title="You get" tone="gold">
            <li>
              {repayment} ({interestPercent(loan)} on top) if {loan.borrower} repays within {term}
              {now ? `, by ${formatWhen(now + termMs(loan))}` : ""}
            </li>
            <li>Otherwise, from that date, the vault: you can take it, sealed, with whatever is at its addresses then</li>
          </ReviewBlock>

          <ReviewBlock title="Not risk-free" tone="danger">
            <li>This is a testnet prototype. Neither contract has been audited</li>
            <li>No price feed: if what&apos;s in the vault falls below {repayment}, the borrower may let you keep it instead of repaying</li>
            <li>You can&apos;t ask for the money back early. The loan runs its term</li>
            {lendLocked === false ? (
              <li>The lending contract isn&apos;t locked yet: whoever holds its key could act as this vault&apos;s owner while it&apos;s pledged</li>
            ) : null}
          </ReviewBlock>

          <Button
            variant="primary"
            size="lg"
            disabled={fund.isPending}
            onClick={() =>
              fund.mutate(
                { loan, signer },
                {
                  onSuccess: () => {
                    toast.success(`Lent. ${loan.borrower} has ${principal}; the term has started.`);
                    onOpenChange(false);
                  },
                  onError: (e) => toast.error(errorCopy(e)),
                },
              )
            }
          >
            {fund.isPending ? <Loader2 className="size-4 animate-spin" /> : <HandCoins className="size-4" />}
            {fund.isPending ? "Confirm in your wallet…" : `Lend ${principal}`}
          </Button>
          <p className="text-center text-[12.5px] text-fg-3">One NEAR transaction. If the terms changed since you opened this, it&apos;s refused.</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
