"use client";

import type { ChainObservation, ChainTag, StandingTerms, VaultView } from "@bearer/sdk";
import { ArrowLeft, Check, Loader2, Repeat } from "lucide-react";
import { useEffect, useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ChainIcon } from "@/components/brand/chain-icon";
import { formatWhen } from "@/components/schedule/when";
import { Button } from "@/components/ui/button";
import { FieldMessage, Input, Label } from "@/components/ui/primitives";
import { SegmentedList, SegmentedRoot, SegmentedTrigger } from "@/components/ui/segmented";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ReviewBlock } from "@/components/vault/transfer-sheet";
import { VaultCard } from "@/components/vault/vault-card";
import { STANDING_CONTRACT } from "@/lib/config";
import { cn } from "@/lib/utils";
import { standingErrorCopy } from "@/lib/vault/errors";
import { CHAIN_META, formatNear, fromDecimal, truncateMiddle, vaultNumber } from "@/lib/vault/format";
import { useAccountExists, usePlanPayments, useStandingConfig } from "@/lib/vault/hooks";
import { validateAddress, validateNearAccount } from "@/lib/validation";
import { coins, DEFAULT_MAX_FEE, PERIODS, periodText, StandingLock } from "./standing-bits";

type Step = "form" | "review" | "done";
const CHAINS: ChainTag[] = ["btc", "evm", "sol"];
const COUNTS = [3, 12, 52, null] as const;

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Set a sealed vault to pay someone a fixed amount every period, from its own coins. */
export function StandingSheet({
  open,
  onOpenChange,
  vault,
  observations,
  signer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vault: VaultView;
  observations: ChainObservation[] | undefined;
  signer: string;
}) {
  const [step, setStep] = useState<Step>("form");
  const [terms, setTerms] = useState<StandingTerms | null>(null);
  const [startsLater, setStartsLater] = useState(false);
  const plan = usePlanPayments();
  const config = useStandingConfig();
  const deposit = config.data ? formatNear(config.data.plan_deposit) : "a small";

  function close(o: boolean) {
    onOpenChange(o);
    if (!o) {
      setStep("form");
      setTerms(null);
    }
  }

  const total = terms && terms.maxPayments !== null ? BigInt(terms.amount) * BigInt(terms.maxPayments) : null;
  const held = terms ? BigInt(observations?.find((o) => o.chain === terms.chain)?.confirmed ?? "0") : 0n;

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent
        title={
          step === "done" ? "Payments set up" : step === "review" ? "Review the payments" : "Pay someone regularly"
        }
        description={
          step === "form"
            ? "The vault pays a fixed amount from its own coins every period. The payee collects each one; nobody can send more, or anywhere else."
            : undefined
        }
      >
        {step === "form" ? (
          <StandingForm
            signer={signer}
            observations={observations}
            initial={terms}
            onNext={(t, later) => {
              setTerms(t);
              setStartsLater(later);
              setStep("review");
            }}
          />
        ) : null}

        {step === "review" && terms ? (
          <div className="flex flex-col gap-5">
            <p className="text-[15px] leading-relaxed">
              Vault <span className="font-mono">{vaultNumber(vault.token_id)}</span> pays{" "}
              <span className="font-semibold">{coins(terms.chain, terms.amount)}</span> to{" "}
              <span className="font-mono font-semibold">{terms.payee}</span> every{" "}
              <span className="font-semibold">{periodText(terms.intervalMs)}</span>
              {terms.maxPayments !== null ? (
                <>
                  , <span className="font-semibold">{terms.maxPayments} times</span>
                </>
              ) : (
                ", until you stop it"
              )}
              .
            </p>

            <ReviewBlock title="Each period" tone="gold">
              <li>
                {terms.payee} can collect {coins(terms.chain, terms.amount)}, sent to {truncateMiddle(terms.to, 10, 6)}{" "}
                on {CHAIN_META[terms.chain].name} and nowhere else
              </li>
              <li>
                {terms.chain === "sol"
                  ? "Solana's fixed fee (0.000005 SOL) comes from the vault too"
                  : `Its network fee comes from the vault, never more than ${coins(terms.chain, terms.maxFee)}`}
              </li>
              <li>
                The first one is due {startsLater ? formatWhen(terms.firstDueMs) : "straight away"}. A missed period can
                still be collected later
              </li>
              {total !== null ? (
                <li>
                  Up to {coins(terms.chain, total)} in all, plus fees. The vault holds {coins(terms.chain, held)} on{" "}
                  {CHAIN_META[terms.chain].name} now
                </li>
              ) : (
                <li>
                  The vault holds {coins(terms.chain, held)} on {CHAIN_META[terms.chain].name} now. Anyone can top it up
                </li>
              )}
            </ReviewBlock>

            <ReviewBlock title="The first payment breaks the seal" tone="danger">
              <li>Paying from a vault means asking for a signature, so the first payment opens it</li>
              <li>
                An opened vault never changes hands again: it stays with the standing-payments contract (
                {STANDING_CONTRACT}) for good
              </li>
              <li>
                {terms.cancellable
                  ? "From then on you act through the contract: stop the payments at any time, and withdraw what's left"
                  : `Nobody can stop the payments, you included. Once they end you can withdraw what's left through the contract`}
              </li>
            </ReviewBlock>

            <ReviewBlock title="Worth knowing" tone="neutral">
              {terms.cancellable ? (
                <li>Until the first payment, you can take the vault back, still sealed, with your {deposit} deposit</li>
              ) : null}
              {terms.maxPayments !== null ? (
                <li>A payment not collected within a period after the last one falls due lapses</li>
              ) : null}
              <li>If the vault runs short, a payment is refused until someone tops it up. Nothing is lost</li>
              <li>Who you pay, how much and where are public on NEAR</li>
            </ReviewBlock>

            <div className="border-line bg-bg rounded-[14px] border px-3.5 py-3">
              <StandingLock />
            </div>

            <div className="flex flex-col gap-2.5">
              <Button
                variant="primary"
                size="lg"
                disabled={plan.isPending}
                onClick={() =>
                  plan.mutate(
                    { id: vault.token_id, terms, signer },
                    { onSuccess: () => setStep("done"), onError: (e) => toast.error(standingErrorCopy(e)) },
                  )
                }
              >
                {plan.isPending ? <Loader2 className="size-4 animate-spin" /> : <Repeat className="size-4" />}
                {plan.isPending ? "Confirm in your wallet…" : "Set up the payments"}
              </Button>
              <Button variant="ghost" onClick={() => setStep("form")} disabled={plan.isPending}>
                <ArrowLeft className="size-4" />
                Change it
              </Button>
            </div>
          </div>
        ) : null}

        {step === "done" && terms ? (
          <div className="flex flex-col items-center pt-2 text-center" aria-live="polite">
            <div className="animate-card-flip w-[260px]">
              <VaultCard vault={vault} flippable={false} />
            </div>
            <p className="mt-7 text-[20px] font-semibold tracking-[-0.02em]">Paying {terms.payee}</p>
            <p className="text-fg-2 mt-2 max-w-[320px] text-[14.5px] leading-relaxed">
              {coins(terms.chain, terms.amount)} every {periodText(terms.intervalMs)}. Send {terms.payee} this
              vault&apos;s page: they collect each payment there.
            </p>
            <Button className="mt-7 w-full" variant="primary" size="lg" onClick={() => close(false)}>
              Back to the vault
            </Button>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function StandingForm({
  signer,
  observations,
  initial,
  onNext,
}: {
  signer: string;
  observations: ChainObservation[] | undefined;
  initial: StandingTerms | null;
  onNext: (t: StandingTerms, later: boolean) => void;
}) {
  const id = useId();
  const funded = observations?.find((o) => BigInt(o.confirmed) > 0n)?.chain ?? "btc";
  const [payee, setPayee] = useState(initial?.payee ?? "");
  const [chain, setChain] = useState<ChainTag>(initial?.chain ?? funded);
  const [to, setTo] = useState(initial?.to ?? "");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState(initial?.intervalMs ?? PERIODS[2]);
  const [count, setCount] = useState<number | null>(initial ? initial.maxPayments : 12);
  const [cancellable, setCancellable] = useState(initial?.cancellable ?? true);
  const [later, setLater] = useState(false);
  const [touched, setTouched] = useState(false);

  const p = payee.trim().toLowerCase();
  const payeeFormat = validateNearAccount(p);
  const debounced = useDebounced(p, 400);
  const exists = useAccountExists(!payeeFormat && debounced === p && p !== signer ? p : null);
  const payeeMsg = !p
    ? { tone: "muted" as const, text: "The NEAR testnet account that collects each payment." }
    : payeeFormat
      ? { tone: "error" as const, text: payeeFormat }
      : p === signer
        ? { tone: "error" as const, text: "That's you. Name who gets paid." }
        : exists.isFetching || debounced !== p
          ? { tone: "muted" as const, text: "Checking account…" }
          : exists.data === false
            ? { tone: "error" as const, text: `${p} doesn't exist on NEAR yet, so nobody could collect.` }
            : { tone: "ok" as const, text: "Account found on NEAR testnet." };

  const toError = validateAddress(chain, to);
  const parsed = fromDecimal(chain, amount);
  const amountError = !amount ? "Enter an amount." : parsed === null || parsed <= 0n ? "Enter a valid amount." : null;
  const countError = !cancellable && count === null ? "A plan nobody can stop needs a number of payments." : null;
  const ok = !payeeFormat && p !== signer && exists.data !== false && !toError && !amountError && !countError;
  const held = observations?.find((o) => o.chain === chain);

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!ok || parsed === null) return;
    onNext(
      {
        payee: p,
        chain,
        to: to.trim(),
        amount: parsed.toString(),
        maxFee: DEFAULT_MAX_FEE[chain].toString(),
        intervalMs: period,
        firstDueMs: later ? Date.now() + period : Date.now(),
        maxPayments: count,
        cancellable,
      },
      later,
    );
  }

  const chip = (active: boolean) =>
    cn(
      "inline-flex h-8 cursor-pointer items-center rounded-full border px-3 text-[13px] transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent",
      active ? "border-gold/60 bg-gold/[0.08] text-fg" : "border-line text-fg-2 hover:border-line-strong hover:text-fg",
    );

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <div>
        <Label htmlFor={`${id}-payee`}>Who collects</Label>
        <Input
          id={`${id}-payee`}
          className={cn("bg-bg mt-2 font-mono", payeeMsg.tone === "ok" && "border-ok/50")}
          value={payee}
          onChange={(e) => setPayee(e.target.value)}
          placeholder="name.testnet"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-describedby={`${id}-payee-msg`}
        />
        <FieldMessage id={`${id}-payee-msg`} tone={touched || p ? payeeMsg.tone : "muted"} aria-live="polite">
          {payeeMsg.text}
        </FieldMessage>
      </div>

      <div>
        <p className="text-[13.5px] font-medium">Paid in</p>
        <SegmentedRoot
          value={chain}
          onValueChange={(v) => {
            setChain(v as ChainTag);
            setTo("");
            setAmount("");
          }}
          className="mt-2"
        >
          <SegmentedList aria-label="Chain" className="grid grid-cols-3">
            {CHAINS.map((c) => {
              const o = observations?.find((x) => x.chain === c);
              return (
                <SegmentedTrigger key={c} value={c} className="h-auto flex-col gap-1 py-2.5">
                  <ChainIcon chain={c} className="size-5" />
                  <span className="text-[13px]">{CHAIN_META[c].name}</span>
                  {o ? (
                    <span className="tabular text-fg-3 text-[11.5px] font-normal">{coins(c, o.confirmed)}</span>
                  ) : null}
                </SegmentedTrigger>
              );
            })}
          </SegmentedList>
        </SegmentedRoot>
      </div>

      <div>
        <Label htmlFor={`${id}-to`}>Sent to</Label>
        <Input
          id={`${id}-to`}
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder={chain === "btc" ? "tb1q…" : chain === "evm" ? "0x…" : "Solana address"}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={touched && toError ? true : undefined}
          aria-describedby={`${id}-to-msg`}
          className="bg-bg mt-2 font-mono text-[14px]"
        />
        <FieldMessage id={`${id}-to-msg`} tone={touched && toError ? "error" : "muted"}>
          {touched && toError
            ? toError
            : `The payee's address on ${CHAIN_META[chain].name} ${CHAIN_META[chain].network}. Every payment goes here, and only here.`}
        </FieldMessage>
      </div>

      <div>
        <Label htmlFor={`${id}-amount`}>Each payment</Label>
        <div className="relative mt-2">
          <Input
            id={`${id}-amount`}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.0001"
            autoComplete="off"
            aria-invalid={touched && amountError ? true : undefined}
            aria-describedby={`${id}-amount-msg`}
            className="tabular bg-bg pr-16"
          />
          <span className="text-fg-3 pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-[13.5px]">
            {CHAIN_META[chain].unit}
          </span>
        </div>
        <FieldMessage id={`${id}-amount-msg`} tone={touched && amountError ? "error" : "muted"}>
          {touched && amountError
            ? amountError
            : held
              ? `The vault holds ${coins(chain, held.confirmed)} confirmed on ${CHAIN_META[chain].name}.`
              : "From the vault's own coins."}
        </FieldMessage>
      </div>

      <fieldset>
        <legend className="text-[13.5px] font-medium">Every</legend>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {PERIODS.map((ms) => (
            <label key={ms} className={chip(period === ms)}>
              <input
                type="radio"
                name={`${id}-period`}
                className="sr-only"
                checked={period === ms}
                onChange={() => setPeriod(ms)}
              />
              {periodText(ms)}
            </label>
          ))}
        </div>
        <FieldMessage tone="muted">
          {period < 3600_000
            ? "Short, so you can try the whole thing in one sitting."
            : "The payee can collect once each period."}
        </FieldMessage>
      </fieldset>

      <fieldset>
        <legend className="text-[13.5px] font-medium">How many payments</legend>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {COUNTS.map((n) => (
            <label key={String(n)} className={chip(count === n)}>
              <input
                type="radio"
                name={`${id}-count`}
                className="sr-only"
                checked={count === n}
                onChange={() => setCount(n)}
              />
              {n === null ? "Until I stop it" : n}
            </label>
          ))}
        </div>
        <FieldMessage tone={touched && countError ? "error" : "muted"}>
          {touched && countError
            ? countError
            : count === null
              ? "It runs until you stop it."
              : `Then it ends. ${count} × the amount is the most it can ever pay.`}
        </FieldMessage>
      </fieldset>

      <Choice
        name={`${id}-start`}
        legend="The first payment"
        value={later}
        onChange={setLater}
        options={[
          [false, "Straight away", "The payee can collect it as soon as it's set up."],
          [true, `In ${periodText(period)}`, "One period from now, then every period after."],
        ]}
      />

      <Choice
        name={`${id}-cancel`}
        legend="Can it be stopped?"
        value={cancellable}
        onChange={setCancellable}
        options={[
          [true, "I can stop it at any time", "And take the vault back, still sealed, until the first payment."],
          [false, "Nobody can stop it", "Not even you, until the last payment. The payee can count on it."],
        ]}
      />

      <Button type="submit" variant="primary" size="lg" disabled={touched && !ok}>
        Review the payments
      </Button>
    </form>
  );
}

