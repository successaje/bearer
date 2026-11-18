"use client";

import type { ChainObservation, StandingPlan, Withdrawal } from "@bearer/sdk";
import { standing } from "@bearer/sdk";
import { ArrowUpRight, HandCoins, Loader2, Pause, Undo2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { formatWhen, untilText } from "@/components/schedule/when";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { WithdrawForm } from "@/components/vault/withdraw-form";
import { WithdrawalTracker } from "@/components/vault/withdrawal-tracker";
import { STANDING_CONTRACT } from "@/lib/config";
import { cn } from "@/lib/utils";
import { standingErrorCopy } from "@/lib/vault/errors";
import { CHAIN_META, truncateMiddle } from "@/lib/vault/format";
import { useCollectPayment, useStopPayments, useTakeBackPlanned, useWithdrawThroughPlan } from "@/lib/vault/hooks";
import { coins, periodMs, periodText, StandingLock } from "./standing-bits";

/**
 * On a vault that pays someone regularly: how much, to whom, how far along, and what the viewer
 * can do. The payee collects each payment as it falls due. The giver stops it (if they kept that
 * right), takes a still-sealed vault back, or withdraws through the plan once it's opened.
 */
export function StandingPanel({
  plan,
  observations,
  viewer,
  now,
  onConnect,
}: {
  plan: StandingPlan;
  observations: ChainObservation[] | undefined;
  /** The connected account, or null. */
  viewer: string | null;
  now: number;
  onConnect: () => void;
}) {
  const collect = useCollectPayment();
  const stop = useStopPayments();
  const takeBack = useTakeBackPlanned();
  const [paid, setPaid] = useState<Withdrawal | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);

  const isGiver = viewer === plan.giver;
  const isPayee = viewer === plan.payee;
  const giver = isGiver ? "you" : plan.giver;
  const payee = isPayee ? "you" : plan.payee;
  const each = coins(plan.chain, plan.amount);
  const span = periodMs(plan);
  const ended = standing.ended(plan, now);
  const owed = standing.owed(plan, now);
  const next = standing.nextDueMs(plan, now);
  const endsAt = standing.endsAtMs(plan);
  const free = standing.giverFree(plan, now);
  const busy = plan.state.kind !== "waiting";
  const pending = collect.isPending || stop.isPending || takeBack.isPending;
  const progress = plan.max_payments ? plan.payments / plan.max_payments : null;
  const meta = CHAIN_META[plan.chain];

  const headline = ended
    ? plan.stopped_at_ns
      ? `Stopped after ${plural(plan.payments, "payment")}`
      : plan.max_payments !== null && plan.payments >= plan.max_payments
        ? `Paid in full: ${plural(plan.payments, "payment")}`
        : `Over: ${plural(plan.payments, "payment")} collected`
    : owed > 0
      ? `${plural(owed, "payment")} of ${each} due to ${payee}`
      : `Pays ${payee} ${each} every ${periodText(span)}`;

  return (
    <div className="rounded-panel border-gold/35 bg-gold/[0.05] mt-7 border p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-accent font-mono text-[11.5px] font-medium tracking-[0.16em] uppercase">
          {ended ? "Payments ended" : "Standing payments"}
        </p>
        <p className="text-fg-3 text-[13px]">
          Set by <span className="text-fg-2 font-mono">{giver}</span> · to{" "}
          <span className="text-fg-2 font-mono">{payee}</span>
        </p>
      </div>
      <p className="mt-2 text-[22px] leading-tight font-semibold tracking-[-0.02em]">{headline}</p>

      <div className="mt-4">
        {progress !== null ? (
          <div className="bg-raised h-2 overflow-hidden rounded-full" aria-hidden>
            <div
              className="bg-accent h-full rounded-full transition-[width] duration-700"
              style={{ width: `${Math.min(1, progress) * 100}%` }}
            />
          </div>
        ) : null}
        <p className="tabular text-fg-2 mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-[13px]">
          <span>
            <span className="text-fg">{plan.payments}</span>
            {plan.max_payments !== null ? ` of ${plan.max_payments}` : ""} paid · {each} each, every {periodText(span)}
          </span>
          <span>
            {ended || next === null ? (
              plan.stopped_at_ns ? (
                <>Stopped {formatWhen(Number(BigInt(plan.stopped_at_ns) / 1_000_000n))}</>
              ) : (
                <>Ended</>
              )
            ) : owed > 0 ? (
              <>
                Due since <span className="text-fg">{formatWhen(next)}</span>
              </>
            ) : (
              <>
                Next <span className="text-fg">{formatWhen(next)}</span>
                <span className="text-fg-3"> · {untilText(next, now)}</span>
              </>
            )}
          </span>
        </p>
      </div>

      <p className="text-fg-2 mt-3 text-[13.5px] leading-relaxed">
        Held by the standing-payments contract (<span className="font-mono">{STANDING_CONTRACT}</span>). Each payment
        goes only to{" "}
        <span className="font-mono" title={plan.to}>
          {truncateMiddle(plan.to, 10, 6)}
        </span>{" "}
        on {meta.name}, exactly {each}
        {plan.chain === "sol"
          ? ", with Solana's fixed fee"
          : `, with a network fee of at most ${coins(plan.chain, plan.max_fee)}`}
        .{" "}
        {plan.opened
          ? `The first payment broke the seal, so the vault stays with the contract for good; ${isGiver ? "you act" : `${plan.giver} acts`} through it.`
          : `Still sealed: the first payment will break the seal, and from then on the vault stays with the contract.`}{" "}
        {ended
          ? `Nothing more falls due; ${isGiver ? "you" : plan.giver} can withdraw what's left through the contract.`
          : plan.cancellable
            ? `${isGiver ? "You" : plan.giver} can stop the payments at any time.`
            : endsAt
              ? `Nobody can stop the payments, ${giver} included, until ${formatWhen(endsAt)}.`
              : "Nobody can stop the payments."}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        {busy ? (
          <span className="text-fg-2 inline-flex items-center gap-2 text-[14px]" aria-live="polite">
            <Loader2 className="size-4 animate-spin" />
            {plan.state.kind === "returning"
              ? `Going back to ${plan.giver}…`
              : plan.state.kind === "unsettled"
                ? "Waiting to read Bearer's answer…"
                : "Bearer is signing…"}
          </span>
        ) : !viewer ? (
          <Button variant={owed > 0 ? "primary" : "secondary"} onClick={onConnect}>
            {owed > 0 ? `Are you ${plan.payee}? Connect to collect` : `Are you ${plan.giver} or ${plan.payee}? Connect`}
          </Button>
        ) : (
          <>
            {isPayee && owed > 0 ? (
              <Button
                variant="primary"
                disabled={pending}
                onClick={() =>
                  collect.mutate(
                    { id: plan.token_id, signer: viewer },
                    {
                      onSuccess: (w) => {
                        if (w.status === "failed")
                          toast.error(
                            `Bearer couldn't sign it: ${w.error ?? "the signer failed"}. Nothing counted; try again.`,
                          );
                        else setPaid(w);
                      },
                      onError: (e) => toast.error(standingErrorCopy(e)),
                    },
                  )
                }
              >
                {collect.isPending ? <Loader2 className="size-4 animate-spin" /> : <HandCoins className="size-4" />}
                {collect.isPending ? "Confirm, then signing…" : `Collect ${each}`}
              </Button>
            ) : null}
            {isGiver && plan.cancellable && !ended ? (
              <Button
                disabled={pending}
                onClick={() =>
                  stop.mutate(
                    { id: plan.token_id, signer: viewer },
                    {
                      onSuccess: () => toast.success("Stopped. Nothing more falls due."),
                      onError: (e) => toast.error(standingErrorCopy(e)),
                    },
                  )
                }
              >
                {stop.isPending ? <Loader2 className="size-4 animate-spin" /> : <Pause className="size-4" />}
                {stop.isPending ? "Confirm in your wallet…" : "Stop the payments"}
              </Button>
            ) : null}
            {isGiver && !plan.opened && free ? (
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  takeBack.mutate(
                    { id: plan.token_id, signer: viewer },
                    {
                      onSuccess: () => toast.success("Taken back, still sealed, with your deposit."),
                      onError: (e) => toast.error(standingErrorCopy(e)),
                    },
                  )
                }
              >
                {takeBack.isPending ? <Loader2 className="size-4 animate-spin" /> : <Undo2 className="size-4" />}
                {takeBack.isPending ? "Confirm, then settling…" : "Take it back"}
              </Button>
            ) : null}
            {isGiver && plan.opened && free ? (
              <Button disabled={pending || !observations} onClick={() => setWithdrawing(true)}>
                <ArrowUpRight className="size-4" />
                Withdraw
              </Button>
            ) : null}
            <p
              className={cn(
                "text-fg-3 text-[13px]",
                (isPayee && owed > 0) || (isGiver && (free || (plan.cancellable && !ended))) ? "basis-full" : "",
              )}
            >
              {waitText(plan, viewer, now)}
            </p>
          </>
        )}
      </div>
      <div className="border-gold/20 mt-4 border-t pt-3.5">
        <StandingLock compact />
      </div>

      <Sheet open={!!paid} onOpenChange={(o) => !o && setPaid(null)}>
        <SheetContent
          title="Payment collected"
          description={`Bearer signed exactly ${each} to ${truncateMiddle(plan.to, 10, 6)}. It goes out on ${meta.name} next.`}
        >
          {paid ? (
            <div className="flex flex-col gap-6">
              <WithdrawalTracker tokenId={plan.token_id} withdrawal={paid} />
              <Button variant="primary" size="lg" onClick={() => setPaid(null)}>
                Done
              </Button>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      {isGiver && viewer && observations ? (
        <GiverWithdrawSheet
          plan={plan}
          observations={observations}
          signer={viewer}
          open={withdrawing}
          onOpenChange={setWithdrawing}
        />
      ) : null}
    </div>
  );
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** What the viewer is waiting for, in a sentence. */
function waitText(plan: StandingPlan, viewer: string, now: number) {
  const next = standing.nextDueMs(plan, now);
  const endsAt = standing.endsAtMs(plan);
  if (viewer === plan.payee) {
    if (standing.ended(plan, now)) return "These payments have ended.";
    if (standing.owed(plan, now) > 0)
      return "Collecting asks Bearer to sign the payment; it goes out on its chain straight after.";
    return next ? `The next one is yours to collect from ${formatWhen(next)}.` : "";
  }
  if (viewer === plan.giver) {
    if (!plan.opened && standing.giverFree(plan, now))
      return "Until the first payment, you can take the vault back, still sealed.";
    if (plan.opened && standing.giverFree(plan, now))
      return "Withdrawing goes through the plan: the vault itself never leaves the contract.";
    return endsAt
      ? `You agreed nobody can stop these payments. From ${formatWhen(endsAt)} you can withdraw what's left.`
      : "";
  }
  return `Only ${plan.payee} can collect, and only ${plan.giver} can stop it or withdraw.`;
}

/** The giver withdraws through the plan: the same form as an owner's withdrawal. */
function GiverWithdrawSheet({
  plan,
  observations,
  signer,
  open,
  onOpenChange,
}: {
  plan: StandingPlan;
  observations: ChainObservation[];
  signer: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [withdrawal, setWithdrawal] = useState<Withdrawal | null>(null);
  const withdraw = useWithdrawThroughPlan();
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setWithdrawal(null);
      }}
    >
      <SheetContent
        title={withdrawal ? "Withdrawing" : "Withdraw through the plan"}
        description={
          withdrawal
            ? undefined
            : "The standing-payments contract holds the vault, so it asks Bearer for you. Only you can."
        }
      >
        {withdrawal ? (
          <div className="flex flex-col gap-6">
            <WithdrawalTracker tokenId={plan.token_id} withdrawal={withdrawal} />
            <Button variant="primary" size="lg" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </div>
        ) : (
          <WithdrawForm
            observations={observations}
            busy={withdraw.isPending}
            submitLabel={(s) =>
              withdraw.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Confirm in your wallet…
                </>
              ) : (
                <>
                  <ArrowUpRight className="size-4" />
                  {s ? `Withdraw ${s}` : "Withdraw"}
                </>
              )
            }
            onSubmit={(request) =>
              withdraw.mutate(
                { id: plan.token_id, request, signer },
                { onSuccess: setWithdrawal, onError: (e) => toast.error(standingErrorCopy(e)) },
              )
            }
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
