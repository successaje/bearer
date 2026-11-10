"use client";

import type { ChainObservation, VaultView } from "@bearer/sdk";
import { ArrowLeft, Check, Loader2, Send, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { FieldMessage, Input, Label } from "@/components/ui/primitives";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { MARKET_CONTRACT } from "@/lib/config";
import { errorCopy } from "@/lib/vault/errors";
import { useAccountExists, useContractFacts, useTransfer } from "@/lib/vault/hooks";
import { CHAIN_META, formatAmount, formatUsd, vaultNumber } from "@/lib/vault/format";
import { isSealed, observedUsd } from "@/lib/vault/report";
import { validateNearAccount } from "@/lib/validation";
import { cn } from "@/lib/utils";
import { VaultCard } from "./vault-card";

type Step = "recipient" | "review" | "done";

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Brief 3.4 Flow C: recipient, then a full review of what changes hands, then done. */
export function TransferSheet({
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
  const [step, setStep] = useState<Step>("recipient");
  const [receiver, setReceiver] = useState("");
  const [done, setDone] = useState<VaultView | null>(null);
  const transfer = useTransfer();
  const locked = useContractFacts().data?.locked ?? null;

  function close(o: boolean) {
    onOpenChange(o);
    if (!o) {
      setStep("recipient");
      setReceiver("");
      setDone(null);
    }
  }

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent
        title={step === "done" ? "Transferred" : step === "review" ? "Review the transfer" : "Transfer this vault"}
        description={step === "recipient" ? "Give the vault, and everything inside it, to another NEAR account." : undefined}
      >
        {step === "recipient" ? (
          <RecipientStep signer={signer} initial={receiver} onNext={(r) => {
            setReceiver(r);
            setStep("review");
          }} />
        ) : null}

        {step === "review" ? (
          <div className="flex flex-col gap-5">
            <p className="text-[15px]">
              Transfer vault <span className="font-mono">{vaultNumber(vault.token_id)}</span> to{" "}
              <span className="font-mono font-semibold">{receiver}</span>?
            </p>

            <ReviewBlock title="Changing hands" tone="gold">
              <li>Control of the vault&apos;s three addresses and everything at them</li>
              <li>The right to break the seal and withdraw</li>
              <li>
                Observed now:{" "}
                {observations
                  ? observations
                      .filter((o) => o.confirmed !== "0")
                      .map((o) => `${formatAmount(o.chain, o.confirmed)} ${CHAIN_META[o.chain].unit}`)
                      .join(" · ") || "nothing confirmed yet"
                  : "checking…"}{" "}
                <span className="text-fg-3">({formatUsd(observedUsd(observations))} est.)</span>
              </li>
            </ReviewBlock>

            <ReviewBlock title="Not changing" tone="neutral">
              <li>No coins move on Bitcoin, Base or Solana</li>
              <li>The addresses stay exactly the same</li>
              <li>The vault&apos;s history stays public</li>
            </ReviewBlock>

            <div className="overflow-hidden rounded-[14px] border border-line bg-bg">
              <div className="flex items-center justify-between border-b border-line px-3.5 py-3">
                <span className="inline-flex items-center gap-2 text-[13.5px] font-medium">
                  <ShieldCheck className="size-4 text-ok" aria-hidden />
                  Seal check
                </span>
                <span className="inline-flex h-[22px] items-center rounded-full border border-ok/30 bg-ok/10 px-2 text-[12px] font-medium text-ok">
                  {isSealed(vault) ? "Passed" : "Not passed"}
                </span>
              </div>
              <ul className="py-1.5 text-[13.5px] text-fg-2">
                {[
                  ["Sealed", isSealed(vault)],
                  ["0 signatures ever requested", vault.signatures_requested === 0],
                  [locked === null ? "Contract locked (checking…)" : "Contract locked", locked === true],
                ].map(([label, ok]) => (
                  <li key={String(label)} className="flex items-center gap-2.5 px-3.5 py-1.5">
                    {ok ? <Check className="size-3.5 text-ok" strokeWidth={3} aria-label="Passed" /> : <X className="size-3.5 text-danger" strokeWidth={3} aria-label="Not passed" />}
                    {label}
                  </li>
                ))}
              </ul>
            </div>

            <ReviewBlock title="After this, you can't" tone="danger">
              <li>Break the seal or withdraw</li>
              <li>Take it back. Only {receiver} can transfer it on</li>
            </ReviewBlock>

            <p className="rounded-control border border-line bg-surface px-3.5 py-3 text-[13px] leading-relaxed text-fg-2">
              Selling it? A transfer doesn&apos;t collect payment, so get paid first.{" "}
              {MARKET_CONTRACT ? (
                <>
                  Or{" "}
                  <Link href="/market" className="text-accent hover:underline">
                    list it on the market
                  </Link>
                  , which holds the vault and hands it over only when the exact price is paid.
                </>
              ) : null}
            </p>

            <div className="flex flex-col gap-2.5">
              <Button
                variant="primary"
                size="lg"
                disabled={transfer.isPending}
                onClick={() =>
                  transfer.mutate(
                    { id: vault.token_id, receiver, signer },
                    {
                      onSuccess: (v) => {
                        setDone(v);
                        setStep("done");
                      },
                      onError: (e) => toast.error(errorCopy(e)),
                    },
                  )
                }
              >
                {transfer.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                {transfer.isPending ? "Confirm in your wallet…" : `Transfer to ${receiver}`}
              </Button>
              <Button variant="ghost" onClick={() => setStep("recipient")} disabled={transfer.isPending}>
                <ArrowLeft className="size-4" />
                Change recipient
              </Button>
            </div>
            <p className="text-center text-[12.5px] text-fg-3">One NEAR transaction. Nothing moves on the other chains.</p>
          </div>
        ) : null}

        {step === "done" && done ? (
          <div className="flex flex-col items-center pt-2 text-center" aria-live="polite">
            <div className="w-[260px] animate-card-flip">
              <VaultCard vault={done} flippable={false} />
            </div>
            <p className="mt-7 text-[20px] font-semibold tracking-[-0.02em]">Transferred to {receiver}</p>
            <p className="mt-2 max-w-[320px] text-[14.5px] leading-relaxed text-fg-2">
              Nothing moved on Bitcoin, Base or Solana. The vault and everything inside it belong to {receiver} now.
            </p>
            <div className="mt-7 flex w-full flex-col gap-2.5">
              <Link href="/vaults" className={buttonVariants({ variant: "primary", size: "lg" })}>
                Back to my vaults
              </Link>
              <Button size="lg" onClick={() => close(false)}>
                View the vault
              </Button>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function RecipientStep({ signer, initial, onNext }: { signer: string; initial: string; onNext: (r: string) => void }) {
  const id = useId();
  const [value, setValue] = useState(initial);
  const [touched, setTouched] = useState(false);
  const r = value.trim().toLowerCase();
  const formatError = validateNearAccount(r);
  const debounced = useDebounced(r, 400);
  const checkable = !formatError && debounced === r && r !== signer;
  const exists = useAccountExists(checkable ? r : null);

  const msg = !touched || !r
    ? { tone: "muted" as const, text: "A NEAR testnet account, like bob.testnet." }
    : formatError
      ? { tone: "error" as const, text: formatError }
      : r === signer
        ? { tone: "error" as const, text: "That's you. Enter someone else's account." }
        : exists.isFetching || debounced !== r
          ? { tone: "muted" as const, text: "Checking account…" }
          : exists.data === false
            ? { tone: "error" as const, text: `${r} doesn't exist on NEAR testnet.` }
            : exists.data
              ? { tone: "ok" as const, text: "Account found on NEAR testnet." }
              : { tone: "muted" as const, text: "" };
  const ok = msg.tone === "ok";

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (ok) onNext(r);
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <div>
        <Label htmlFor={id}>Recipient</Label>
        <div className="relative mt-2">
          <Input
            id={id}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setTouched(true);
            }}
            placeholder="name.testnet"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={msg.tone === "error" ? true : undefined}
            aria-describedby={`${id}-msg`}
            className={cn("bg-bg pr-11 font-mono", ok && "border-ok/50")}
          />
          <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2">
            {exists.isFetching ? <Loader2 className="size-4 animate-spin text-fg-3" aria-hidden /> : null}
            {ok ? <Check className="size-[18px] text-ok" strokeWidth={2.5} aria-hidden /> : null}
          </span>
        </div>
        <FieldMessage id={`${id}-msg`} tone={msg.tone} aria-live="polite">
          {msg.text}
        </FieldMessage>
      </div>
      <Button type="submit" variant="primary" size="lg" disabled={!ok}>
        Review transfer
      </Button>
    </form>
  );
}

export function ReviewBlock({ title, tone, children }: { title: string; tone: "gold" | "neutral" | "danger"; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-[14px] border px-4 py-3.5",
        tone === "gold" && "border-gold/35 bg-gold/[0.06]",
        tone === "neutral" && "border-line bg-bg",
        tone === "danger" && "border-danger/25 bg-danger/[0.05]",
      )}
    >
      <p className="text-[12px] font-medium uppercase tracking-[0.12em] text-fg-3">{title}</p>
      <ul className="mt-2 flex flex-col gap-1.5 text-[13.5px] leading-relaxed [&>li]:flex [&>li]:gap-2 [&>li]:before:mt-[9px] [&>li]:before:size-1 [&>li]:before:shrink-0 [&>li]:before:rounded-full [&>li]:before:bg-current [&>li]:before:opacity-50 [&>li]:before:content-['']">
        {children}
      </ul>
    </div>
  );
}

