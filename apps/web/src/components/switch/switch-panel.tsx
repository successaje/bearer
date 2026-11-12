"use client";

import type { VaultSwitch } from "@bearer/sdk";
import { HeartPulse, Loader2, PencilLine, Send, Undo2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { formatWhen, untilText } from "@/components/schedule/when";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { SWITCH_CONTRACT } from "@/lib/config";
import { cn } from "@/lib/utils";
import { errorCopy } from "@/lib/vault/errors";
import { relativeTime } from "@/lib/vault/format";
import { useCheckIn, useReleaseSwitch, useTakeBackSwitch, useUpdateSwitch } from "@/lib/vault/hooks";
import { dueMs, intervalMs, intervalText, lastCheckInMs, SwitchLock } from "./switch-bits";
import { SwitchForm } from "./switch-sheet";

/**
 * On a vault in a switch: who it goes to, how long the clock has left, and what the viewer can
 * do. The owner checks in, changes who or how long, or takes it back. Once a whole interval has
 * passed without a check-in, anyone can hand it to the beneficiary.
 */
export function SwitchPanel({
  sw,
  viewer,
  now,
  onConnect,
}: {
  sw: VaultSwitch;
  /** The connected account, or null. */
  viewer: string | null;
  now: number;
  onConnect: () => void;
}) {
  const checkIn = useCheckIn();
  const takeBack = useTakeBackSwitch();
  const release = useReleaseSwitch();
  const [editing, setEditing] = useState(false);
  const due = dueMs(sw);
  const last = lastCheckInMs(sw);
  const span = intervalMs(sw);
  const quiet = now >= due;
  const isOwner = viewer === sw.owner;
  const isBeneficiary = viewer === sw.beneficiary;
  const owner = isOwner ? "you" : sw.owner;
  const beneficiary = isBeneficiary ? "you" : sw.beneficiary;
  // How much of the interval is left, for the clock bar.
  const left = Math.max(0, Math.min(1, (due - now) / span));
  const busy = sw.state.kind !== "armed";
  const pending = checkIn.isPending || takeBack.isPending || release.isPending;

  return (
    <div className="mt-7 rounded-panel border border-gold/35 bg-gold/[0.05] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-mono text-[11.5px] font-medium uppercase tracking-[0.16em] text-accent">
          {quiet ? "Gone quiet" : "Dead man's switch"}
        </p>
        <p className="text-[13px] text-fg-3">
          Set by <span className="font-mono text-fg-2">{isOwner ? "you" : sw.owner}</span> · for{" "}
          <span className="font-mono text-fg-2">{isBeneficiary ? "you" : sw.beneficiary}</span>
        </p>
      </div>
      <p className="mt-2 text-[22px] font-semibold leading-tight tracking-[-0.02em]">
        {quiet ? (
          <>
            Ready to go to <span className="font-mono">{beneficiary}</span>
          </>
        ) : (
          <>
            Goes to <span className="font-mono">{beneficiary}</span> after {intervalText(span)} of silence
          </>
        )}
      </p>

      <div className="mt-4">
        <div className="h-2 overflow-hidden rounded-full bg-raised" aria-hidden>
          <div className={cn("h-full rounded-full transition-[width] duration-700", quiet ? "bg-warn" : "bg-accent")} style={{ width: `${left * 100}%` }} />
        </div>
        <p className="tabular mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-[13px] text-fg-2">
          <span>
            Last check-in <span className="text-fg">{relativeTime(last, now)}</span>
          </span>
          <span>
            {quiet ? (
              <>
                Due since <span className="text-fg">{formatWhen(due)}</span>
              </>
            ) : (
              <>
                Due <span className="text-fg">{formatWhen(due)}</span>
                <span className="text-fg-3"> · {untilText(due, now)}</span>
              </>
            )}
          </span>
        </p>
      </div>

      <p className="mt-3 text-[13.5px] leading-relaxed text-fg-2">
        Held by the switch (<span className="font-mono">{SWITCH_CONTRACT}</span>), still sealed: nobody can withdraw while it&apos;s here,{" "}
        {owner} included. {quiet
          ? `${isOwner ? "You haven't" : `${sw.owner} hasn't`} checked in for ${intervalText(span)}, so anyone can hand it to ${beneficiary}. Until someone does, a check-in still counts.`
          : isOwner
            ? "Each check-in restarts your clock."
            : `Each check-in by ${sw.owner} restarts the clock.`}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        {busy ? (
          <span className="inline-flex items-center gap-2 text-[14px] text-fg-2" aria-live="polite">
            <Loader2 className="size-4 animate-spin" />
            {sw.state.kind === "releasing" ? `Going to ${sw.beneficiary}…` : `Going back to ${sw.owner}…`}
          </span>
        ) : !viewer ? (
          <Button variant={quiet ? "primary" : "secondary"} onClick={onConnect}>
            Connect a wallet {quiet ? "to hand it over" : "to check in"}
          </Button>
        ) : isOwner ? (
          <>
            <Button
              variant="primary"
              disabled={pending}
              onClick={() =>
                checkIn.mutate(
                  { id: sw.token_id, signer: viewer },
                  { onSuccess: (s) => toast.success(`Checked in. Next one due by ${formatWhen(dueMs(s))}.`), onError: (e) => toast.error(errorCopy(e)) },
                )
              }
            >
              {checkIn.isPending ? <Loader2 className="size-4 animate-spin" /> : <HeartPulse className="size-4" />}
              {checkIn.isPending ? "Confirm in your wallet…" : "I'm still here"}
            </Button>
            <Button disabled={pending} onClick={() => setEditing(true)}>
              <PencilLine className="size-4" />
              Change who or how long
            </Button>
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() =>
                takeBack.mutate(
                  { id: sw.token_id, signer: viewer },
                  { onSuccess: () => toast.success("Taken back. The vault and your deposit are with you again."), onError: (e) => toast.error(errorCopy(e)) },
                )
              }
            >
              {takeBack.isPending ? <Loader2 className="size-4 animate-spin" /> : <Undo2 className="size-4" />}
              {takeBack.isPending ? "Confirm, then settling…" : "Take it back"}
            </Button>
          </>
        ) : quiet ? (
          <Button
            variant="primary"
            disabled={pending}
            onClick={() =>
              release.mutate(
                { id: sw.token_id, signer: viewer },
                {
                  onSuccess: () => toast.success(isBeneficiary ? "It's yours now, still sealed." : `Handed to ${sw.beneficiary}, still sealed.`),
                  onError: (e) => toast.error(errorCopy(e)),
                },
              )
            }
          >
            {release.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {release.isPending ? "Confirm, then settling…" : isBeneficiary ? "Take what's yours" : `Hand it to ${sw.beneficiary}`}
          </Button>
        ) : (
          <p className="text-[13px] text-fg-3">
            {isBeneficiary
              ? `If ${sw.owner} doesn't check in by ${formatWhen(due)}, you can take it then.`
              : `Only ${sw.owner} can check in or take it back. From ${formatWhen(due)} without a check-in, anyone can hand it to ${sw.beneficiary}.`}
          </p>
        )}
      </div>
      <div className="mt-4 border-t border-gold/20 pt-3.5">
        <SwitchLock compact />
      </div>

      {isOwner && viewer ? <EditSheet sw={sw} signer={viewer} open={editing} onOpenChange={setEditing} /> : null}
    </div>
  );
}

function EditSheet({ sw, signer, open, onOpenChange }: { sw: VaultSwitch; signer: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const update = useUpdateSwitch();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title="Change the switch" description="Saving it counts as a check-in, so the clock restarts too.">
        <SwitchForm
          signer={signer}
          initial={{ beneficiary: sw.beneficiary, intervalMs: intervalMs(sw) }}
          submitLabel={update.isPending ? "Confirm in your wallet…" : "Save and check in"}
          pending={update.isPending}
          onNext={(p) =>
            update.mutate(
              {
                id: sw.token_id,
                beneficiary: p.beneficiary === sw.beneficiary ? undefined : p.beneficiary,
                intervalMs: p.intervalMs === intervalMs(sw) ? undefined : p.intervalMs,
                signer,
              },
              {
                onSuccess: () => {
                  toast.success(`Saved. It goes to ${p.beneficiary} after ${intervalText(p.intervalMs)} of silence.`);
                  onOpenChange(false);
                },
                onError: (e) => toast.error(errorCopy(e)),
              },
            )
          }
        />
      </SheetContent>
    </Sheet>
  );
}
