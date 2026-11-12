"use client";

import type { VaultView } from "@bearer/sdk";
import { ArrowLeft, Hourglass, Loader2 } from "lucide-react";
import { useEffect, useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { formatWhen } from "@/components/schedule/when";
import { Button } from "@/components/ui/button";
import { FieldMessage, Input, Label } from "@/components/ui/primitives";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ReviewBlock } from "@/components/vault/transfer-sheet";
import { VaultCard } from "@/components/vault/vault-card";
import { SWITCH_CONTRACT } from "@/lib/config";
import { cn } from "@/lib/utils";
import { errorCopy } from "@/lib/vault/errors";
import { formatNear, vaultNumber } from "@/lib/vault/format";
import { useAccountExists, useArmSwitch, useSwitchConfig } from "@/lib/vault/hooks";
import { validateNearAccount } from "@/lib/validation";
import { dueMs, INTERVALS, intervalText, SwitchLock } from "./switch-bits";

type Step = "form" | "review" | "done";
export type SwitchPlan = { beneficiary: string; intervalMs: number };

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Put a sealed vault in a dead man's switch: who gets it, and how long a silence hands it over. */
export function SwitchSheet({
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
  const [plan, setPlan] = useState<SwitchPlan | null>(null);
  // When the first check-in is due, read from the armed switch for the done screen.
  const [firstDue, setFirstDue] = useState<number | null>(null);
  const arm = useArmSwitch();
  const config = useSwitchConfig();
  const deposit = config.data ? formatNear(config.data.switch_deposit) : "a small";

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
        title={step === "done" ? "Switch set" : step === "review" ? "Review the switch" : "If you go quiet"}
        description={
          step === "form"
            ? "Name who gets this vault if you stop checking in. While you check in, nothing happens, and you can change your mind any time."
            : undefined
        }
      >
        {step === "form" ? (
          <SwitchForm
            signer={signer}
            initial={plan}
            submitLabel="Review the switch"
            onNext={(p) => {
              setPlan(p);
              setStep("review");
            }}
          />
        ) : null}

        {step === "review" && plan ? (
          <div className="flex flex-col gap-5">
            <p className="text-[15px]">
              If you don&apos;t check in for <span className="font-semibold">{intervalText(plan.intervalMs)}</span>, vault{" "}
              <span className="font-mono">{vaultNumber(vault.token_id)}</span> goes to{" "}
              <span className="font-mono font-semibold">{plan.beneficiary}</span>.
            </p>

            <ReviewBlock title="While you check in" tone="neutral">
              <li>The switch contract ({SWITCH_CONTRACT}) holds the vault. It stays sealed</li>
              <li>One tap, &ldquo;I&apos;m still here&rdquo;, restarts the clock. Changing who or how long counts too</li>
              <li>You can take it back at any time, with your {deposit} deposit</li>
              <li>Anyone can keep adding coins to its addresses, so you can keep saving into it</li>
            </ReviewBlock>

            <ReviewBlock title={`After ${intervalText(plan.intervalMs)} without a check-in`} tone="gold">
              <li>Anyone can hand it over, and it can only go to {plan.beneficiary}</li>
              <li>It arrives sealed, with everything at its addresses. Only {plan.beneficiary} can open it</li>
              <li>Until someone hands it over, a late check-in still counts</li>
            </ReviewBlock>

            <ReviewBlock title="Worth knowing" tone="danger">
              <li>Nobody can withdraw from it while it&apos;s in the switch, you included. Take it back first</li>
              <li>If {plan.beneficiary} doesn&apos;t exist on NEAR when it&apos;s due, it stays in the switch until you name someone who does</li>
              <li>Who you named and when you last checked in are public on NEAR</li>
            </ReviewBlock>

            <div className="rounded-[14px] border border-line bg-bg px-3.5 py-3">
              <SwitchLock />
            </div>

            <div className="flex flex-col gap-2.5">
              <Button
                variant="primary"
                size="lg"
                disabled={arm.isPending}
                onClick={() =>
                  arm.mutate(
                    { id: vault.token_id, beneficiary: plan.beneficiary, intervalMs: plan.intervalMs, signer },
                    {
                      onSuccess: (s) => {
                        setFirstDue(dueMs(s));
                        setStep("done");
                      },
                      onError: (e) => toast.error(errorCopy(e)),
                    },
                  )
                }
              >
                {arm.isPending ? <Loader2 className="size-4 animate-spin" /> : <Hourglass className="size-4" />}
                {arm.isPending ? "Confirm in your wallet…" : "Set the switch"}
              </Button>
              <Button variant="ghost" onClick={() => setStep("form")} disabled={arm.isPending}>
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
            <p className="mt-7 text-[20px] font-semibold tracking-[-0.02em]">Set for {plan.beneficiary}</p>
            <p className="mt-2 max-w-[320px] text-[14.5px] leading-relaxed text-fg-2">
              {firstDue ? `Check in before ${formatWhen(firstDue)} and nothing happens. ` : ""}Each check-in restarts the{" "}
              {intervalText(plan.intervalMs)} clock.
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

/** Who gets the vault and how long a silence hands it over; also used to change a switch. */
export function SwitchForm({
  signer,
  initial,
  submitLabel,
  pending = false,
  onNext,
}: {
  signer: string;
  initial: SwitchPlan | null;
  submitLabel: string;
  pending?: boolean;
  onNext: (p: SwitchPlan) => void;
}) {
  const id = useId();
  const [beneficiary, setBeneficiary] = useState(initial?.beneficiary ?? "");
  const [interval, setIntervalMs] = useState(initial?.intervalMs ?? INTERVALS[3]);
  const [touched, setTouched] = useState(false);

  const b = beneficiary.trim().toLowerCase();
  const formatError = validateNearAccount(b);
  const debounced = useDebounced(b, 400);
  const exists = useAccountExists(!formatError && debounced === b && b !== signer ? b : null);
  const choices = INTERVALS.includes(interval) ? INTERVALS : [...INTERVALS, interval].sort((x, y) => x - y);

  const msg = !b
    ? { tone: "muted" as const, text: "A NEAR testnet account: your child's, a partner's, a friend's." }
    : formatError
      ? { tone: "error" as const, text: formatError }
      : b === signer
        ? { tone: "error" as const, text: "That's you. Name who gets it if you go quiet." }
        : exists.isFetching || debounced !== b
          ? { tone: "muted" as const, text: "Checking account…" }
          : exists.data === false
            ? { tone: "error" as const, text: `${b} doesn't exist on NEAR yet. The vault can't go to them until it does.` }
            : { tone: "ok" as const, text: "Account found on NEAR testnet." };
  const ok = !formatError && b !== signer && exists.data !== false;

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (ok) onNext({ beneficiary: b, intervalMs: interval });
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <div>
        <Label htmlFor={`${id}-to`}>It goes to</Label>
        <Input
          id={`${id}-to`}
          className={cn("mt-2 bg-bg font-mono", msg.tone === "ok" && "border-ok/50")}
          value={beneficiary}
          onChange={(e) => setBeneficiary(e.target.value)}
          placeholder="name.testnet"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-describedby={`${id}-to-msg`}
        />
        <FieldMessage id={`${id}-to-msg`} tone={touched || b ? msg.tone : "muted"} aria-live="polite">
          {msg.text}
        </FieldMessage>
      </div>

      <fieldset>
        <legend className="text-[13.5px] font-medium">If I don&apos;t check in for</legend>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {choices.map((ms) => (
            <label
              key={ms}
              className={cn(
                "inline-flex h-8 cursor-pointer items-center rounded-full border px-3 text-[13px] transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent",
                interval === ms ? "border-gold/60 bg-gold/[0.08] text-fg" : "border-line text-fg-2 hover:border-line-strong hover:text-fg",
              )}
            >
              <input type="radio" name={`${id}-interval`} className="sr-only" checked={interval === ms} onChange={() => setIntervalMs(ms)} />
              {intervalText(ms)}
            </label>
          ))}
        </div>
        <FieldMessage tone="muted">
          {interval < 3600_000
            ? "Short, so you can try the whole thing in one sitting."
            : "Each check-in restarts this clock. Pick something you'll comfortably beat."}
        </FieldMessage>
      </fieldset>

      <Button type="submit" variant="primary" size="lg" disabled={pending || (touched && !ok)}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {submitLabel}
      </Button>
    </form>
  );
}
