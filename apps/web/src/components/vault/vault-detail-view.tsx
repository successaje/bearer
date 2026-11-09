"use client";

import { ArrowDownLeft, ArrowUpRight, Eye, History, Link2, PackageOpen, Presentation, ScrollText, Send } from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState, ErrorState } from "@/components/layout/page-states";
import { VerifyForm } from "@/components/landing/verify-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Callout, Skeleton } from "@/components/ui/primitives";
import { useWallet } from "@/components/wallet/wallet-provider";
import { useContractFacts, useNow, useObservation, useVault, useWithdrawals } from "@/lib/vault/hooks";
import { formatDate, formatUsd, nsToMs, vaultNumber } from "@/lib/vault/format";
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
import { TechnicalDetails } from "./technical-details";
import { TransferSheet } from "./transfer-sheet";
import { VaultCard } from "./vault-card";
import { VaultStatusBadge } from "./vault-status-badge";
import { WithdrawSheet } from "./withdraw-sheet";
import { WithdrawalsList } from "./withdrawals-list";

type SheetName = "transfer" | "break" | "withdraw" | "fund";

export function VaultDetailView() {
  const { id } = useParams<{ id: string }>();
  const handover = useSearchParams().get("handover") === "1";
  const query = useVault(id);
  const vault = query.data;
  const obs = useObservation(vault);
  const withdrawals = useWithdrawals(id);
  const facts = useContractFacts();
  const now = useNow(1000);
  const { accountId, ready, openConnect } = useWallet();
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const received = useJustReceived(query.data, ready ? accountId : null);

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

  return (
    <Shell>
      {wasOwner && handedAt ? (
        <Callout tone="warn" icon={<History />} className="mb-8">
          <p className="font-medium text-fg">
            You handed this vault to {vault.owner_id} on {formatDate(nsToMs(handedAt.since_ns))}. You can&apos;t withdraw from it.
          </p>
          <p className="mt-0.5 text-fg-2">
            Want to see what happens if you try?{" "}
            <a href="#attack-lab" className="font-medium text-accent hover:underline">
              Run it in the attack lab
            </a>
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
            <span className="inline-flex items-center gap-1.5">
              Owner <span className="font-mono text-fg">{vault.owner_id}</span>
              <CopyButton value={vault.owner_id} label="Copy owner account" size="sm" />
            </span>
            <span>Created {formatDate(nsToMs(vault.created_at_ns))}</span>
          </div>

          <div className="mt-6">
            <p className="text-[13px] text-fg-3">Observed value</p>
            <div className="mt-1.5 flex items-baseline gap-2.5">
              {observations ? (
                <span className="tabular text-[clamp(40px,5vw,52px)] font-semibold leading-none tracking-[-0.04em]">{formatUsd(value)}</span>
              ) : (
                <Skeleton className="h-[52px] w-48" />
              )}
              <span className="text-[15px] text-fg-3">est.</span>
            </div>
            <p className="mt-2 text-[13.5px] text-fg-2">
              Across Bitcoin, Base and Solana, from public data.{pending ? <span className="text-info"> A deposit is pending.</span> : null}
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
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
            {sealed ? (
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

      <div className="mt-10">
        <FiveQuestions answers={fiveQuestions(vault, observations, accountId)} />
      </div>

      <div className="my-12 h-px bg-line" />

      <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_380px]">
        <aside className="flex flex-col gap-5 lg:sticky lg:top-24 lg:order-last">
          <SealPanel
            tokenId={vault.token_id}
            report={report}
            now={now}
            checkedAt={obs.dataUpdatedAt}
            onRecheck={() => {
              void query.refetch();
              void obs.refetch();
            }}
            rechecking={query.isFetching || obs.isFetching}
          />
          <div id="attack-lab" className="scroll-mt-24">
            <AttackLab vault={vault} />
          </div>
        </aside>

        <div className="flex min-w-0 flex-col">
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

          <h2 className="mt-11 text-[20px] font-semibold tracking-[-0.02em]">History</h2>
          <div className="mt-4">
            <Activity vault={vault} withdrawals={withdrawals.data ?? []} observations={observations} now={now} />
          </div>

          <div className="mt-11">
            <TechnicalDetails vault={vault} />
          </div>
        </div>
      </div>

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
