"use client";

import { ArrowUpRight, Eye, Link2, Plus, Send, Tag } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ErrorState, EmptyState } from "@/components/layout/page-states";
import { VerifyForm } from "@/components/landing/verify-form";
import { FundSheet } from "@/components/sheets/fund-sheet";
import { HandOverSheet } from "@/components/sheets/hand-over-sheet";
import { ListSheet } from "@/components/sheets/list-sheet";
import { OpenSheet } from "@/components/sheets/open-sheet";
import { Button, buttonVariants } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Skeleton } from "@/components/ui/primitives";
import { useWallet } from "@/components/wallet/wallet-provider";
import { useCard, useNow } from "@/lib/bearer/hooks";
import { cardStatus, computeSealReport, slotTotals } from "@/lib/bearer/seal";
import { CHAINS } from "@/lib/bearer/types";
import { CHAIN_META, cardNumber, formatAmount, formatDate, formatUsd } from "@/lib/format";
import { ActivityList } from "./activity-list";
import { BearerCard } from "./bearer-card";
import { BuyPanel } from "./buy-panel";
import { SealPanel } from "./seal-panel";
import { SlotCard } from "./slot-card";
import { StatusBadge, VerdictBadge } from "./status-badge";
import { TechnicalDetails } from "./technical-details";

type SheetName = "handover" | "open" | "list" | "fund";

