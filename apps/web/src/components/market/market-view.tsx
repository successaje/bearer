"use client";

import type { MarketListing } from "@bearer/sdk";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ChainStack } from "@/components/brand/chain-icon";
import { BearerCard } from "@/components/card/bearer-card";
import { EmptyState, ErrorState } from "@/components/layout/page-states";
import { buttonVariants } from "@/components/ui/button";
import { Eyebrow, SimulatedTag, Skeleton } from "@/components/ui/primitives";
import { IS_SIMULATED, MARKET_CONTRACT } from "@/lib/config";
import { formatNear, formatUsd, nsToMs, relativeTime, vaultNumber } from "@/lib/vault/format";
import { useListings, useNow, useObservation, useVault } from "@/lib/vault/hooks";
import { observedUsd } from "@/lib/vault/report";
import { MarketLock } from "./market-bits";

/** Sealed vaults for sale, each held in escrow by the market contract (docs/features/market.md). */
export function MarketView() {
  const listings = useListings();
  const now = useNow(10_000);
  const items = listings.data ?? [];

  return (
    <div className="mx-auto max-w-[1200px] px-5 pb-20 pt-14 md:px-8 md:pt-20">
      <div className="max-w-[760px]">
        <div className="flex items-center gap-2.5">
          <Eyebrow>Market</Eyebrow>
          {IS_SIMULATED ? <SimulatedTag /> : null}
        </div>
        <h1 className="text-balance mt-3 text-[clamp(38px,5.4vw,60px)] font-semibold leading-[1.02] tracking-[-0.045em]">
          Sealed vaults, <span className="text-fg-3">for sale.</span>
        </h1>
        <p className="text-pretty mt-5 text-[17px] leading-relaxed text-fg-2">
          Held in escrow, still sealed. Pay the price and the vault is yours before the seller is paid.
        </p>
        {MARKET_CONTRACT ? (
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-fg-3">
            <Link href="/market/how" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
              How the market works
              <ArrowRight className="size-3.5" />
            </Link>
            <MarketLock compact />
          </div>
        ) : null}
      </div>

      <section aria-label="Listings" className="mt-10">
        {!MARKET_CONTRACT ? (
          <EmptyState title="No market on this deployment">
            The market sells vaults of <span className="font-mono">bearer.testnet</span>. This site points at another contract.
          </EmptyState>
        ) : listings.isError ? (
          <ErrorState error={listings.error} onRetry={() => void listings.refetch()} />
        ) : listings.isPending ? (
          <Grid>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[380px] rounded-[20px]" />
            ))}
          </Grid>
        ) : items.length === 0 ? (
          <EmptyState
            title="Nothing for sale right now"
            action={
              <Link href="/vaults" className={buttonVariants({ variant: "primary", size: "lg" })}>
                List one of your vaults
              </Link>
            }
          >
            Open a sealed vault you hold and choose List for sale.
          </EmptyState>
        ) : (
          <Grid>
            {items.map((l) => (
              <ListingCard key={l.token_id} listing={l} now={now} />
            ))}
          </Grid>
        )}
      </section>

    </div>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}

export function ListingCard({ listing, now }: { listing: MarketListing; now: number }) {
  const vault = useVault(listing.token_id).data;
  const obs = useObservation(vault).data;
  const name = vault?.name ?? `Vault ${listing.token_id}`;
  const held = (obs ?? []).filter((o) => o.confirmed !== "0" || o.pending !== "0");
  const settling = listing.state.kind !== "listed";

  return (
    <Link
      href={`/v/${listing.token_id}`}
      className="group block rounded-[20px] border border-line bg-surface p-3.5 transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lifted focus-visible:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      {vault ? (
        <BearerCard name={name} id={vault.token_id} finish={vault.finish} seal="monogram" chains={[]} shadow={false} />
      ) : (
        <Skeleton className="aspect-[1.586] w-full rounded-[14px]" />
      )}
      <div className="px-1.5 pb-1 pt-4">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="truncate text-[16px] font-semibold tracking-[-0.01em]">{name}</h3>
          <p className="tabular shrink-0 text-[18px] font-semibold">{formatNear(listing.price)}</p>
        </div>
        <p className="mt-1 text-[12.5px] text-fg-3">
          <span className="font-mono">{vaultNumber(listing.token_id)}</span> · {listing.seller}
          {now ? ` · listed ${relativeTime(nsToMs(listing.listed_at_ns), now)}` : null}
        </p>
        <div className="mt-3.5 flex items-center justify-between gap-3">
          <span className="inline-flex h-6 items-center rounded-full border border-ok/30 bg-ok/10 px-2.5 text-[12px] font-medium text-ok">
            {settling ? "Sale settling" : `Sealed · ${vault?.signatures_requested ?? 0} signatures`}
          </span>
          {held.length ? <ChainStack chains={held.map((o) => o.chain)} ring="var(--surface)" iconClassName="size-[18px]" /> : null}
        </div>
        <p className="mt-2.5 text-[13px] leading-snug text-fg-3">
          {obs ? (
            held.length ? (
              <>
                Observed {formatUsd(observedUsd(obs))} est., confirmed only.
                {held.some((o) => o.pending !== "0") ? <span className="text-info"> A deposit is still pending.</span> : null}
              </>
            ) : (
              "Nothing at its addresses yet."
            )
          ) : (
            "Checking its addresses…"
          )}
        </p>
      </div>
    </Link>
  );
}