/** Two choices as cards, like the schedule's "Can it be cancelled?". */
function Choice({
  name,
  legend,
  value,
  onChange,
  options,
}: {
  name: string;
  legend: string;
  value: boolean;
  onChange: (v: boolean) => void;
  options: [boolean, string, string][];
}) {
  return (
    <fieldset>
      <legend className="text-[13.5px] font-medium">{legend}</legend>
      <div className="mt-2 grid gap-2">
        {options.map(([v, title, sub]) => (
          <label
            key={String(v)}
            className={cn(
              "has-[:focus-visible]:ring-accent flex cursor-pointer items-start gap-3 rounded-[12px] border px-3.5 py-3 transition-colors has-[:focus-visible]:ring-2",
              value === v ? "border-gold/50 bg-gold/[0.06]" : "border-line hover:border-line-strong",
            )}
          >
            <input type="radio" name={name} className="sr-only" checked={value === v} onChange={() => onChange(v)} />
            <span
              className={cn(
                "mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border",
                value === v ? "border-gold bg-gold text-ink" : "border-line-strong",
              )}
            >
              {value === v ? <Check className="size-3" strokeWidth={3} aria-hidden /> : null}
            </span>
            <span>
              <span className="block text-[14px] font-medium">{title}</span>
              <span className="text-fg-3 block text-[12.5px]">{sub}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
