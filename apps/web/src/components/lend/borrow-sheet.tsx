"use client";

import type { LoanTerms, VaultView } from "@bearer/sdk";
import { ArrowLeft, HandCoins, Loader2 } from "lucide-react";
import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { FieldMessage, Input, Label } from "@/components/ui/primitives";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ReviewBlock } from "@/components/vault/transfer-sheet";
import { VaultCard } from "@/components/vault/vault-card";
import { LEND_CONTRACT } from "@/lib/config";
import { cn } from "@/lib/utils";
import { errorCopy } from "@/lib/vault/errors";
import { formatNear, parseNear, vaultNumber } from "@/lib/vault/format";
import { useLendConfig, useRequestLoan } from "@/lib/vault/hooks";
import { interestPercent, LendLock, termText } from "./lend-bits";

type Step = "form" | "review" | "done";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
/** The first is short so the whole loan can be tried in one sitting. */
const TERMS = [10 * MIN, 7 * DAY, 30 * DAY, 90 * DAY, 365 * DAY];

/** yoctoNEAR → "1250.5", as typed, for editing. */
const plainNear = (yocto: string) => formatNear(yocto, 24).replace(/ NEAR$/, "").replaceAll(",", "");

/** Pledge a sealed vault for a loan: how much now, how much back, and how long to repay. */
export function BorrowSheet({
  open,
  onOpenChange,
  vault,
  signer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vault: VaultView;
  signer: string;
}) {
  const [step, setStep] = useState<Step>("form");
  const [terms, setTerms] = useState<LoanTerms | null>(null);
  const request = useRequestLoan();
  const config = useLendConfig();
  const deposit = config.data ? formatNear(config.data.loan_deposit) : "a small";

  function close(o: boolean) {
    onOpenChange(o);
    if (!o) {
      setStep("form");
      setTerms(null);
    }
  }

  const loan = terms ? { principal: terms.principalYocto, repayment: terms.repaymentYocto } : null;

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent
        title={step === "done" ? "Loan requested" : step === "review" ? "Review the loan" : "Borrow against this vault"}
        description={
          step === "form"
            ? "Get NEAR now and keep the vault's coins where they are. Repay in time and it comes back to you, still sealed."
            : undefined
        }
      >
        {step === "form" ? (
          <FormStep
            initial={terms}
            onNext={(t) => {
              setTerms(t);
              setStep("review");
            }}
          />
        ) : null}

        {step === "review" && terms && loan ? (
          <div className="flex flex-col gap-5">
            <p className="text-[15px]">
              Pledge vault <span className="font-mono">{vaultNumber(vault.token_id)}</span> for{" "}
              <span className="font-semibold">{formatNear(terms.principalYocto)}</span>, repaying{" "}
              <span className="font-semibold">{formatNear(terms.repaymentYocto)}</span> within{" "}
              <span className="font-semibold">{termText(terms.termMs)}</span> of being funded?
            </p>

            <ReviewBlock title="Until someone lends" tone="neutral">
              <li>The lending contract ({LEND_CONTRACT}) holds the vault. It stays sealed</li>
              <li>Lenders see your terms and what&apos;s at the vault&apos;s addresses, read from the chains</li>
              <li>You can take it back at any time, with your {deposit} deposit</li>
            </ReviewBlock>

            <ReviewBlock title="Once a lender funds it" tone="gold">
              <li>{formatNear(terms.principalYocto)} arrives in your account straight away</li>
              <li>
                You have {termText(terms.termMs)} to repay exactly {formatNear(terms.repaymentYocto)} ({interestPercent(loan)} on top)
              </li>
              <li>Repay in time and the vault comes back to you first; the lender is paid once it has</li>
              <li>Nobody can withdraw from it meanwhile, you included</li>
            </ReviewBlock>

            <ReviewBlock title="If you don't repay in time" tone="danger">
              <li>From the due date, the lender can take the vault and everything at its addresses</li>
              <li>You keep the {formatNear(terms.principalYocto)}. Nobody can extend the term or repay late</li>
            </ReviewBlock>

            <div className="rounded-[14px] border border-line bg-bg px-3.5 py-3">
              <LendLock />
            </div>

            <div className="flex flex-col gap-2.5">
              <Button
                variant="primary"
                size="lg"
                disabled={request.isPending}
                onClick={() =>
                  request.mutate(
                    { id: vault.token_id, terms, signer },
                    { onSuccess: () => setStep("done"), onError: (e) => toast.error(errorCopy(e)) },
                  )
                }
              >
                {request.isPending ? <Loader2 className="size-4 animate-spin" /> : <HandCoins className="size-4" />}
                {request.isPending ? "Confirm in your wallet…" : "Pledge it and ask"}
              </Button>
              <Button variant="ghost" onClick={() => setStep("form")} disabled={request.isPending}>
                <ArrowLeft className="size-4" />
                Change it
              </Button>
            </div>
          </div>
        ) : null}

        {step === "done" && terms ? (
          <div className="flex flex-col items-center pt-2 text-center" aria-live="polite">
            <div className="w-[260px] animate-card-flip">
              <VaultCard vault={vault} flippable={false} />
            </div>
            <p className="mt-7 text-[20px] font-semibold tracking-[-0.02em]">Asking for {formatNear(terms.principalYocto)}</p>
            <p className="mt-2 max-w-[320px] text-[14.5px] leading-relaxed text-fg-2">
              Lenders see it on the Lend page. When someone funds it, the NEAR arrives in your account and you have{" "}
              {termText(terms.termMs)} to repay.
            </p>
            <Link href="/lend" className={cn(buttonVariants({ variant: "primary", size: "lg" }), "mt-7 w-full")} onClick={() => close(false)}>
              See it on the Lend page
            </Link>
            <Button className="mt-2.5 w-full" variant="ghost" onClick={() => close(false)}>
              Back to the vault
            </Button>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function FormStep({ initial, onNext }: { initial: LoanTerms | null; onNext: (t: LoanTerms) => void }) {
  const id = useId();
  const [principal, setPrincipal] = useState(initial ? plainNear(initial.principalYocto) : "");
  const [repayment, setRepayment] = useState(initial ? plainNear(initial.repaymentYocto) : "");
  const [term, setTerm] = useState(initial?.termMs ?? 30 * DAY);
  const [touched, setTouched] = useState(false);

  const p = principal.trim() ? parseNear(principal) : null;
  const r = repayment.trim() ? parseNear(repayment) : null;
  const principalError = !principal.trim()
    ? "How much do you want to borrow?"
    : p === null
      ? "Enter an amount in NEAR, like 25 or 2.5."
      : BigInt(p) < 10n ** 21n
        ? "The smallest loan is 0.001 NEAR."
        : null;
  const repaymentError = !repayment.trim()
    ? "How much will you pay back?"
    : r === null
      ? "Enter an amount in NEAR."
      : p !== null && BigInt(r) < BigInt(p)
        ? "You can't pay back less than you borrow."
        : null;
  const ok = !principalError && !repaymentError;

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (ok && p && r) onNext({ principalYocto: p, repaymentYocto: r, termMs: term });
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <div>
        <Label htmlFor={`${id}-p`}>You borrow</Label>
        <div className="relative mt-2">
          <Input
            id={`${id}-p`}
            className="tabular bg-bg pr-16"
            inputMode="decimal"
            value={principal}
            onChange={(e) => setPrincipal(e.target.value)}
            placeholder="25"
            autoComplete="off"
          />
          <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[14px] text-fg-3">NEAR</span>
        </div>
        <FieldMessage tone={touched && principalError ? "error" : "muted"}>
          {touched && principalError ? principalError : "Paid to you by the lender, the moment they fund it."}
        </FieldMessage>
      </div>

      <div>
        <Label htmlFor={`${id}-r`}>You pay back</Label>
        <div className="relative mt-2">
          <Input
            id={`${id}-r`}
            className="tabular bg-bg pr-16"
            inputMode="decimal"
            value={repayment}
            onChange={(e) => setRepayment(e.target.value)}
            placeholder="26"
            autoComplete="off"
          />
          <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[14px] text-fg-3">NEAR</span>
        </div>
        <FieldMessage tone={touched && repaymentError ? "error" : "muted"}>
          {touched && repaymentError
            ? repaymentError
            : p && r && BigInt(r) >= BigInt(p)
              ? `${interestPercent({ principal: p, repayment: r })} on top, for the whole term. That's what the lender earns.`
              : "The loan plus what the lender earns. Exactly this, all at once."}
        </FieldMessage>
      </div>

      <fieldset>
        <legend className="text-[13.5px] font-medium">Time to repay, from funding</legend>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {TERMS.map((ms) => (
            <label
              key={ms}
              className={cn(
                "inline-flex h-8 cursor-pointer items-center rounded-full border px-3 text-[13px] transition-colors",
                term === ms ? "border-gold/60 bg-gold/[0.08] text-fg" : "border-line text-fg-2 hover:border-line-strong hover:text-fg",
              )}
            >
              <input type="radio" name={`${id}-term`} className="sr-only" checked={term === ms} onChange={() => setTerm(ms)} />
              {termText(ms)}
            </label>
          ))}
        </div>
        <FieldMessage tone="muted">
          {term < DAY ? "Short, so you can try a whole loan in one sitting." : "Repay any time before it ends. After that, only the lender can act."}
        </FieldMessage>
      </fieldset>

      <Button type="submit" variant="primary" size="lg" disabled={touched && !ok}>
        Review the loan
      </Button>
    </form>
  );
}
