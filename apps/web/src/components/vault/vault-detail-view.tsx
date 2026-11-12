"use client";

import type { MarketListing, VaultLoan } from "@bearer/sdk";
import { ArrowDownLeft, ArrowUpRight, CalendarClock, Code, Coins, Eye, HandCoins, History, Hourglass, Link2, PackageOpen, Presentation, ScrollText, Send, ShieldCheck, Store, Swords } from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Tabs } from "radix-ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { EmptyState, ErrorState } from "@/components/layout/page-states";
import { VerifyForm } from "@/components/landing/verify-form";
import { BorrowSheet } from "@/components/lend/borrow-sheet";
import { LendSheet } from "@/components/lend/lend-sheet";
import { lenderOf } from "@/components/lend/lend-bits";
import { LoanPanel } from "@/components/lend/loan-panel";
import { SwitchPanel } from "@/components/switch/switch-panel";
import { SwitchSheet } from "@/components/switch/switch-sheet";
import { BuySheet } from "@/components/market/buy-sheet";
import { ListSheet } from "@/components/market/list-sheet";
import { ListingPanel } from "@/components/market/listing-panel";
import { SchedulePanel } from "@/components/schedule/schedule-panel";
import { ScheduleSheet } from "@/components/schedule/schedule-sheet";
import { Button, buttonVariants } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Callout, Skeleton } from "@/components/ui/primitives";
import { useWallet } from "@/components/wallet/wallet-provider";
import { IS_SIMULATED, LEND_CONTRACT, MARKET_CONTRACT, SCHEDULE_CONTRACT, SWITCH_CONTRACT } from "@/lib/config";
import { useContractFacts, useListing, useLoan, useNow, useObservation, useSchedule, useSwitch, useVault, useWithdrawals } from "@/lib/vault/hooks";
import { formatDate, formatUsd, nsToMs, shortAccount, vaultNumber } from "@/lib/vault/format";
import { fiveQuestions, isSealed, observedUsd, vaultReport, vaultStatus } from "@/lib/vault/report";
import { Activity } from "./activity";
import { AttackLab } from "./attack-lab";
import { BreakSealSheet } from "./break-seal-sheet";
import { FiveQuestions } from "./five-questions";
import { FundSheet } from "./fund-sheet";
import { ReceivedMoment, useJustReceived } from "./received-moment";
import { RecipientChecklist } from "./recipient-checklist";
import { SealPanel } from "./seal-panel";
import { SlotCard, SlotCardSkeleton } from "./slot-card";
import { CustodyRail, HoldingsRail, RulesRail, VerifyRail } from "./tab-rail";
import { TechnicalDetails } from "./technical-details";
import { TransferSheet } from "./transfer-sheet";
import { VaultCard } from "./vault-card";
import { VaultStatusBadge } from "./vault-status-badge";
import { WithdrawSheet } from "./withdraw-sheet";
import { WithdrawalsList } from "./withdrawals-list";

type SheetName = "transfer" | "break" | "withdraw" | "fund" | "list" | "buy" | "schedule" | "borrow" | "lend" | "switch";

/** The page below the card, one tab at a time. Each tab has a link: /v/1#attack-lab opens that tab. */
const TABS = [
  { id: "overview", label: "Overview", icon: ShieldCheck },
  { id: "inside", label: "Inside", icon: Coins },
  { id: "history", label: "History", icon: History },
  { id: "attack-lab", label: "Attack lab", icon: Swords },
  { id: "technical", label: "Technical", icon: Code },
] as const;
type TabId = (typeof TABS)[number]["id"];

/** A tab's content, and beside it on wide screens a column that sums it up. */
const TAB_GRID = "mt-7 grid grid-cols-[minmax(0,1fr)] items-start gap-7 focus-visible:outline-none lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]";

function Rail({ children }: { children: ReactNode }) {
  return <aside className="flex flex-col gap-5 lg:sticky lg:top-24">{children}</aside>;
}

