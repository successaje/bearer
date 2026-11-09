"use client";

import type { HandoverSchedule } from "@bearer/sdk";
import { Gift, Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SCHEDULE_CONTRACT } from "@/lib/config";
import { errorCopy } from "@/lib/vault/errors";
import { useCancelHandover, useReleaseHandover } from "@/lib/vault/hooks";
import { formatWhen, nsToMsNumber, untilText } from "./when";

/** On a scheduled vault's page: who it's for, when, and Hand over (anyone, once due) or Cancel. */
export function SchedulePanel({
  schedule,
  viewer,
  now,
  onConnect,
}: {
  schedule: HandoverSchedule;
  /** The connected account, or null. */
  viewer: string | null;
  now: number;
  onConnect: () => void;
}) {
  const release = useReleaseHandover();
  const cancel = useCancelHandover();
  const at = nsToMsNumber(schedule.release_at_ns);
  const due = now >= at;
  const settling = schedule.state.kind !== "waiting";
  const isGiver = viewer === schedule.giver;
  const isRecipient = viewer === schedule.recipient;
  const canCancel = isGiver && schedule.cancellable && !due;

  return (
    <div className="mt-7 rounded-panel border border-gold/35 bg-gold/[0.05] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-mono text-[11.5px] font-medium uppercase tracking-[0.16em] text-accent">Scheduled handover</p>
        <p className="text-[13px] text-fg-3">
          From <span className="font-mono text-fg-2">{schedule.giver}</span>
        </p>
      </div>
      <p className="mt-2 text-[24px] font-semibold leading-tight tracking-[-0.025em]">
        {isRecipient ? "For you" : <>For <span className="font-mono text-[21px]">{schedule.recipient}</span></>}
      </p>
      <p className="tabular mt-1.5 text-[14.5px] text-fg-2">
        {due ? "Ready to hand over since " : "On or after "}
        <span className="font-medium text-fg">{formatWhen(at)}</span>
        {now && !due ? <span className="text-fg-3"> · {untilText(at, now)}</span> : null}
      </p>
      <p className="mt-3 text-[13.5px] leading-relaxed text-fg-2">
        Held by the schedule contract (<span className="font-mono">{SCHEDULE_CONTRACT}</span>), still sealed: nobody can withdraw
        until it&apos;s handed over, {schedule.giver} included.{" "}
        {schedule.cancellable ? `${schedule.giver} can cancel until the date.` : "Nobody can cancel it."}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        {settling ? (
          <span className="inline-flex items-center gap-2 text-[14px] text-fg-2" aria-live="polite">
            <Loader2 className="size-4 animate-spin" />
            {schedule.state.kind === "releasing" ? `Handing over to ${schedule.recipient}…` : `Going back to ${schedule.giver}…`}
          </span>
        ) : due ? (
          viewer ? (
            <Button
              variant="primary"
              disabled={release.isPending}
              onClick={() =>
                release.mutate(
                  { id: schedule.token_id, signer: viewer },
                  { onSuccess: () => toast.success(`Handed over to ${schedule.recipient}.`), onError: (e) => toast.error(errorCopy(e)) },
                )
              }
            >
              {release.isPending ? <Loader2 className="size-4 animate-spin" /> : <Gift className="size-4" />}
              {release.isPending ? "Confirm in your wallet…" : `Hand it over to ${isRecipient ? "me" : schedule.recipient}`}
            </Button>
          ) : (
            <Button variant="primary" onClick={onConnect}>
              Connect a wallet to hand it over
            </Button>
          )
        ) : canCancel ? (
          <Button
            disabled={cancel.isPending}
            onClick={() =>
              cancel.mutate(
                { id: schedule.token_id, signer: schedule.giver },
                { onSuccess: () => toast.success("Cancelled. The vault and your deposit are back with you."), onError: (e) => toast.error(errorCopy(e)) },
              )
            }
          >
            {cancel.isPending ? <Loader2 className="size-4 animate-spin" /> : <Undo2 className="size-4" />}
            {cancel.isPending ? "Confirm in your wallet…" : "Cancel and take it back"}
          </Button>
        ) : (
          <p className="text-[13px] text-fg-3">Anyone can hand it over once the date arrives.</p>
        )}
      </div>
    </div>
  );
}
