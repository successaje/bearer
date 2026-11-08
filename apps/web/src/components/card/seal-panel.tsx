"use client";

import { Accordion } from "radix-ui";
import { Check, ChevronDown, Link2, Minus, RefreshCw, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { Seal } from "@/components/brand/seal";
import { Button } from "@/components/ui/button";
import { useExpirePending, useProveEvm } from "@/lib/bearer/hooks";
import type { CheckState, SealCheck, SealReport } from "@/lib/bearer/seal";
import type { Card } from "@/lib/bearer/types";
import { formatCountdown, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const ICON_CLASS: Record<CheckState, string> = {
  pass: "bg-ok/15 text-ok",
  warn: "bg-warn/15 text-warn",
  fail: "bg-danger/15 text-danger",
  info: "bg-raised text-fg-2",
};

function CheckIcon({ state }: { state: CheckState }) {
  return (
    <span aria-hidden className={cn("inline-flex size-[22px] shrink-0 items-center justify-center rounded-full", ICON_CLASS[state])}>
      {state === "pass" ? <Check className="size-3" strokeWidth={3} /> : null}
      {state === "warn" ? <TriangleAlert className="size-3" strokeWidth={2.5} /> : null}
      {state === "fail" ? <X className="size-3" strokeWidth={3} /> : null}
      {state === "info" ? <Minus className="size-3" strokeWidth={2.5} /> : null}
    </span>
  );
}

const STATE_LABEL: Record<CheckState, string> = {
  pass: "Passed",
  warn: "Passed with exclusions",
  fail: "Not passed",
  info: "Information",
};

export function SealPanel({
  card,
  report,
  now,
  checkedAt,
  onRecheck,
  rechecking,
  className,
}: {
  card: Card;
  report: SealReport;
  now: number;
  checkedAt: number;
  onRecheck: () => void;
  rechecking?: boolean;
  className?: string;
}) {
  const failing = report.checks.find((c) => c.state === "fail" || c.state === "warn");
  const tone =
    report.verdict === "sealed" ? "bg-ok/[0.06]" : report.verdict === "sealed_with_exclusions" ? "bg-warn/[0.06]" : "bg-danger/[0.06]";

  async function share() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/c/${card.id}`);
      toast.success("Seal report link copied", { description: "Anyone with the link sees the same checks." });
    } catch {
      toast.error("Couldn't copy the link.");
    }
  }

  return (
    <section aria-labelledby="seal-heading" className={cn("overflow-hidden rounded-panel border border-line-strong bg-surface", className)}>
      <div className={cn("border-b border-line p-5 sm:p-6", tone)}>
        <div className="flex items-center justify-between gap-3">
          <h2 id="seal-heading" className="text-[13.5px] font-medium text-fg-2">
            Seal integrity
          </h2>
          <span className="text-[12px] text-fg-3" suppressHydrationWarning>
            Checked {checkedAt ? relativeTime(checkedAt, now) : "now"}
          </span>
        </div>
        <div className="mt-4 flex items-center gap-4" aria-live="polite">
          <div className="relative shrink-0">
            <Seal variant={report.verdict === "not_transferable" ? "cracked" : "check"} className="size-16" />
            {report.verdict === "sealed_with_exclusions" ? (
              <span
                aria-hidden
                className="absolute -bottom-0.5 -right-0.5 inline-flex size-6 items-center justify-center rounded-full border-[3px] border-surface bg-[#D97706] text-[13px] font-bold text-ink"
              >
                !
              </span>
            ) : null}
          </div>
          <div className="min-w-0">
            <p className="text-[22px] font-semibold tracking-[-0.02em]">{report.headline}</p>
            <p className="mt-1 text-[14px] leading-relaxed text-fg-2">{report.detail}</p>
          </div>
        </div>
      </div>

      <Accordion.Root type="single" collapsible defaultValue={failing?.id} className="divide-y divide-line">
        {report.checks.map((check) => (
          <CheckRow key={check.id} card={card} check={check} now={now} />
        ))}
      </Accordion.Root>

      <div className="border-t border-line bg-surface-2 p-5">
        <p className="text-[12.5px] font-medium text-fg-2">You&apos;re trusting</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-fg-3">
          NEAR&apos;s MPC network, where a threshold of operators must agree, and the Bearer contract code: open source,
          locked.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" onClick={share}>
            <Link2 className="size-3.5" />
            Share report
          </Button>
          <Button size="sm" onClick={onRecheck} disabled={rechecking}>
            <RefreshCw className={cn("size-3.5", rechecking && "animate-spin")} />
            Re-check
          </Button>
        </div>
      </div>
    </section>
  );
}

function CheckRow({ card, check, now }: { card: Card; check: SealCheck; now: number }) {
  const prove = useProveEvm();
  const expire = useExpirePending();

  if (check.state === "info") {
    return (
      <div className="flex items-center gap-3 px-5 py-3.5">
        <CheckIcon state="info" />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium">{check.title}</div>
          <div className="mt-0.5 text-[12.5px] text-fg-3">{check.summary}</div>
        </div>
      </div>
    );
  }

  const action = check.action;
  return (
    <Accordion.Item value={check.id} className="group/item data-[state=open]:bg-surface-2">
      <Accordion.Header>
        <Accordion.Trigger className="flex w-full items-center gap-3 px-5 py-3.5 text-left">
          <CheckIcon state={check.state} />
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-medium text-fg">{check.title}</span>
            <span
              className={cn(
                "mt-0.5 block text-[12.5px]",
                check.state === "fail" ? "text-danger" : check.state === "warn" ? "text-warn" : "text-fg-3",
              )}
            >
              <span className="sr-only">{STATE_LABEL[check.state]}: </span>
              {check.summary}
            </span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-fg-3 transition-transform duration-200 group-data-[state=open]/item:rotate-180" />
        </Accordion.Trigger>
      </Accordion.Header>
      <Accordion.Content className="overflow-hidden px-5 pb-4 pl-[54px]">
        <p className="text-[13px] leading-relaxed text-fg-2">{check.why}</p>
        {check.evidence.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {check.evidence.map((e) => (
              <li key={e.label} className="inline-flex h-7 items-center rounded-[8px] border border-line bg-bg px-2.5 font-mono text-[11.5px] text-fg-2">
                {e.label}
              </li>
            ))}
          </ul>
        ) : null}
        {action?.kind === "prove_evm" ? (
          <div className="mt-3.5">
            <Button
              size="sm"
              variant="primary"
              disabled={prove.isPending}
              onClick={() =>
                prove.mutate(
                  { id: card.id },
                  {
                    onSuccess: () => toast.success("Base withdrawal proven", { description: "Checked on NEAR by MPC Read RPC." }),
                    onError: (e) => toast.error(e.message),
                  },
                )
              }
            >
              <RefreshCw className={cn("size-3.5", prove.isPending && "animate-spin")} />
              {prove.isPending ? "Proving on NEAR…" : "Flush & prove"}
            </Button>
            <p className="mt-2 text-[12px] text-fg-3">Anyone can do this. It broadcasts the stored transaction if needed, then proves it.</p>
          </div>
        ) : null}
        {action?.kind === "clear_request" ? (
          <div className="mt-3.5">
            {action.availableIn === 0 ? (
              <>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={expire.isPending}
                  onClick={() =>
                    expire.mutate(
                      { id: card.id, idx: action.idx },
                      {
                        onSuccess: () => toast.success("Request cleared", { description: "Funds didn't move." }),
                        onError: (e) => toast.error(e.message),
                      },
                    )
                  }
                >
                  {expire.isPending ? "Clearing…" : "Clear request"}
                </Button>
                <p className="mt-2 text-[12px] text-fg-3">Anyone can clear a stuck request. Anything it referenced stays excluded.</p>
              </>
            ) : (
              <p className="text-[12.5px] text-fg-3">
                If it doesn&apos;t finish, anyone can clear it in {formatCountdown(action.availableIn)}.
              </p>
            )}
          </div>
        ) : null}
        {action?.kind === "wait" ? (
          <p className="mt-3 text-[12.5px] text-fg-3">
            Hand-over unlocks in <span className="tabular font-medium text-fg">{formatCountdown(action.until - now)}</span>. Nothing
            to do but wait.
          </p>
        ) : null}
      </Accordion.Content>
    </Accordion.Item>
  );
}