function tabFromHash(): TabId | null {
  const h = window.location.hash.slice(1);
  return TABS.find((t) => t.id === h)?.id ?? null;
}

/** The open tab, kept in the URL's fragment so a link (or the back of a shared link) opens it. */
function useHashTab(loaded: boolean) {
  // The tabs render only once the vault has loaded, after hydration, so reading the URL here is safe.
  const [tab, setTab] = useState<TabId>(() => (typeof window === "undefined" ? null : tabFromHash()) ?? "overview");
  const tabsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loaded) return;
    if (tabFromHash()) tabsRef.current?.scrollIntoView({ block: "start" });
    const onHash = () => {
      const t = tabFromHash();
      if (!t) return;
      setTab(t);
      tabsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [loaded]);

  // On a phone the tab bar scrolls sideways: keep the open tab in sight.
  useEffect(() => {
    const list = tabsRef.current?.querySelector<HTMLElement>("[role=tablist]");
    const active = list?.querySelector<HTMLElement>("[data-state=active]");
    if (!list || !active) return;
    const right = active.offsetLeft + active.offsetWidth;
    if (right > list.scrollLeft + list.clientWidth) list.scrollLeft = right - list.clientWidth;
    else if (active.offsetLeft < list.scrollLeft) list.scrollLeft = active.offsetLeft;
  }, [tab, loaded]);

  function selectTab(t: TabId) {
    setTab(t);
    const { pathname, search } = window.location;
    history.replaceState(history.state, "", t === "overview" ? pathname + search : `${pathname}${search}#${t}`);
  }

  function openTab(t: TabId) {
    selectTab(t);
    tabsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return { tab, selectTab, openTab, tabsRef };
}

