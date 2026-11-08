"use client";

import { Accordion } from "radix-ui";
import { Check, ChevronDown, Info, Link2, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Seal } from "@/components/brand/seal";
import { Button } from "@/components/ui/button";
import type { CheckState, VaultReport } from "@/lib/vault/report";
import { relativeTime } from "@/lib/vault/format";
import { cn } from "@/lib/utils";

const ICON: Record<CheckState, string> = {
  pass: "bg-ok/15 text-ok",
  info: "bg-raised text-fg-2",
  pending: "bg-info/10 text-info",
};

export function SealPanel({
  tokenId,
  report,
  now,
  checkedAt,
  onRecheck,
  rechecking,
}: {
  tokenId: string;
  report: VaultReport;
  now: number;
  checkedAt: number;
  onRecheck: () => void;
  rechecking?: boolean;
}) {
  async function share() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/v/${tokenId}`);
      toast.success("Vault link copied", { description: "Anyone with it sees the same checks." });
    } catch {
      toast.error("Couldn't copy the link.");
    }
  }

  return (
    <section aria-labelledby="seal-heading" className="overflow-hidden rounded-panel border border-line-strong bg-surface">
      <div className={cn("border-b border-line p-5 sm:p-6", report.sealed ? "bg-ok/[0.06]" : "bg-gold/[0.06]")}>
        <div className="flex items-center justify-between gap-3">
          <h2 id="seal-heading" className="text-[13.5px] font-medium text-fg-2">
            The seal
          </h2>
          <span className="text-[12px] text-fg-3">Checked {checkedAt && now ? relativeTime(checkedAt, now) : "now"}</span>
        </div>
        <div className="mt-4 flex items-center gap-4" aria-live="polite">
          <Seal variant={report.sealed ? "monogram" : "opened"} className="size-16 shrink-0" />
          <div className="min-w-0">
            <p className="text-[22px] font-semibold tracking-[-0.02em]">{report.headline}</p>
            <p className="mt-1 text-[14px] leading-relaxed text-fg-2">{report.detail}</p>
          </div>
        </div>
      </div>

      <Accordion.Root type="single" collapsible className="divide-y divide-line">
        {report.checks.map((c) => (
          <Accordion.Item key={c.id} value={c.id} className="group/item data-[state=open]:bg-surface-2">
            <Accordion.Header>
              <Accordion.Trigger className="flex w-full items-center gap-3 px-5 py-3.5 text-left">
                <span aria-hidden className={cn("inline-flex size-[22px] shrink-0 items-center justify-center rounded-full", ICON[c.state])}>
                  {c.state === "pass" ? <Check className="size-3" strokeWidth={3} /> : null}
                  {c.state === "info" ? <Info className="size-3" strokeWidth={2.5} /> : null}
                  {c.state === "pending" ? <Loader2 className="size-3 animate-spin" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium">{c.title}</span>
                  <span className="mt-0.5 block text-[12.5px] text-fg-3">{c.summary}</span>
                </span>
                <ChevronDown className="size-4 shrink-0 text-fg-3 transition-transform duration-200 group-data-[state=open]/item:rotate-180" />
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content className="overflow-hidden px-5 pb-4 pl-[54px]">
              <p className="text-[13px] leading-relaxed text-fg-2">{c.why}</p>
              {c.evidence.length ? (
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {c.evidence.map((e) => (
                    <li key={e} className="inline-flex h-7 max-w-full items-center truncate rounded-[8px] border border-line bg-bg px-2.5 font-mono text-[11.5px] text-fg-2">
                      {e}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Accordion.Content>
          </Accordion.Item>
        ))}
      </Accordion.Root>

      <div className="border-t border-line bg-surface-2 p-5">
        <p className="text-[12.5px] font-medium text-fg-2">You&apos;re trusting</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-fg-3">
          NEAR&apos;s MPC network, where a threshold of operators must agree, and the Bearer contract: open source, locked,
          with no admin.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" onClick={share}>
            <Link2 className="size-3.5" />
            Share
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
