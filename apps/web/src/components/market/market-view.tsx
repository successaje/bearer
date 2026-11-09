"use client";

import type { MarketListing } from "@bearer/sdk";
import { ArrowUpRight, History, Repeat, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ChainStack } from "@/components/brand/chain-icon";
import { BearerCard } from "@/components/card/bearer-card";
import { EmptyState, ErrorState } from "@/components/layout/page-states";
import { buttonVariants } from "@/components/ui/button";
import { Eyebrow, SimulatedTag, Skeleton } from "@/components/ui/primitives";
import { IS_SIMULATED, MARKET_CONTRACT, explorer } from "@/lib/config";
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
    <div className="mx-auto max-w-[1200px] px-5 pb-8 pt-14 md:px-8 md:pt-20">
      <div className="max-w-[760px]">
        <div className="flex items-center gap-2.5">
          <Eyebrow>Market</Eyebrow>
          {IS_SIMULATED ? <SimulatedTag /> : null}
        </div>
        <h1 className="text-balance mt-3 text-[clamp(38px,5.4vw,60px)] font-semibold leading-[1.02] tracking-[-0.045em]">
          Sealed vaults, <span className="text-fg-3">for sale.</span>
        </h1>
        <p className="text-pretty mt-5 text-[17px] leading-relaxed text-fg-2">
          Each one is held in escrow by the market contract, still sealed. Pay its price and the vault moves to you
          before the seller is paid; if it can&apos;t move, your money comes back.
        </p>
        {MARKET_CONTRACT ? (
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-fg-3">
            <a
              href={explorer.nearAccount(MARKET_CONTRACT)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono hover:text-fg"
            >
              {MARKET_CONTRACT}
              <ArrowUpRight className="size-3" />
            </a>
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

      <section aria-labelledby="why" className="mt-24">
        <h2 id="why" className="text-[clamp(26px,3vw,34px)] font-semibold tracking-[-0.03em]">
          Why buy the vault, not just the coins
        </h2>
        <p className="mt-3 max-w-[680px] text-[15.5px] leading-relaxed text-fg-2">
          Anyone can already send Bitcoin directly. A vault is worth buying when the package matters:
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <Reason icon={<ShieldCheck />} title="A history you can check">
            No withdrawal has ever been signed for a sealed vault, on any chain, and its custody log names every holder.
            Coins sent directly carry neither.
          </Reason>
          <Reason icon={<Repeat />} title="Made to change hands">
            A prize, a gift or a collectible can be handed on again, still sealed, without anyone moving the coins.
          </Reason>
          <Reason icon={<History />} title="No trust in the seller">
            The contract moves the vault before the seller is paid, at exactly the listed price, and refunds you if it
            can&apos;t.
          </Reason>
        </div>
      </section>

      <section aria-labelledby="before" className="mt-16 rounded-panel border border-line bg-surface p-6 md:p-8">
        <h2 id="before" className="text-[20px] font-semibold tracking-[-0.02em]">
          Before you buy
        </h2>
        <ul className="mt-4 grid gap-x-10 gap-y-3 text-[14.5px] leading-relaxed text-fg-2 md:grid-cols-2">
          <li>Balances are observations from public data, with their source and time. Pending deposits can still fail.</li>
          <li>A dollar figure is an estimate, not a value anyone guarantees.</li>
          <li>Sealed means no withdrawal was ever signed. It doesn&apos;t make the vault risk-free.</li>
          <li>This is a testnet prototype. Neither the Bearer contract nor the market has been audited.</li>
        </ul>
      </section>
    </div>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}

function Reason({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="rounded-panel border border-line bg-surface p-5">
      <span className="inline-flex size-9 items-center justify-center rounded-[10px] bg-gold/12 text-accent [&_svg]:size-[18px]">{icon}</span>
      <p className="mt-4 text-[15.5px] font-semibold">{title}</p>
      <p className="mt-1.5 text-[14px] leading-relaxed text-fg-2">{children}</p>
    </div>
  );
}

function ListingCard({ listing, now }: { listing: MarketListing; now: number }) {
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