export function VaultDetailView() {
  const { id } = useParams<{ id: string }>();
  const handover = useSearchParams().get("handover") === "1";
  const query = useVault(id);
  const vault = query.data;
  const obs = useObservation(vault);
  const withdrawals = useWithdrawals(id);
  const listingQuery = useListing(id);
  const scheduleQuery = useSchedule(id);
  const loanQuery = useLoan(id);
  const switchQuery = useSwitch(id);
  const facts = useContractFacts();
  const now = useNow(1000);
  const { accountId, ready, openConnect } = useWallet();
  const [sheet, setSheet] = useState<SheetName | null>(null);
  // The listing being bought, kept so the success screen survives the listing's removal.
  const [buying, setBuying] = useState<MarketListing | null>(null);
  // Likewise the loan being funded: the lender sees the terms they agreed to, even as the loan changes.
  const [lending, setLending] = useState<VaultLoan | null>(null);
  const received = useJustReceived(query.data, ready ? accountId : null);
  const { tab, selectTab, openTab, tabsRef } = useHashTab(!!query.data && !!now);

  if (query.isPending || !now) return <VaultDetailSkeleton />;
  if (query.isError) return <Shell><ErrorState error={query.error} onRetry={() => void query.refetch()} /></Shell>;
  if (!vault) {
    return (
      <Shell>
        <EmptyState seal="opened" title={`There's no vault ${vaultNumber(id)}`}>
          <p>Check the number or link and try again.</p>
          <VerifyForm className="mt-6 text-left" label="Vault number or link" />
        </EmptyState>
      </Shell>
    );
  }

  const sealed = isSealed(vault);
  const isOwner = ready && accountId === vault.owner_id;
  const wasOwner = ready && !!accountId && !isOwner && vault.custody.some((c) => c.account_id === accountId);
  const observations = obs.data;
  const report = vaultReport(vault, observations, facts.data ?? { locked: null, fullAccessKeys: null, codeHash: null, simulated: false });
  const status = vaultStatus(vault, withdrawals.data, observations);
  const value = observedUsd(observations);
  const pending = observations?.some((o) => o.pending !== "0");
  const handedAt = vault.custody.at(-1);
  const listing = listingQuery.data ?? null;
  const inEscrow = !!listing && vault.owner_id === MARKET_CONTRACT;
  const scheduled = scheduleQuery.data ?? null;
  const inSchedule = !!scheduled && vault.owner_id === SCHEDULE_CONTRACT;
  const loan = loanQuery.data ?? null;
  const pledged = !!loan && vault.owner_id === LEND_CONTRACT;
  const sw = switchQuery.data ?? null;
  const inSwitch = !!sw && vault.owner_id === SWITCH_CONTRACT;
  const escrowed = inEscrow || inSchedule || pledged || inSwitch;

  return (
    <Shell>
      {wasOwner && handedAt && !(inEscrow && listing.seller === accountId) && !(inSchedule && scheduled.giver === accountId) && !(pledged && loan.borrower === accountId) && !(inSwitch && sw.owner === accountId) ? (
        <Callout tone="warn" icon={<History />} className="mb-8">
          <p className="font-medium text-fg">
            You handed this vault to {shortAccount(vault.owner_id)} on {formatDate(nsToMs(handedAt.since_ns))}. You can&apos;t withdraw from it.
          </p>
          <p className="mt-0.5 text-fg-2">
            Want to see what happens if you try?{" "}
            <button type="button" onClick={() => openTab("attack-lab")} className="font-medium text-accent hover:underline">
              {IS_SIMULATED ? "Run it in the attack lab" : "See the real attempts in the attack lab"}
            </button>
            .
          </p>
        </Callout>
      ) : null}
      {!isOwner && !wasOwner ? (
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-line bg-surface px-4 py-3 text-[13.5px] text-fg-2">
          <span className="inline-flex items-center gap-2">
            <Eye aria-hidden className="size-4" />
            Public vault page. Anyone with this link sees the same checks.
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
        <Link href={isOwner ? "/vaults" : "/verify"} className="text-fg-2 hover:text-fg">
          {isOwner ? "My vaults" : "Verify"}
        </Link>
        <span aria-hidden>/</span>
        <span aria-current="page" className="truncate text-fg">
          {vault.name ?? `Vault ${vault.token_id}`}
        </span>
      </nav>

      <section className="mt-7 grid items-center gap-10 lg:grid-cols-[380px_minmax(0,1fr)] lg:gap-12">
        <div className="mx-auto w-full max-w-[380px]">
          <VaultCard vault={vault} valueUsd={observations ? value : null} />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <VaultStatusBadge status={status} />
            <span className="font-mono text-[13px] text-fg-3">{vaultNumber(vault.token_id)}</span>
            {isOwner ? <span className="text-[13px] text-fg-3">· You hold this vault</span> : null}
          </div>
          <h1 className="text-balance mt-3.5 text-[clamp(32px,4vw,44px)] font-semibold leading-[1.05] tracking-[-0.04em]">
            {vault.name ?? `Vault ${vault.token_id}`}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13.5px] text-fg-3">
            {inEscrow ? (
              <span className="inline-flex items-center gap-1.5">
                Held by the market for <span className="font-mono text-fg">{listing.seller}</span>
              </span>
            ) : inSchedule ? (
              <span className="inline-flex items-center gap-1.5">
                Scheduled for <span className="font-mono text-fg">{scheduled.recipient}</span>
              </span>
            ) : pledged ? (
              <span className="inline-flex items-center gap-1.5">
                Pledged for a loan by <span className="font-mono text-fg">{loan.borrower}</span>
              </span>
            ) : inSwitch ? (
              <span className="inline-flex items-center gap-1.5">
                In a switch set by <span className="font-mono text-fg">{sw.owner}</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                Owner <span className="font-mono text-fg" title={vault.owner_id}>{shortAccount(vault.owner_id)}</span>
                <CopyButton value={vault.owner_id} label="Copy owner account" size="sm" />
              </span>
            )}
            <span>Created {formatDate(nsToMs(vault.created_at_ns))}</span>
          </div>

          <div className="mt-6">
            <p className="text-[13px] text-fg-3">Observed value, at mainnet prices</p>
            <div className="mt-1.5 flex items-baseline gap-2.5">
              {observations ? (
                <span className="tabular text-[clamp(40px,5vw,52px)] font-semibold leading-none tracking-[-0.04em]">{formatUsd(value)}</span>
              ) : (
                <Skeleton className="h-[52px] w-48" />
              )}
              <span className="text-[15px] text-fg-3">est.</span>
            </div>
            <p className="mt-2 text-[13.5px] text-fg-2">
              {IS_SIMULATED
                ? "Simulated balances, priced as if they were real."
                : "Testnet coins have no value: this is what they'd be worth at mainnet prices, from public data."}
              {pending ? <span className="text-info"> A deposit is pending.</span> : null}
            </p>
          </div>

          {isOwner ? (
            <div className="mt-7 flex flex-wrap gap-2.5">
              {sealed ? (
                <>
                  <Button variant="primary" onClick={() => setSheet("transfer")}>
                    <Send className="size-4" />
                    Transfer
                  </Button>
                  {SCHEDULE_CONTRACT ? (
                    <Button onClick={() => setSheet("schedule")} disabled={!vault.keys}>
                      <CalendarClock className="size-4" />
                      Schedule a handover
                    </Button>
                  ) : null}
                  {MARKET_CONTRACT ? (
                    <Button onClick={() => setSheet("list")} disabled={!vault.keys}>
                      <Store className="size-4" />
                      List for sale
                    </Button>
                  ) : null}
                  {LEND_CONTRACT ? (
                    <Button onClick={() => setSheet("borrow")} disabled={!vault.keys}>
                      <HandCoins className="size-4" />
                      Borrow against it
                    </Button>
                  ) : null}
                  {SWITCH_CONTRACT ? (
                    <Button onClick={() => setSheet("switch")} disabled={!vault.keys}>
                      <Hourglass className="size-4" />
                      If I go quiet
                    </Button>
                  ) : null}
                  <Button onClick={() => setSheet("fund")}>
                    <ArrowDownLeft className="size-4" />
                    Deposit
                  </Button>
                  <Button onClick={() => setSheet("break")} disabled={!observations || !vault.keys}>
                    <PackageOpen className="size-4" />
                    Break the seal
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="primary" onClick={() => setSheet("withdraw")} disabled={!observations}>
                    <ArrowUpRight className="size-4" />
                    Withdraw
                  </Button>
                  <Button onClick={() => setSheet("fund")}>
                    <ArrowDownLeft className="size-4" />
                    Deposit
                  </Button>
                </>
              )}
            </div>
          ) : null}
          {inSchedule ? (
            <SchedulePanel schedule={scheduled} viewer={ready ? accountId : null} now={now} onConnect={() => openConnect()} />
          ) : null}
          {pledged ? (
            <LoanPanel
              loan={loan}
              viewer={ready ? accountId : null}
              now={now}
              onFund={() => {
                setLending(loan);
                setSheet("lend");
              }}
              onConnect={() => openConnect()}
            />
          ) : null}
          {inSwitch ? <SwitchPanel sw={sw} viewer={ready ? accountId : null} now={now} onConnect={() => openConnect()} /> : null}
          {inEscrow ? (
            <ListingPanel
              listing={listing}
              viewer={ready ? accountId : null}
              now={now}
              onBuy={() => {
                setBuying(listing);
                setSheet("buy");
              }}
              onConnect={() => openConnect()}
            />
          ) : null}
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
            {sealed && !escrowed ? (
              <Link
                href={`/v/${vault.token_id}/handover`}
                className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-fg-2 transition-colors hover:text-fg"
              >
                <Presentation className="size-4" />
                Hand it over in person
              </Link>
            ) : null}
            <Link
              href={`/v/${vault.token_id}/certificate`}
              className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-fg-2 transition-colors hover:text-fg"
            >
              <ScrollText className="size-4" />
              Print a bearer certificate
            </Link>
          </div>
          {isOwner && !vault.keys ? (
            <p className="mt-3 text-[12.5px] text-fg-3" aria-live="polite">
              Waiting for NEAR&apos;s signer to derive this vault&apos;s keys…
            </p>
          ) : null}
        </div>
      </section>

      {handover && !isOwner ? <RecipientChecklist vault={vault} viewer={accountId} /> : null}

      <Tabs.Root value={tab} onValueChange={(t) => selectTab(t as TabId)} className="mt-10">
        <div ref={tabsRef} className="scroll-mt-24 border-b border-line">
          <Tabs.List aria-label="About this vault" className="relative -mb-px flex gap-1 overflow-x-auto [scrollbar-width:none]">
            {TABS.map((t) => (
              <Tabs.Trigger
                key={t.id}
                value={t.id}
                className="inline-flex h-11 shrink-0 items-center gap-2 border-b-2 border-transparent px-3 text-[14px] text-fg-2 transition-colors hover:text-fg data-[state=active]:border-accent data-[state=active]:font-medium data-[state=active]:text-fg"
              >
                <t.icon aria-hidden className="hidden size-4 sm:block" />
                {t.label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </div>

        <Tabs.Content value="overview" className="mt-7 focus-visible:outline-none">
          <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_380px]">
            <SealPanel
              tokenId={vault.token_id}
              owner={vault.owner_id}
              report={report}
              now={now}
              checkedAt={obs.dataUpdatedAt}
              onRecheck={() => {
                void query.refetch();
                void obs.refetch();
              }}
              rechecking={query.isFetching || obs.isFetching}
            />
            <div className="lg:sticky lg:top-24">
              <FiveQuestions
                stacked
                answers={fiveQuestions(
                  vault,
                  observations,
                  accountId,
                  inSchedule
                    ? { kind: "schedule", giver: scheduled.giver, recipient: scheduled.recipient }
                    : inEscrow
                      ? { kind: "market", seller: listing.seller }
                      : pledged
                        ? { kind: "loan", borrower: loan.borrower, lender: lenderOf(loan) }
                        : inSwitch
                          ? { kind: "switch", owner: sw.owner, beneficiary: sw.beneficiary }
                          : null,
                )}
              />
            </div>
          </div>
        </Tabs.Content>

        <Tabs.Content value="inside" className={TAB_GRID}>
          <div className="min-w-0">
            <h2 className="text-[20px] font-semibold tracking-[-0.02em]">Inside this vault</h2>
            <div className="mt-4 flex flex-col gap-3">
              {observations
                ? observations.map((o) => <SlotCard key={o.chain} obs={o} now={now} opened={!sealed} />)
                : [0, 1, 2].map((i) => <SlotCardSkeleton key={i} />)}
            </div>

            {!sealed || (withdrawals.data?.length ?? 0) > 0 ? (
              <>
                <h2 className="mt-11 text-[20px] font-semibold tracking-[-0.02em]">Withdrawals</h2>
                <div className="mt-4">
                  <WithdrawalsList tokenId={vault.token_id} withdrawals={withdrawals.data ?? []} now={now} />
                </div>
              </>
            ) : null}
          </div>
          <Rail>
            <HoldingsRail observations={observations} />
          </Rail>
        </Tabs.Content>

        <Tabs.Content value="history" className={TAB_GRID}>
          <div className="min-w-0">
            <h2 className="sr-only">History</h2>
            <Activity vault={vault} withdrawals={withdrawals.data ?? []} observations={observations} now={now} />
          </div>
          <Rail>
            <CustodyRail vault={vault} />
          </Rail>
        </Tabs.Content>

        <Tabs.Content value="attack-lab" className={TAB_GRID}>
          <div className="min-w-0">
            <AttackLab vault={vault} />
          </div>
          <Rail>
            <RulesRail vault={vault} facts={facts.data} />
          </Rail>
        </Tabs.Content>

        <Tabs.Content value="technical" className={TAB_GRID}>
          <div className="min-w-0">
            <TechnicalDetails vault={vault} facts={facts.data} />
          </div>
          <Rail>
            <VerifyRail vault={vault} />
          </Rail>
        </Tabs.Content>
      </Tabs.Root>

      {!isOwner && ready && !accountId ? (
        <p className="mt-10 text-center text-[13.5px] text-fg-3">
          Own this vault?{" "}
          <button type="button" onClick={() => openConnect()} className={buttonVariants({ variant: "link" })}>
            Connect your wallet
          </button>{" "}
          to manage it.
        </p>
      ) : null}

      <ReceivedMoment
        vault={vault}
        observations={observations}
        open={received.show}
        onDone={received.dismiss}
        onHandOn={() => {
          received.dismiss();
          setSheet("transfer");
        }}
      />

      {accountId && (isOwner || sheet === "transfer") ? (
        // Stays mounted after a transfer so its success screen survives the owner change.
        <TransferSheet
          open={sheet === "transfer"}
          onOpenChange={(o) => setSheet(o ? "transfer" : null)}
          vault={vault}
          observations={observations}
          signer={accountId}
        />
      ) : null}
      {accountId && observations && (isOwner || sheet === "break") ? (
        <BreakSealSheet
          open={sheet === "break"}
          onOpenChange={(o) => setSheet(o ? "break" : null)}
          vault={vault}
          observations={observations}
          signer={accountId}
        />
      ) : null}
      {isOwner && accountId && observations ? (
        <WithdrawSheet
          open={sheet === "withdraw"}
          onOpenChange={(o) => setSheet(o ? "withdraw" : null)}
          vault={vault}
          observations={observations}
          signer={accountId}
        />
      ) : null}
      {accountId && (isOwner || sheet === "schedule") ? (
        // Stays mounted after scheduling so its success screen survives the move to the schedule.
        <ScheduleSheet open={sheet === "schedule"} onOpenChange={(o) => setSheet(o ? "schedule" : null)} vault={vault} signer={accountId} />
      ) : null}
      {accountId && (isOwner || sheet === "list") ? (
        // Stays mounted after listing so its success screen survives the move to the market.
        <ListSheet open={sheet === "list"} onOpenChange={(o) => setSheet(o ? "list" : null)} vault={vault} signer={accountId} />
      ) : null}
      {accountId && (isOwner || sheet === "borrow") ? (
        // Stays mounted after pledging so its success screen survives the move to the lending contract.
        <BorrowSheet open={sheet === "borrow"} onOpenChange={(o) => setSheet(o ? "borrow" : null)} vault={vault} signer={accountId} />
      ) : null}
      {accountId && (isOwner || sheet === "switch") ? (
        // Stays mounted after arming so its success screen survives the move to the switch.
        <SwitchSheet open={sheet === "switch"} onOpenChange={(o) => setSheet(o ? "switch" : null)} vault={vault} signer={accountId} />
      ) : null}
      {accountId && lending ? (
        <LendSheet
          open={sheet === "lend"}
          onOpenChange={(o) => {
            setSheet(o ? "lend" : null);
            if (!o) setLending(null);
          }}
          vault={vault}
          loan={lending}
          observations={observations}
          signer={accountId}
        />
      ) : null}
      {accountId && buying ? (
        <BuySheet
          open={sheet === "buy"}
          onOpenChange={(o) => {
            setSheet(o ? "buy" : null);
            if (!o) setBuying(null);
          }}
          vault={vault}
          listing={buying}
          observations={observations}
          signer={accountId}
        />
      ) : null}
      {isOwner ? (
        <FundSheet
          open={sheet === "fund"}
          onOpenChange={(o) => setSheet(o ? "fund" : null)}
          tokenId={vault.token_id}
          observations={observations}
          opened={!sealed}
        />
      ) : null}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-[1200px] px-5 pb-8 pt-8 md:px-8 md:pt-10">{children}</div>;
}

export function VaultDetailSkeleton() {
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
            <Skeleton className="h-11 w-28" />
          </div>
        </div>
      </div>
      <Skeleton className="mt-10 h-36 rounded-panel" />
      <span className="sr-only" role="status">
        Loading vault…
      </span>
    </Shell>
  );
}
