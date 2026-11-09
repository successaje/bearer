"use client";

import type { MarketListing } from "@bearer/sdk";
import { Loader2, ShoppingBag, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MARKET_CONTRACT } from "@/lib/config";
import { errorCopy } from "@/lib/vault/errors";
import { formatNear, nsToMs, relativeTime } from "@/lib/vault/format";
import { useDelistVault } from "@/lib/vault/hooks";
import { MarketLock } from "./market-bits";

/** On a listed vault's page: the price, who's selling, and Buy or Delist. */
export function ListingPanel({
  listing,
  viewer,
  now,
  onBuy,
  onConnect,
}: {
  listing: MarketListing;
  /** The connected account, or null. */
  viewer: string | null;
  now: number;
  onBuy: () => void;
  onConnect: () => void;
}) {
  const delist = useDelistVault();
  const isSeller = viewer === listing.seller;
  const settling = listing.state.kind !== "listed";

  return (
    <div className="mt-7 rounded-panel border border-gold/35 bg-gold/[0.05] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-mono text-[11.5px] font-medium uppercase tracking-[0.16em] text-accent">For sale</p>
        <p className="text-[13px] text-fg-3">
          Listed by <span className="font-mono text-fg-2">{listing.seller}</span>
          {now ? `, ${relativeTime(nsToMs(listing.listed_at_ns), now)}` : null}
        </p>
      </div>
      <p className="tabular mt-2 text-[34px] font-semibold leading-none tracking-[-0.035em]">{formatNear(listing.price)}</p>
      <p className="mt-3 text-[13.5px] leading-relaxed text-fg-2">
        Held in escrow by the market contract (<span className="font-mono">{MARKET_CONTRACT}</span>), still sealed. A buyer
        gets the vault before the seller gets paid.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        {settling ? (
          <span className="inline-flex items-center gap-2 text-[14px] text-fg-2" aria-live="polite">
            <Loader2 className="size-4 animate-spin" />
            {listing.state.kind === "selling" ? `Selling to ${listing.state.buyer}…` : "Going back to the seller…"}
          </span>
        ) : isSeller ? (
          <Button
            disabled={delist.isPending}
            onClick={() =>
              delist.mutate(
                { id: listing.token_id, signer: listing.seller },
                { onSuccess: () => toast.success("Delisted. The vault and your listing deposit are back with you."), onError: (e) => toast.error(errorCopy(e)) },
              )
            }
          >
            {delist.isPending ? <Loader2 className="size-4 animate-spin" /> : <Undo2 className="size-4" />}
            {delist.isPending ? "Confirm in your wallet…" : "Delist and take it back"}
          </Button>
        ) : viewer ? (
          <Button variant="primary" onClick={onBuy}>
            <ShoppingBag className="size-4" />
            Buy for {formatNear(listing.price)}
          </Button>
        ) : (
          <Button variant="primary" onClick={onConnect}>
            Connect a wallet to buy
          </Button>
        )}
      </div>
      <div className="mt-4 border-t border-gold/20 pt-3.5">
        <MarketLock compact />
      </div>
    </div>
  );
}
