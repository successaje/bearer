"use client";

import type { VaultView } from "@bearer/sdk";
import { ArrowLeft, CalendarClock, Check, Loader2 } from "lucide-react";
import { useEffect, useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FieldMessage, Input, Label } from "@/components/ui/primitives";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ReviewBlock } from "@/components/vault/transfer-sheet";
import { VaultCard } from "@/components/vault/vault-card";
import { SCHEDULE_CONTRACT } from "@/lib/config";
import { errorCopy } from "@/lib/vault/errors";
import { vaultNumber } from "@/lib/vault/format";
import { useAccountExists, useNow, useScheduleHandover } from "@/lib/vault/hooks";
import { validateNearAccount } from "@/lib/validation";
import { cn } from "@/lib/utils";
import { formatWhen } from "./when";

type Step = "form" | "review" | "done";

const DAY = 24 * 3600 * 1000;
const PRESETS: [string, number][] = [
  ["In an hour", 3600 * 1000],
  ["In a week", 7 * DAY],
  ["In a month", 30 * DAY],
  ["In a year", 365 * DAY],
];

/** `datetime-local` wants local time without a zone: 2027-05-12T09:00. */
function toLocalInput(ms: number) {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Schedule a sealed vault to be handed to someone on or after a date. */
export function ScheduleSheet({
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
  const [plan, setPlan] = useState<{ recipient: string; at: number; cancellable: boolean } | null>(null);
  const schedule = useScheduleHandover();

  function close(o: boolean) {
    onOpenChange(o);
    if (!o) {
      setStep("form");
      setPlan(null);
    }
  }

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent
        title={step === "done" ? "Scheduled" : step === "review" ? "Review the handover" : "Schedule a handover"}
        description={step === "form" ? "Choose who receives this vault, and when. Until then it stays sealed and nobody can withdraw, you included." : undefined}
      >
        {step === "form" ? (
          <FormStep
            signer={signer}
            initial={plan}
            onNext={(p) => {
              setPlan(p);
              setStep("review");
            }}
          />
        ) : null}

        {step === "review" && plan ? (
          <div className="flex flex-col gap-5">
            <p className="text-[15px]">
              Hand vault <span className="font-mono">{vaultNumber(vault.token_id)}</span> to{" "}
              <span className="font-mono font-semibold">{plan.recipient}</span> on or after{" "}
              <span className="font-semibold">{formatWhen(plan.at)}</span>?
            </p>

            <ReviewBlock title="Until then" tone="neutral">
              <li>The schedule contract ({SCHEDULE_CONTRACT}) holds it. It stays sealed</li>
              <li>Nobody can break the seal or withdraw, you included</li>
              <li>Anyone can still send coins to its addresses, so you can keep adding to it</li>
            </ReviewBlock>

            <ReviewBlock title="On the date" tone="gold">
              <li>Anyone can hand it over: {plan.recipient}, you, or anyone else. It can only go to {plan.recipient}</li>
              <li>It arrives sealed, and only {plan.recipient} can open it</li>
              <li>If {plan.recipient} doesn&apos;t exist on NEAR yet, it waits until they do, so nobody else can take the name</li>
            </ReviewBlock>

            <ReviewBlock title={plan.cancellable ? "You can cancel" : "Nobody can cancel"} tone={plan.cancellable ? "neutral" : "danger"}>
              {plan.cancellable ? (
                <li>Until the date you can take it back. After that it can only go to {plan.recipient}</li>
              ) : (
                <li>Not you, not anyone. On the date it goes to {plan.recipient}, whatever happens</li>
              )}
              <li>A 0.01 NEAR deposit pays for the schedule; you get it back when it&apos;s handed over or cancelled</li>
            </ReviewBlock>

            <div className="flex flex-col gap-2.5">
              <Button
                variant="primary"
                size="lg"
                disabled={schedule.isPending}
                onClick={() =>
                  schedule.mutate(
                    { id: vault.token_id, recipient: plan.recipient, releaseAtMs: plan.at, cancellable: plan.cancellable, signer },
                    { onSuccess: () => setStep("done"), onError: (e) => toast.error(errorCopy(e)) },
                  )
                }
              >
                {schedule.isPending ? <Loader2 className="size-4 animate-spin" /> : <CalendarClock className="size-4" />}
                {schedule.isPending ? "Confirm in your wallet…" : "Schedule the handover"}
              </Button>
              <Button variant="ghost" onClick={() => setStep("form")} disabled={schedule.isPending}>
                <ArrowLeft className="size-4" />
                Change it
              </Button>
            </div>
          </div>
        ) : null}

        {step === "done" && plan ? (
          <div className="flex flex-col items-center pt-2 text-center" aria-live="polite">
            <div className="w-[260px] animate-card-flip">
              <VaultCard vault={vault} flippable={false} />
            </div>
            <p className="mt-7 text-[20px] font-semibold tracking-[-0.02em]">Scheduled for {plan.recipient}</p>
            <p className="mt-2 max-w-[320px] text-[14.5px] leading-relaxed text-fg-2">
              It can be handed over on or after {formatWhen(plan.at)}. Until then it stays sealed.
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

function FormStep({
  signer,
  initial,
  onNext,
}: {
  signer: string;
  initial: { recipient: string; at: number; cancellable: boolean } | null;
  onNext: (p: { recipient: string; at: number; cancellable: boolean }) => void;
}) {
  const id = useId();
  const [recipient, setRecipient] = useState(initial?.recipient ?? "");
  const [when, setWhen] = useState(initial ? toLocalInput(initial.at) : "");
  const [cancellable, setCancellable] = useState(initial?.cancellable ?? true);
  const [touched, setTouched] = useState(false);

  const r = recipient.trim().toLowerCase();
  const formatError = validateNearAccount(r);
  const debounced = useDebounced(r, 400);
  const exists = useAccountExists(!formatError && debounced === r && r !== signer ? r : null);
  const at = when ? new Date(when).getTime() : NaN;
  const now = useNow(15_000);

  const recipientMsg = !r
    ? { tone: "muted" as const, text: "A NEAR testnet account, like theo.testnet." }
    : formatError
      ? { tone: "error" as const, text: formatError }
      : r === signer
        ? { tone: "error" as const, text: "That's you. Choose who receives it." }
        : exists.isFetching || debounced !== r
          ? { tone: "muted" as const, text: "Checking account…" }
          : exists.data === false
            ? { tone: "muted" as const, text: `${r} doesn't exist yet. That's fine: the vault waits for it on the date.` }
            : { tone: "ok" as const, text: "Account found on NEAR testnet." };
  const dateError = !when ? "Pick a date and time." : Number.isNaN(at) ? "That isn't a date." : now && at < now + 2 * 60_000 ? "Pick a time at least two minutes from now." : null;
  const ok = !formatError && r !== signer && !dateError;

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (ok) onNext({ recipient: r, at, cancellable });
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <div>
        <Label htmlFor={`${id}-to`}>Hand it to</Label>
        <Input
          id={`${id}-to`}
          className={cn("mt-2 bg-bg font-mono", recipientMsg.tone === "ok" && "border-ok/50")}
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="name.testnet"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-describedby={`${id}-to-msg`}
        />
        <FieldMessage id={`${id}-to-msg`} tone={touched || r ? recipientMsg.tone : "muted"} aria-live="polite">
          {recipientMsg.text}
        </FieldMessage>
      </div>

      <div>
        <Label htmlFor={`${id}-when`}>On or after</Label>
        <Input id={`${id}-when`} type="datetime-local" className="mt-2 bg-bg" value={when} onChange={(e) => setWhen(e.target.value)} />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {PRESETS.map(([label, ms]) => (
            <button
              key={label}
              type="button"
              onClick={() => setWhen(toLocalInput(Date.now() + ms))}
              className="h-7 rounded-full border border-line px-2.5 text-[12.5px] text-fg-2 transition-colors hover:border-line-strong hover:text-fg"
            >
              {label}
            </button>
          ))}
        </div>
        <FieldMessage tone={touched && dateError ? "error" : "muted"}>
          {touched && dateError ? dateError : "Your local time. It becomes available then; someone still has to hand it over."}
        </FieldMessage>
      </div>

      <fieldset>
        <legend className="text-[13.5px] font-medium">Can it be cancelled?</legend>
        <div className="mt-2 grid gap-2">
          {[
            [true, "I can cancel until the date", "Take it back any time before then."],
            [false, "Nobody can cancel it", "Not even you. On the date it goes to them."],
          ].map(([value, title, sub]) => (
            <label
              key={String(value)}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-[12px] border px-3.5 py-3 transition-colors",
                cancellable === value ? "border-gold/50 bg-gold/[0.06]" : "border-line hover:border-line-strong",
              )}
            >
              <input type="radio" name={`${id}-cancel`} className="sr-only" checked={cancellable === value} onChange={() => setCancellable(value as boolean)} />
              <span className={cn("mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border", cancellable === value ? "border-gold bg-gold text-ink" : "border-line-strong")}>
                {cancellable === value ? <Check className="size-3" strokeWidth={3} aria-hidden /> : null}
              </span>
              <span>
                <span className="block text-[14px] font-medium">{title as string}</span>
                <span className="block text-[12.5px] text-fg-3">{sub as string}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <Button type="submit" variant="primary" size="lg" disabled={touched && !ok}>
        Review the handover
      </Button>
    </form>
  );
}
