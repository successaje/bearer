"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EmptyState, ErrorState } from "@/components/layout/page-states";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { useWallet } from "@/components/wallet/wallet-provider";
import { formatUsd } from "@/lib/vault/format";
import { lenderOf } from "@/components/lend/lend-bits";
import { LoanCard } from "@/components/lend/lend-view";
import { SwitchCard } from "@/components/switch/switch-card";
import { ListingCard } from "@/components/market/market-view";
import { ScheduleCard } from "@/components/schedule/schedule-card";
import { useListings, useLoans, useNow, useSchedules, useSwitches, useVaultSummaries, useVaults } from "@/lib/vault/hooks";
import { observedUsd, vaultStatus, type VaultStatus } from "@/lib/vault/report";
import { cn } from "@/lib/utils";
import { VaultTile } from "./vault-tile";

type Filter = "all" | "sealed" | "opened";

const FILTERS: { id: Filter; label: string; match: (s: VaultStatus) => boolean }[] = [
  { id: "all", label: "All", match: () => true },
  { id: "sealed", label: "Sealed", match: (s) => s === "sealed" },
  { id: "opened", label: "Opened", match: (s) => s !== "sealed" },
];

const EMPTY_COPY = "A vault is something you can hand to someone.";

export function MyVaultsView() {
  const { accountId, ready, openConnect } = useWallet();
  const vaults = useVaults(accountId);
  const summaries = useVaultSummaries(vaults.data);
  const now = useNow(5000);
  const [filter, setFilter] = useState<Filter>("all");
  // A listed vault is held by the market, not by you, so it isn't in `vaults`; show it separately.
  const listings = useListings();
  const listed = (listings.data ?? []).filter((l) => l.seller === accountId);
  // Scheduled vaults are held by the schedule contract: the giver's, and the ones on their way to you.
  const schedules = useSchedules().data ?? [];
  const scheduledByMe = schedules.filter((x) => x.giver === accountId);
  const comingToMe = schedules.filter((x) => x.recipient === accountId);
  // Pledged vaults are held by the lending contract: the ones you borrowed against, and the ones backing your loans.
  const loans = useLoans().data ?? [];
  const borrowed = loans.filter((l) => l.borrower === accountId);
  const lent = loans.filter((l) => !!accountId && lenderOf(l) === accountId);
  // Vaults in a switch are held by the switch contract: yours, and the ones that come to you if their owner goes quiet.
  const switches = useSwitches().data ?? [];
  const mySwitches = switches.filter((x) => x.owner === accountId);
  const namedMe = switches.filter((x) => x.beneficiary === accountId);

  if (!ready) return <Frame><GridSkeleton /></Frame>;

  if (!accountId) {
    return (
      <Frame>
        <EmptyState
          title="Connect a wallet to see your vaults"
          action={
            <>
              <Button variant="primary" size="lg" onClick={() => openConnect()}>
                Connect wallet
              </Button>
              <Link href="/verify" className={buttonVariants({ size: "lg" })}>
                Verify a vault
              </Link>
            </>
          }
        >
          Vaults live on NEAR testnet. Connect the account that holds them.
        </EmptyState>
      </Frame>
    );
  }

  if (vaults.isPending) return <Frame header={<Header count={null} />}><GridSkeleton /></Frame>;
  if (vaults.isError) {
    return (
      <Frame header={<Header count={null} />}>
        <ErrorState error={vaults.error} onRetry={() => void vaults.refetch()} />
      </Frame>
    );
  }

  if (summaries.length === 0 && listed.length === 0 && scheduledByMe.length === 0 && comingToMe.length === 0) {
    return (
      <Frame header={<Header count={0} />}>
        <EmptyState
          title="No vaults yet"
          action={
            <Link href="/create" className={buttonVariants({ variant: "primary", size: "lg" })}>
              <Plus className="size-4" />
              Create a vault
            </Link>
          }
        >
          {EMPTY_COPY}
        </EmptyState>
      </Frame>
    );
  }

  const rows: Row[] = summaries.map((s) => ({ ...s, status: vaultStatus(s.vault, s.withdrawals, s.observations) }));
  const active = FILTERS.find((f) => f.id === filter) ?? FILTERS[0];
  const shown = rows.filter((r) => active.match(r.status));

  return (
    <Frame header={<Header count={rows.length} listed={listed.length} scheduled={scheduledByMe.length} />}>
      {rows.length ? <Stats rows={rows} /> : null}

      <div className={cn("mt-9 flex flex-wrap items-center justify-between gap-3", !rows.length && "hidden")}>
        <div role="group" aria-label="Filter vaults" className="flex flex-wrap gap-1 rounded-[12px] border border-line bg-surface p-1">
          {FILTERS.map((f) => {
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
                {f.label} <span className="tabular text-fg-3">{rows.filter((r) => f.match(r.status)).length}</span>
              </button>
            );
          })}
        </div>
        <p className="text-[13px] text-fg-3">Balances are observed and refresh every 10 s.</p>
      </div>

      <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((r) => (
          <VaultTile key={r.vault.token_id} vault={r.vault} observations={r.observations} withdrawals={r.withdrawals} now={now} />
        ))}
        {filter !== "opened" ? (
          <Link
            href="/create"
            className="flex min-h-[340px] flex-col items-center justify-center gap-3.5 rounded-[20px] border-[1.5px] border-dashed border-line-strong p-6 text-center transition-colors hover:border-gold/50 hover:bg-surface"
          >
            <span className="inline-flex size-13 items-center justify-center rounded-full border border-line-strong bg-surface-2 text-accent">
              <Plus className="size-5" />
            </span>
            <span className="text-[16px] font-semibold">Create a vault</span>
            <span className="max-w-[220px] text-[13.5px] leading-relaxed text-fg-3">{EMPTY_COPY}</span>
          </Link>
        ) : null}
      </div>
      {shown.length === 0 && rows.length ? <p className="mt-2 text-[14px] text-fg-3">No vaults match this filter.</p> : null}

      {comingToMe.length ? (
        <section aria-labelledby="coming" className="mt-14">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="coming" className="text-[22px] font-semibold tracking-[-0.025em]">
              Coming to you <span className="tabular text-fg-3">{comingToMe.length}</span>
            </h2>
            <p className="text-[13px] text-fg-3">Scheduled for you by someone else. They arrive sealed on their date.</p>
          </div>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {comingToMe.map((x) => (
              <ScheduleCard key={x.token_id} schedule={x} viewer={accountId} now={now} />
            ))}
          </div>
        </section>
      ) : null}

      {scheduledByMe.length ? (
        <section aria-labelledby="scheduled" className="mt-14">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="scheduled" className="text-[22px] font-semibold tracking-[-0.025em]">
              Scheduled by you <span className="tabular text-fg-3">{scheduledByMe.length}</span>
            </h2>
            <p className="text-[13px] text-fg-3">Held, sealed, until their date. Nobody can withdraw meanwhile, you included.</p>
          </div>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {scheduledByMe.map((x) => (
              <ScheduleCard key={x.token_id} schedule={x} viewer={accountId} now={now} />
            ))}
          </div>
        </section>
      ) : null}

      {mySwitches.length ? (
        <section aria-labelledby="my-switches" className="mt-14">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="my-switches" className="text-[22px] font-semibold tracking-[-0.025em]">
              If you go quiet <span className="tabular text-fg-3">{mySwitches.length}</span>
            </h2>
            <p className="text-[13px] text-fg-3">Held, sealed, while you check in. Open one to check in, change it or take it back.</p>
          </div>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {mySwitches.map((x) => (
              <SwitchCard key={x.token_id} sw={x} viewer={accountId} now={now} />
            ))}
          </div>
        </section>
      ) : null}

      {namedMe.length ? (
        <section aria-labelledby="named-me" className="mt-14">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="named-me" className="text-[22px] font-semibold tracking-[-0.025em]">
              Left to you <span className="tabular text-fg-3">{namedMe.length}</span>
            </h2>
            <p className="text-[13px] text-fg-3">Someone named you. If they stop checking in, the vault can be handed to you.</p>
          </div>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {namedMe.map((x) => (
              <SwitchCard key={x.token_id} sw={x} viewer={accountId} now={now} />
            ))}
          </div>
        </section>
      ) : null}

      {borrowed.length ? (
        <section aria-labelledby="borrowed" className="mt-14">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="borrowed" className="text-[22px] font-semibold tracking-[-0.025em]">
              Borrowed against <span className="tabular text-fg-3">{borrowed.length}</span>
            </h2>
            <p className="text-[13px] text-fg-3">Held, sealed, until you repay, or take back a request nobody has funded.</p>
          </div>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {borrowed.map((l) => (
              <LoanCard key={l.token_id} loan={l} now={now} />
            ))}
          </div>
        </section>
      ) : null}

      {lent.length ? (
        <section aria-labelledby="lent" className="mt-14">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="lent" className="text-[22px] font-semibold tracking-[-0.025em]">
              Backing your loans <span className="tabular text-fg-3">{lent.length}</span>
            </h2>
            <p className="text-[13px] text-fg-3">If a loan isn&apos;t repaid by its due date, you can take its vault.</p>
          </div>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {lent.map((l) => (
              <LoanCard key={l.token_id} loan={l} now={now} />
            ))}
          </div>
        </section>
      ) : null}

      {listed.length ? (
        <section aria-labelledby="listed" className="mt-14">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="listed" className="text-[22px] font-semibold tracking-[-0.025em]">
              On the market <span className="tabular text-fg-3">{listed.length}</span>
            </h2>
            <p className="text-[13px] text-fg-3">The market holds these, sealed, until they sell or you delist them.</p>
          </div>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {listed.map((l) => (
              <ListingCard key={l.token_id} listing={l} now={now} />
            ))}
          </div>
        </section>
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

function Header({ count, listed = 0, scheduled = 0 }: { count: number | null; listed?: number; scheduled?: number }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-5">
      <div>
        <h1 className="text-[36px] font-semibold leading-tight tracking-[-0.035em]">My vaults</h1>
        <p className="mt-1.5 text-[15px] text-fg-2">
          {count === null
            ? "Loading your vaults…"
            : `${count} vault${count === 1 ? "" : "s"} you hold on NEAR testnet${[listed ? `${listed} on the market` : "", scheduled ? `${scheduled} scheduled` : ""].filter(Boolean).map((x) => `, ${x}`).join("")}.`}
        </p>
      </div>
      <Link href="/create" className={buttonVariants({ variant: "primary" })}>
        <Plus className="size-4" />
        Create a vault
      </Link>
    </div>
  );
}

type Row = ReturnType<typeof useVaultSummaries>[number] & { status: VaultStatus };

function Stats({ rows }: { rows: Row[] }) {
  const loaded = rows.every((r) => r.observations);
  const total = rows.reduce((s, r) => s + observedUsd(r.observations), 0);
  const sealed = rows.filter((r) => r.status === "sealed").length;
  const opened = rows.length - sealed;
  const withdrawing = rows.filter((r) => r.status === "withdrawing");

  const cell = "min-w-0 px-4 py-4 sm:px-6 sm:py-5";
  const big = "mt-2 flex items-baseline gap-2.5 text-[22px] font-semibold tracking-[-0.03em] sm:text-[28px]";
  const note = "truncate text-[13px] font-medium tracking-normal";
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-line bg-line lg:grid-cols-4 [&>*]:bg-surface">
      <div className={cell}>
        <p className="text-[13px] text-fg-3">Observed value, at mainnet prices</p>
        <div className={cn(big, "tabular")}>
          {loaded ? formatUsd(total) : <Skeleton className="h-8 w-28" />}
          <span className={cn(note, "text-fg-3")}>est.</span>
        </div>
      </div>
      <div className={cell}>
        <p className="text-[13px] text-fg-3">Sealed</p>
        <p className={big}>
          {sealed}
          <span className={cn(note, "text-fg-3")}>can change hands</span>
        </p>
      </div>
      <div className={cell}>
        <p className="text-[13px] text-fg-3">Opened</p>
        <p className={big}>
          {opened}
          <span className={cn(note, "text-fg-3")}>withdrawals only</span>
        </p>
      </div>
      <div className={cell}>
        <p className="text-[13px] text-fg-3">Withdrawing</p>
        <p className={big}>
          {withdrawing.length}
          {withdrawing.length ? (
            <span className={cn(note, "text-info")}>{withdrawing.map((r) => r.vault.name ?? "Vault").join(", ")}</span>
          ) : (
            <span className={cn(note, "text-fg-3")}>none signing</span>
          )}
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
        Loading vaults…
      </span>
    </div>
  );
}
