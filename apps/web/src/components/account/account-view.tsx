"use client";

import type { AccountEvent } from "@bearer/sdk";
import { ArrowUpRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { EmptyState, ErrorState } from "@/components/layout/page-states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { useWallet } from "@/components/wallet/wallet-provider";
import { IS_SIMULATED } from "@/lib/config";
import { errorCopy } from "@/lib/vault/errors";
import { formatNear, nsToMs, relativeTime, vaultNumber } from "@/lib/vault/format";
import { useAccountActivity, useListings, useMarketBalances, useMarketPayout, useNow, useVault } from "@/lib/vault/hooks";
import { eventCopy } from "@/lib/vault/notifications";
import { cn } from "@/lib/utils";

const nearblocksTx = (hash: string) => `https://testnet.nearblocks.io/txns/${hash}`;

/** The connected account's selling, sales, payouts and everything that happened to its vaults. */
export function AccountView() {
  const { accountId, ready, openConnect } = useWallet();
  const activity = useAccountActivity(accountId);
  const balances = useMarketBalances(accountId);
  const listings = useListings();
  const payout = useMarketPayout();
  const now = useNow(30_000);

  if (!ready) {
    return (
      <Frame>
        <Skeleton className="h-28 rounded-panel" />
      </Frame>
    );
  }
  if (!accountId) {
    return (
      <Frame>
        <EmptyState
          title="Connect a wallet to see your account"
          action={
            <Button variant="primary" size="lg" onClick={() => openConnect()}>
              Connect wallet
            </Button>
          }
        >
          What you&apos;ve listed and sold, what you&apos;ve been paid, and every vault handed or scheduled to you.
        </EmptyState>
      </Frame>
    );
  }

  const events = activity.data?.events ?? [];
  const sold = events.filter((e) => e.kind === "sold");
  const bought = events.filter((e) => e.kind === "bought");
  const forSale = (listings.data ?? []).filter((l) => l.seller === accountId);
  const asking = forSale.reduce((n, l) => n + BigInt(l.price), 0n);
  const paidToYou = sold.reduce((n, e) => n + BigInt(e.paidYocto ?? "0"), 0n);
  const claimable = BigInt(balances.data?.claimable ?? "0");
  const deposit = BigInt(balances.data?.deposit ?? "0");

  function collect(kind: "claim" | "deposit") {
    payout.mutate(
      { kind, signer: accountId as string },
      {
        onSuccess: () => toast.success(kind === "claim" ? "Claimed. It's on its way to your account." : "Your listing deposit is on its way back."),
        onError: (e) => toast.error(errorCopy(e)),
      },
    );
  }

  const cell = "min-w-0 px-4 py-4 sm:px-6 sm:py-5";
  const big = "tabular mt-2 text-[22px] font-semibold tracking-[-0.03em] sm:text-[26px]";
  return (
    <Frame
      header={
        <div>
          <h1 className="text-[36px] font-semibold leading-tight tracking-[-0.035em]">Your account</h1>
          <p className="mt-1.5 break-all font-mono text-[14px] text-fg-2">{accountId}</p>
        </div>
      }
    >
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-line bg-line lg:grid-cols-4 [&>div]:bg-surface">
        <div className={cell}>
          <dt className="text-[13px] text-fg-3">For sale now</dt>
          <dd className={big}>{listings.data ? forSale.length : <Skeleton className="h-8 w-10" />}</dd>
          <dd className="mt-0.5 text-[12.5px] text-fg-3">{forSale.length ? `Asking ${formatNear(asking, 3)} in all` : "Nothing listed"}</dd>
        </div>
        <div className={cell}>
          <dt className="text-[13px] text-fg-3">Sold</dt>
          <dd className={big}>{activity.data ? sold.length : <Skeleton className="h-8 w-10" />}</dd>
          <dd className="mt-0.5 text-[12.5px] text-fg-3">{sold.length ? `Paid to you: ${formatNear(paidToYou, 3)}` : "No sales yet"}</dd>
        </div>
        <div className={cell}>
          <dt className="text-[13px] text-fg-3">Waiting to claim</dt>
          <dd className={big}>{balances.data ? formatNear(claimable, 3) : <Skeleton className="h-8 w-24" />}</dd>
          <dd className="mt-1">
            {claimable > 0n ? (
              <Button size="sm" variant="primary" onClick={() => collect("claim")} disabled={payout.isPending}>
                {payout.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                Claim it
              </Button>
            ) : (
              <span className="text-[12.5px] text-fg-3">Every payout reached you</span>
            )}
          </dd>
        </div>
        <div className={cell}>
          <dt className="text-[13px] text-fg-3">Bought</dt>
          <dd className={big}>{activity.data ? bought.length : <Skeleton className="h-8 w-10" />}</dd>
          <dd className="mt-0.5 text-[12.5px] text-fg-3">On the market</dd>
        </div>
      </dl>

      {deposit > 0n ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-panel border border-line bg-surface px-5 py-4">
          <p className="text-[14px] text-fg-2">
            <span className="font-medium text-fg">{formatNear(deposit, 4)}</span> of listing deposit isn&apos;t in use by any listing.
          </p>
          <Button size="sm" onClick={() => collect("deposit")} disabled={payout.isPending}>
            Take it back
          </Button>
        </div>
      ) : null}

      <Section id="for-sale" title="For sale now" note="The market holds these, sealed, until they sell or you delist them.">
        {!listings.data ? (
          <Skeleton className="h-14 rounded-panel" />
        ) : forSale.length ? (
          <Rows>
            {forSale.map((l) => (
              <Row
                key={l.token_id}
                vault={l.token_id}
                main={formatNear(l.price, 4)}
                sub={now ? `Listed ${relativeTime(nsToMs(l.listed_at_ns), now)}` : "Listed"}
                aside={<span className="rounded-full border border-gold/35 bg-gold/10 px-2.5 py-0.5 text-[12px] font-medium text-accent">For sale</span>}
              />
            ))}
          </Rows>
        ) : (
          <Empty>Nothing listed. List a sealed vault from its page.</Empty>
        )}
      </Section>

      <Section id="sales" title="Sales" note="The market sends you the price and your listing deposit as soon as the vault reaches the buyer.">
        {activity.isPending ? (
          <Skeleton className="h-14 rounded-panel" />
        ) : sold.length ? (
          <Rows>
            {sold.map((e) => (
              <Row
                key={e.id}
                vault={e.tokenId}
                main={`To ${e.counterparty}${e.priceYocto ? ` for ${formatNear(e.priceYocto, 4)}` : ""}`}
                sub={
                  <>
                    {now ? relativeTime(e.atMs, now) : ""}
                    {e.paidYocto ? ` · you received ${formatNear(e.paidYocto, 4)}` : ""}
                  </>
                }
                aside={
                  <span className="flex items-center gap-3">
                    <PaidChip paid={Boolean(e.paidYocto)} waiting={claimable > 0n} />
                    {e.tx && !IS_SIMULATED ? (
                      <a href={nearblocksTx(e.tx)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-mono text-[12px] text-accent hover:underline">
                        tx <ArrowUpRight className="size-3" />
                      </a>
                    ) : null}
                  </span>
                }
              />
            ))}
          </Rows>
        ) : (
          <Empty>No sales yet.</Empty>
        )}
      </Section>

      <Section id="history" title="Everything that happened" note="Sales, handovers and schedules involving your vaults, newest first.">
        {activity.isPending ? (
          <Skeleton className="h-24 rounded-panel" />
        ) : activity.isError && !activity.data ? (
          <ErrorState error={activity.error} onRetry={() => void activity.refetch()} />
        ) : events.length ? (
          <Rows>
            {events.map((e) => (
              <HistoryRow key={e.id} event={e} now={now} />
            ))}
          </Rows>
        ) : (
          <Empty>Nothing yet.</Empty>
        )}
        <p className="mt-3 text-[12.5px] text-fg-3">
          {activity.data?.partial ? "Payouts couldn't be read this time, so they may be missing. " : ""}
          {IS_SIMULATED
            ? "Simulated: nothing here happened on a real chain."
            : "Each vault's history comes from its custody log on NEAR testnet; NearBlocks' index says which vaults to read, and when the market paid you."}
        </p>
      </Section>
    </Frame>
  );
}

function PaidChip({ paid, waiting }: { paid: boolean; waiting: boolean }) {
  if (paid) return <span className="rounded-full border border-ok/35 bg-ok/10 px-2.5 py-0.5 text-[12px] font-medium text-ok">Paid</span>;
  return (
    <span className="rounded-full border border-line-strong px-2.5 py-0.5 text-[12px] font-medium text-fg-2">
      {waiting ? "Waiting to claim" : "Payout not indexed yet"}
    </span>
  );
}

function HistoryRow({ event, now }: { event: AccountEvent; now: number }) {
  const { title, body } = eventCopy(event);
  return (
    <li>
      <Link href={`/v/${event.tokenId}`} className="flex items-start justify-between gap-4 px-4 py-3.5 hover:bg-raised">
        <span className="min-w-0">
          <span className="block text-[14px] font-medium">{title}</span>
          <span className="mt-0.5 block text-[13px] leading-snug text-fg-2">{body}</span>
        </span>
        <span className="shrink-0 pt-0.5 text-[12px] text-fg-3">{now ? relativeTime(event.atMs, now) : ""}</span>
      </Link>
    </li>
  );
}

function VaultName({ id }: { id: string }) {
  const vault = useVault(id).data;
  return (
    <span className="min-w-0">
      <span className="block truncate text-[14px] font-medium">{vault?.name ?? `Vault ${vaultNumber(id)}`}</span>
      <span className="block font-mono text-[11.5px] text-fg-3">{vaultNumber(id)}</span>
    </span>
  );
}

function Row({ vault, main, sub, aside }: { vault: string; main: React.ReactNode; sub: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <li className="grid grid-cols-1 items-center gap-x-6 gap-y-1.5 px-4 py-3.5 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]">
      <Link href={`/v/${vault}`} className="hover:underline">
        <VaultName id={vault} />
      </Link>
      <span className="min-w-0">
        <span className="tabular block truncate text-[14px]">{main}</span>
        <span className="block text-[12.5px] text-fg-3">{sub}</span>
      </span>
      {aside ? <span className="justify-self-start sm:justify-self-end">{aside}</span> : null}
    </li>
  );
}

function Rows({ children }: { children: React.ReactNode }) {
  return <ul className="divide-y divide-line overflow-hidden rounded-panel border border-line bg-surface">{children}</ul>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-panel border border-dashed border-line-strong px-5 py-6 text-[14px] text-fg-3">{children}</p>;
}

function Section({ id, title, note, children }: { id: string; title: string; note: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-12">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={id} className="text-[22px] font-semibold tracking-[-0.025em]">
          {title}
        </h2>
        <p className={cn("text-[13px] text-fg-3")}>{note}</p>
      </div>
      {children}
    </section>
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
