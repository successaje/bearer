"use client";

import { Loader2, Lock, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/primitives";
import { useWallet } from "@/components/wallet/wallet-provider";
import { useBuy } from "@/lib/bearer/hooks";
import type { SealReport } from "@/lib/bearer/seal";
import type { Card } from "@/lib/bearer/types";
import { formatUsd } from "@/lib/format";

/**
 * Brief 3.3, Flow E: the buyer commits to the seal version they reviewed.
 * If the card changes while they look, they must review again before buying.
 */
export function BuyPanel({ card, report }: { card: Card; report: SealReport }) {
  const { accountId, openConnect } = useWallet();
  const [reviewedVersion, setReviewedVersion] = useState(card.logVersion);
  const [staleError, setStaleError] = useState(false);
  const buy = useBuy();

  if (!card.listing) return null;
  const changed = reviewedVersion !== card.logVersion || staleError;
  const blocked = report.verdict === "not_transferable";

  function onBuy() {
    if (!accountId) {
      openConnect("Connect a wallet to buy this card.");
      return;
    }
    buy.mutate(
      { id: card.id, buyer: accountId, expectedLogVersion: reviewedVersion },
      {
        onSuccess: () => toast.success("The card is yours", { description: `Paid ${card.listing?.priceNear} NEAR to ${card.owner}.` }),
        onError: (e) => {
          if ("code" in e && e.code === "STALE_SEAL") setStaleError(true);
          else toast.error(e.message);
        },
      },
    );
  }

  return (
    <section
      aria-labelledby="buy-heading"
      className="overflow-hidden rounded-panel border border-gold/30 bg-surface shadow-[0_30px_60px_-36px_rgb(201_162_39/0.35)]"
    >
      <div className="p-6">
        <h2 id="buy-heading" className="text-[13px] text-fg-2">
          Price
        </h2>
        <p className="mt-1.5 flex items-baseline gap-2.5">
          <span className="tabular text-[48px] font-semibold leading-none tracking-[-0.04em]">{card.listing.priceNear}</span>
          <span className="text-[18px] font-medium text-fg-2">NEAR</span>
        </p>
        <p className="mt-2 text-[13px] text-fg-3">Paid to {card.owner} in the same transaction.</p>

        <dl className="tabular mt-5 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2.5 border-t border-line pt-4 text-[14px]">
          <dt className="text-fg-2">Sealed value</dt>
          <dd className="m-0 text-right font-medium">{formatUsd(report.sealedUsd)} est.</dd>
          {report.excludedUsd > 0 ? (
            <>
              <dt className="text-fg-2">Excluded</dt>
              <dd className="m-0 text-right text-warn">{formatUsd(report.excludedUsd)} est.</dd>
            </>
          ) : null}
          <dt className="text-fg-2">Seal version you reviewed</dt>
          <dd className="m-0 text-right font-mono">v{reviewedVersion}</dd>
        </dl>

        {changed ? (
          <Callout tone="warn" icon={<TriangleAlert />} className="mt-5">
            <p className="font-medium text-fg">The card changed since you looked.</p>
            <p className="mt-0.5 text-fg-2">Review the new seal report before buying.</p>
            <Button
              size="sm"
              className="mt-3"
              onClick={() => {
                setReviewedVersion(card.logVersion);
                setStaleError(false);
              }}
            >
              <RefreshCw className="size-3.5" />
              I&apos;ve reviewed v{card.logVersion}
            </Button>
          </Callout>
        ) : null}

        {blocked ? (
          <Callout tone="danger" icon={<TriangleAlert />} className="mt-5">
            {report.detail}
          </Callout>
        ) : null}

        <Button
          variant="primary"
          size="lg"
          className="mt-5 w-full"
          disabled={buy.isPending || changed || blocked}
          onClick={onBuy}
        >
          {buy.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          {buy.isPending ? "Confirm in your wallet…" : `Buy for ${card.listing.priceNear} NEAR`}
        </Button>
        <p className="mt-2.5 text-center text-[12.5px] text-fg-3">
          {accountId ? "You'll confirm in your NEAR wallet." : "You'll connect a NEAR wallet first."}
        </p>
      </div>
      <ul className="flex flex-col gap-3 border-t border-line bg-surface-2 p-5 text-[13.5px] leading-relaxed text-fg-2">
        <li className="flex gap-2.5">
          <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
          If anything on the card changes before your transaction lands, the purchase reverts and you keep your NEAR.
        </li>
        <li className="flex gap-2.5">
          <RefreshCw aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
          One NEAR transaction. No Bitcoin, Base or Solana transaction needed.
        </li>
        <li className="flex gap-2.5">
          <Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
          While it&apos;s listed, the seller can&apos;t sign withdrawals.
        </li>
      </ul>
    </section>
  );
}
