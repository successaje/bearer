"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState, ErrorState } from "@/components/layout/page-states";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { useWallet } from "@/components/wallet/wallet-provider";
import { useCards, useNow } from "@/lib/bearer/hooks";
import { cardStatus, computeSealReport } from "@/lib/bearer/seal";
import type { Card, CardStatus } from "@/lib/bearer/types";
import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CardTile } from "./card-tile";

type Filter = "all" | "sealed" | "action" | "progress" | "listed";

const FILTERS: { id: Filter; label: string; match: (s: CardStatus) => boolean }[] = [
  { id: "all", label: "All", match: () => true },
  { id: "sealed", label: "Sealed", match: (s) => s === "sealed" },
  { id: "action", label: "Needs action", match: (s) => s === "action_needed" },
  { id: "progress", label: "In progress", match: (s) => s === "pending_signature" || s === "claim_pending" },
  { id: "listed", label: "Listed", match: (s) => s === "listed" },
];

export function MyCardsView() {
  const { accountId, ready, openConnect } = useWallet();
  const cards = useCards(accountId);
  const now = useNow(5000);
  const [filter, setFilter] = useState<Filter>("all");

  const statuses = useMemo(() => {
    const map = new Map<string, CardStatus>();
    if (now) for (const c of cards.data ?? []) map.set(c.id, cardStatus(c, now));
    return map;
  }, [cards.data, now]);

  if (!ready) return <Frame><GridSkeleton /></Frame>;

  if (!accountId) {
    return (
      <Frame>
        <EmptyState
          title="Connect a wallet to see your cards"
          action={
            <>
              <Button variant="primary" size="lg" onClick={() => openConnect()}>
                Connect wallet
              </Button>
              <Link href="/verify" className={buttonVariants({ size: "lg" })}>
                Verify a card
              </Link>
            </>
          }
        >
          Cards live on NEAR testnet. Connect the account that holds them.
        </EmptyState>
      </Frame>
    );
  }

  if (cards.isPending || !now) return <Frame header={<Header count={null} />}><GridSkeleton /></Frame>;
  if (cards.isError) return <Frame header={<Header count={null} />}><ErrorState error={cards.error} onRetry={() => void cards.refetch()} /></Frame>;

  const all = cards.data;
  if (all.length === 0) {
    return (
      <Frame header={<Header count={0} />}>
        <EmptyState
          title="No cards yet"
          action={
            <Link href="/create" className={buttonVariants({ variant: "primary", size: "lg" })}>
              <Plus className="size-4" />
              Create a card
            </Link>
          }
        >
          A card is a wallet you can hand to someone.
        </EmptyState>
      </Frame>
    );
  }

  const active = FILTERS.find((f) => f.id === filter) ?? FILTERS[0];
  const shown = all.filter((c) => active.match(statuses.get(c.id) ?? "sealed"));
  const count = (f: (typeof FILTERS)[number]) => all.filter((c) => f.match(statuses.get(c.id) ?? "sealed")).length;

  return (
    <Frame header={<Header count={all.length} />}>
      <Stats cards={all} statuses={statuses} now={now} />

      <div className="mt-9 flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Filter cards" className="flex flex-wrap gap-1 rounded-[12px] border border-line bg-surface p-1">
          {FILTERS.map((f) => {
            const n = count(f);
            const on = filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={on}
                onClick={() => setFilter(f.id)}
                className={cn(
                  "h-9 rounded-[8px] px-3.5 text-[13.5px] transition-colors",
                  on ? "bg-raised font-medium text-fg" : "text-fg-2 hover:text-fg",
                )}
              >
                {f.label} <span className="tabular text-fg-3">{n}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((card) => (
          <CardTile key={card.id} card={card} now={now} />
        ))}
        {filter === "all" ? (
          <Link
            href="/create"
            className="flex min-h-[340px] flex-col items-center justify-center gap-3.5 rounded-[20px] border-[1.5px] border-dashed border-line-strong p-6 text-center transition-colors hover:border-gold/50 hover:bg-surface"
          >
            <span className="inline-flex size-13 items-center justify-center rounded-full border border-line-strong bg-surface-2 text-accent">
              <Plus className="size-5" />
            </span>
            <span className="text-[16px] font-semibold">Create a card</span>
            <span className="max-w-[220px] text-[13.5px] leading-relaxed text-fg-3">A card is a wallet you can hand to someone.</span>
          </Link>
        ) : null}
      </div>
      {shown.length === 0 ? (
        <p className="mt-2 text-[14px] text-fg-3">No cards match this filter.</p>
      ) : null}
    </Frame>
  );
}

function Frame({ header, children }: { header?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[1200px] px-5 pb-8 pt-10 md:px-8 md:pt-12">
      {header}
      <div className={header ? "mt-8" : undefined}>{children}</div>
    </div>
  );
}

function Header({ count }: { count: number | null }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-5">
      <div>
        <h1 className="text-[36px] font-semibold leading-tight tracking-[-0.035em]">My cards</h1>
        <p className="mt-1.5 text-[15px] text-fg-2">
          {count === null ? "Loading your cards…" : `${count} card${count === 1 ? "" : "s"} you hold on NEAR testnet.`}
        </p>
      </div>
      <Link href="/create" className={buttonVariants({ variant: "primary" })}>
        <Plus className="size-4" />
        Create a card
      </Link>
    </div>
  );
}

function Stats({ cards, statuses, now }: { cards: Card[]; statuses: Map<string, CardStatus>; now: number }) {
  const total = cards.reduce((s, c) => s + computeSealReport(c, now).sealedUsd, 0);
  const action = cards.filter((c) => statuses.get(c.id) === "action_needed");
  const signing = cards.filter((c) => statuses.get(c.id) === "pending_signature").length;
  const claims = cards.filter((c) => statuses.get(c.id) === "claim_pending").length;
  const listed = cards.filter((c) => statuses.get(c.id) === "listed");

  const cell = "min-w-0 px-4 py-4 sm:px-6 sm:py-5 [&_p+p]:text-[22px] sm:[&_p+p]:text-[28px] [&_span]:truncate";
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-line bg-line lg:grid-cols-4 [&>*]:bg-surface">
      <div className={cell}>
        <p className="text-[13px] text-fg-3">Sealed value</p>
        <p className="tabular mt-2 text-[28px] font-semibold tracking-[-0.03em]">
          {formatUsd(total)} <span className="text-[13px] font-medium tracking-normal text-fg-3">est.</span>
        </p>
      </div>
      <div className={cell}>
        <p className="text-[13px] text-fg-3">Needs action</p>
        <p className="mt-2 flex items-baseline gap-2.5 text-[28px] font-semibold tracking-[-0.03em]">
          {action.length}
          {action.length ? <span className="truncate text-[13px] font-medium tracking-normal text-warn">{action.map((c) => c.name).join(", ")}</span> : null}
        </p>
      </div>
      <div className={cell}>
        <p className="text-[13px] text-fg-3">In progress</p>
        <p className="mt-2 flex items-baseline gap-2.5 text-[28px] font-semibold tracking-[-0.03em]">
          {signing + claims}
          <span className="text-[13px] font-medium tracking-normal text-fg-3">
            {signing} signing · {claims} claim link{claims === 1 ? "" : "s"}
          </span>
        </p>
      </div>
      <div className={cell}>
        <p className="text-[13px] text-fg-3">Listed</p>
        <p className="mt-2 flex items-baseline gap-2.5 text-[28px] font-semibold tracking-[-0.03em]">
          {listed.length}
          {listed.length ? (
            <span className="text-[13px] font-medium tracking-normal text-fg-3">
              {listed.map((c) => `${c.listing?.priceNear} NEAR`).join(", ")}
            </span>
          ) : null}
        </p>
      </div>
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="rounded-[20px] border border-line bg-surface p-3.5">
          <Skeleton className="aspect-[1.586] rounded-[16px]" />
          <Skeleton className="mt-4 h-5 w-2/3" />
          <Skeleton className="mt-3 h-6 w-28 rounded-full" />
        </div>
      ))}
      <span className="sr-only" role="status">
        Loading cards…
      </span>
    </div>
  );
}
