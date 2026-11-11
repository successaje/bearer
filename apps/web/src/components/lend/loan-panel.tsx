"use client";

import type { VaultLoan } from "@bearer/sdk";
import { Gavel, HandCoins, Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatWhen, untilText } from "@/components/schedule/when";
import { LEND_CONTRACT } from "@/lib/config";
import { errorCopy } from "@/lib/vault/errors";
import { formatNear } from "@/lib/vault/format";
import { useCancelLoanRequest, useForecloseLoan, useRepayLoan } from "@/lib/vault/hooks";
import { dueMs, interestPercent, LendLock, lenderOf, termMs, termText } from "./lend-bits";

/**
 * On a pledged vault's page: the loan's terms and the one thing the viewer can do. Before anyone
 * lends, others can fund it and the borrower can take it back. Once funded, only the borrower
 * can repay, before the due date; from the due date only the lender can take the vault.
 */
export function LoanPanel({
  loan,
  viewer,
  now,
  onFund,
  onConnect,
}: {
  loan: VaultLoan;
  /** The connected account, or null. */
  viewer: string | null;
  now: number;
  onFund: () => void;
  onConnect: () => void;
}) {
  const repay = useRepayLoan();
  const foreclose = useForecloseLoan();
  const cancel = useCancelLoanRequest();
  const lender = lenderOf(loan);
  const due = dueMs(loan);
  const overdue = due !== null && now >= due;
  const isBorrower = viewer === loan.borrower;
  const isLender = !!lender && viewer === lender;
  const principal = formatNear(loan.principal);
  const repayment = formatNear(loan.repayment);
  const pending = repay.isPending || foreclose.isPending || cancel.isPending;

  return (
    <div className="mt-7 rounded-panel border border-gold/35 bg-gold/[0.05] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-mono text-[11.5px] font-medium uppercase tracking-[0.16em] text-accent">
          {loan.state.kind === "requested" ? "Asking for a loan" : overdue ? "Loan overdue" : "Loan running"}
        </p>
        <p className="text-[13px] text-fg-3">
          Borrower <span className="font-mono text-fg-2">{isBorrower ? "you" : loan.borrower}</span>
          {lender ? (
            <>
              {" "}· lender <span className="font-mono text-fg-2">{isLender ? "you" : lender}</span>
            </>
          ) : null}
        </p>
      </div>
      <p className="tabular mt-2 text-[24px] font-semibold leading-tight tracking-[-0.025em]">
        {principal} <span className="text-fg-3">now,</span> {repayment} <span className="text-fg-3">back</span>
      </p>
      <p className="tabular mt-1.5 text-[14.5px] text-fg-2">
        {due === null ? (
          <>
            Within <span className="font-medium text-fg">{termText(termMs(loan))}</span> of being funded ·{" "}
            {interestPercent(loan)} for the term
          </>
        ) : overdue ? (
          <>
            Was due <span className="font-medium text-fg">{formatWhen(due)}</span>. The lender can take the vault.
          </>
        ) : (
          <>
            Due <span className="font-medium text-fg">{formatWhen(due)}</span>
            <span className="text-fg-3"> · {untilText(due, now)}</span>
          </>
        )}
      </p>
      <p className="mt-3 text-[13.5px] leading-relaxed text-fg-2">
        Held by the lending contract (<span className="font-mono">{LEND_CONTRACT}</span>), still sealed: nobody can withdraw
        while it&apos;s pledged, {isBorrower ? "you" : loan.borrower} included.{" "}
        {due === null
          ? `${isBorrower ? "You" : loan.borrower} can take it back until someone lends.`
          : `Repaid in time, it goes back to ${isBorrower ? "you" : loan.borrower}; if not, ${isLender ? "you" : lender} can take it.`}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        {loan.state.kind === "repaying" || loan.state.kind === "foreclosing" || loan.state.kind === "cancelling" ? (
          <span className="inline-flex items-center gap-2 text-[14px] text-fg-2" aria-live="polite">
            <Loader2 className="size-4 animate-spin" />
            {loan.state.kind === "foreclosing" ? `Going to ${lender}…` : `Going back to ${loan.borrower}…`}
          </span>
        ) : !viewer ? (
          <Button variant="primary" onClick={onConnect}>
            Connect a wallet {due === null ? "to lend" : "to act on it"}
          </Button>
        ) : loan.state.kind === "requested" ? (
          isBorrower ? (
            <Button
              disabled={pending}
              onClick={() =>
                cancel.mutate(
                  { id: loan.token_id, signer: viewer },
                  { onSuccess: () => toast.success("Taken back. The vault and your deposit are with you again."), onError: (e) => toast.error(errorCopy(e)) },
                )
              }
            >
              {cancel.isPending ? <Loader2 className="size-4 animate-spin" /> : <Undo2 className="size-4" />}
              {cancel.isPending ? "Confirm in your wallet…" : "Take it back"}
            </Button>
          ) : (
            <Button variant="primary" onClick={onFund}>
              <HandCoins className="size-4" />
              Lend {principal}
            </Button>
          )
        ) : isBorrower && !overdue ? (
          <Button
            variant="primary"
            disabled={pending}
            onClick={() =>
              repay.mutate(
                { id: loan.token_id, signer: viewer },
                { onSuccess: () => toast.success(`Repaid. The vault is back with you, and ${lender} has ${repayment}.`), onError: (e) => toast.error(errorCopy(e)) },
              )
            }
          >
            {repay.isPending ? <Loader2 className="size-4 animate-spin" /> : <HandCoins className="size-4" />}
            {repay.isPending ? "Confirm, then settling…" : `Repay ${repayment}`}
          </Button>
        ) : isLender && overdue ? (
          <Button
            variant="primary"
            disabled={pending}
            onClick={() =>
              foreclose.mutate(
                { id: loan.token_id, signer: viewer },
                { onSuccess: () => toast.success("The vault is yours, still sealed."), onError: (e) => toast.error(errorCopy(e)) },
              )
            }
          >
            {foreclose.isPending ? <Loader2 className="size-4 animate-spin" /> : <Gavel className="size-4" />}
            {foreclose.isPending ? "Confirm, then settling…" : "Take the vault"}
          </Button>
        ) : (
          <p className="text-[13px] text-fg-3">
            {overdue
              ? `Only ${lender} can take it now. ${loan.borrower} can no longer repay.`
              : isLender
                ? `${loan.borrower} can repay until the due date. If they don't, you can take the vault then.`
                : `Only ${loan.borrower} can repay, until the due date. After it, only ${lender} can take the vault.`}
          </p>
        )}
      </div>
      <div className="mt-4 border-t border-gold/20 pt-3.5">
        <LendLock compact />
      </div>
    </div>
  );
}