export function CardDetailView() {
  const { id } = useParams<{ id: string }>();
  const query = useCard(id);
  const now = useNow(1000);
  const { accountId, ready, openConnect } = useWallet();
  const [sheet, setSheet] = useState<SheetName | null>(null);

  if (query.isPending || !now) return <CardDetailSkeleton />;
  if (query.isError) return <Shell><ErrorState error={query.error} onRetry={() => void query.refetch()} /></Shell>;

  const card = query.data;
  if (!card) {
    return (
      <Shell>
        <EmptyState seal="opened" title={`There's no ${cardNumber(id)}`}>
          <p>Check the number or link and try again.</p>
          <VerifyForm className="mt-6 text-left" label="Card number or link" />
        </EmptyState>
      </Shell>
    );
  }

  const report = computeSealReport(card, now);
  const status = cardStatus(card, now);
  const totals = slotTotals(card);
  const isOwner = ready && accountId === card.owner;
  const sealVariant = status === "action_needed" ? "cracked" : "monogram";
  const excluded = report.exclusions
    .map((e) => `${formatAmount(e.chain, e.amount)} ${CHAIN_META[e.chain].unit}`)
    .join(", ");

  return (
    <Shell>
      {!isOwner ? (
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-line bg-surface px-4 py-3 text-[13.5px] text-fg-2">
          <span className="inline-flex items-center gap-2">
            <Eye aria-hidden className="size-4" />
            Public seal report. Anyone with this link sees the same checks.
          </span>
          <Button
            size="sm"
            onClick={() =>
              void navigator.clipboard
                .writeText(window.location.href)
                .then(() => toast.success("Link copied"))
                .catch(() => toast.error("Couldn't copy the link."))
            }
          >
            <Link2 className="size-3.5" />
            Copy link
          </Button>
        </div>
      ) : null}

      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[13.5px] text-fg-3">
        <Link href={isOwner ? "/cards" : "/verify"} className="text-fg-2 hover:text-fg">
          {isOwner ? "My cards" : "Verify"}
        </Link>
        <span aria-hidden>/</span>
        <span aria-current="page" className="truncate text-fg">
          {card.name}
        </span>
      </nav>

      <section className="mt-7 grid items-center gap-10 lg:grid-cols-[380px_minmax(0,1fr)] lg:gap-12">
        <div className="mx-auto w-full max-w-[380px]">
          <BearerCard
            name={card.name}
            id={card.id}
            finish={card.finish}
            valueUsd={report.sealedUsd}
            seal={sealVariant}
            chains={CHAINS.filter((c) => totals[c].total > 0)}
          />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            {status === "sealed" && report.verdict === "sealed_with_exclusions" ? (
              <VerdictBadge verdict="sealed_with_exclusions" />
            ) : (
              <StatusBadge status={status} />
            )}
            {status !== "sealed" && report.verdict === "sealed_with_exclusions" ? (
              <VerdictBadge verdict="sealed_with_exclusions" />
            ) : null}
            <span className="font-mono text-[13px] text-fg-3">{cardNumber(card.id)}</span>
            {isOwner ? <span className="text-[13px] text-fg-3">· You hold this card</span> : null}
          </div>
          <h1 className="text-balance mt-3.5 text-[clamp(32px,4vw,44px)] font-semibold leading-[1.05] tracking-[-0.04em]">
            {card.name}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13.5px] text-fg-3">
            <span className="inline-flex items-center gap-1.5">
              Owner <span className="font-mono text-fg">{card.owner}</span>
              <CopyButton value={card.owner} label="Copy owner account" size="sm" />
            </span>
            <span>Created {formatDate(card.createdAt)}</span>
          </div>

          <div className="mt-6">
            <p className="text-[13px] text-fg-3">Sealed value</p>
            <p className="mt-1.5 flex items-baseline gap-2.5">
              <span className="tabular text-[clamp(40px,5vw,52px)] font-semibold leading-none tracking-[-0.04em]">
                {formatUsd(report.sealedUsd)}
              </span>
              <span className="text-[15px] text-fg-3">est.</span>
            </p>
            <p className="mt-2 text-[13.5px] text-fg-2">
              {excluded ? (
                <>
                  Across Bitcoin, Base and Solana. <span className="text-warn">{excluded} excluded.</span>
                </>
              ) : (
                "Across Bitcoin, Base and Solana. Nothing excluded."
              )}
            </p>
          </div>

          {isOwner ? (
            <div className="mt-7 flex flex-wrap gap-2.5">
              <Button variant="primary" onClick={() => setSheet("handover")}>
                <Send className="size-4" />
                Hand over
              </Button>
              <Button onClick={() => setSheet("open")}>
                <ArrowUpRight className="size-4" />
                Open
              </Button>
              <Button onClick={() => setSheet("fund")}>
                <Plus className="size-4" />
                Add funds
              </Button>
              <Button onClick={() => setSheet("list")}>
                <Tag className="size-4" />
                {card.listing ? `Listed · ${card.listing.priceNear} NEAR` : "List for sale"}
              </Button>
            </div>
          ) : null}
        </div>
      </section>

      <div className="my-12 h-px bg-line" />

      <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_380px]">
        <aside className="flex flex-col gap-5 lg:sticky lg:top-24 lg:order-last">
          {!isOwner && card.listing ? <BuyPanel key={card.id} card={card} report={report} /> : null}
          <SealPanel
            card={card}
            report={report}
            now={now}
            checkedAt={query.dataUpdatedAt}
            onRecheck={() => void query.refetch()}
            rechecking={query.isFetching}
          />
        </aside>

        <div className="flex min-w-0 flex-col">
          <h2 className="text-[20px] font-semibold tracking-[-0.02em]">Inside this card</h2>
          <div className="mt-4 flex flex-col gap-3">
            {CHAINS.map((chain) => (
              <SlotCard key={chain} card={card} chain={chain} totals={totals[chain]} />
            ))}
          </div>

          <h2 className="mt-11 text-[20px] font-semibold tracking-[-0.02em]">Activity</h2>
          <div className="mt-4">
            <ActivityList items={card.activity} now={now} limit={8} />
          </div>

          <div className="mt-11">
            <TechnicalDetails card={card} />
          </div>
        </div>
      </div>

      {accountId && (isOwner || sheet === "handover") ? (
        // Stays mounted after a hand-over so its success screen survives the ownership change.
        <HandOverSheet
          open={sheet === "handover"}
          onOpenChange={(o) => setSheet(o ? "handover" : null)}
          card={card}
          report={report}
          signer={accountId}
          now={now}
        />
      ) : null}
      {isOwner && accountId ? (
        <>
          <OpenSheet open={sheet === "open"} onOpenChange={(o) => setSheet(o ? "open" : null)} card={card} signer={accountId} />
          <ListSheet open={sheet === "list"} onOpenChange={(o) => setSheet(o ? "list" : null)} card={card} signer={accountId} />
          <FundSheet open={sheet === "fund"} onOpenChange={(o) => setSheet(o ? "fund" : null)} card={card} />
        </>
      ) : null}

      {!isOwner && ready && !accountId ? (
        <p className="mt-10 text-center text-[13.5px] text-fg-3">
          Own this card?{" "}
          <button type="button" onClick={() => openConnect()} className={buttonVariants({ variant: "link" })}>
            Connect your wallet
          </button>{" "}
          to manage it.
        </p>
      ) : null}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-[1200px] px-5 pb-8 pt-8 md:px-8 md:pt-10">{children}</div>;
}

export function CardDetailSkeleton() {
  return (
    <Shell>
      <Skeleton className="h-4 w-40" />
      <div className="mt-7 grid items-center gap-10 lg:grid-cols-[380px_minmax(0,1fr)] lg:gap-12">
        <Skeleton className="mx-auto aspect-[1.586] w-full max-w-[380px] rounded-[20px]" />
        <div className="flex flex-col gap-4">
          <Skeleton className="h-6 w-56 rounded-full" />
          <Skeleton className="h-11 w-3/4" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="mt-4 h-12 w-48" />
          <div className="mt-4 flex gap-2.5">
            <Skeleton className="h-11 w-32" />
            <Skeleton className="h-11 w-24" />
            <Skeleton className="h-11 w-28" />
          </div>
        </div>
      </div>
      <div className="my-12 h-px bg-line" />
      <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-40 rounded-panel" />
          <Skeleton className="h-40 rounded-panel" />
          <Skeleton className="h-40 rounded-panel" />
        </div>
        <Skeleton className="h-[520px] rounded-panel" />
      </div>
      <span className="sr-only" role="status">
        Loading card…
      </span>
    </Shell>
  );
}
