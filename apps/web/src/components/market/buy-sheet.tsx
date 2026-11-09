"use client";

import type { ChainObservation, MarketListing, VaultView } from "@bearer/sdk";
import { Check, Loader2, ShoppingBag, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ReviewBlock } from "@/components/vault/transfer-sheet";
import { MARKET_CONTRACT } from "@/lib/config";
import { errorCopy } from "@/lib/vault/errors";
import { formatNear, formatUsd, vaultNumber } from "@/lib/vault/format";
import { useBuyVault, useContractFacts, useMarketFacts, useNow } from "@/lib/vault/hooks";
import { isSealed, observedUsd } from "@/lib/vault/report";
import { ObservedHoldings } from "./market-bits";

/**
 * Buying: what you get (as public data shows it now), the checks that matter, what you pay and
 * in what order money moves, and the risks. Then one transaction.
 */
export function BuySheet({
  open,
  onOpenChange,
  vault,
  listing,
  observations,
  signer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vault: VaultView;
  listing: MarketListing;
  observations: ChainObservation[] | undefined;
  signer: string;
}) {
  const buy = useBuyVault();
  const now = useNow(5000);
  const bearerLocked = useContractFacts().data?.locked ?? null;
  const marketLocked = useMarketFacts().data?.locked ?? null;
  const price = formatNear(listing.price);

  const close = (o: boolean) => onOpenChange(o);

  const checks: [string, boolean | null][] = [
    ["Sealed", isSealed(vault)],
    ["0 signatures ever requested", vault.signatures_requested === 0],
    [`Held by the market for ${listing.seller}`, vault.owner_id === MARKET_CONTRACT],
    ["Bearer contract locked", bearerLocked],
    ["Market contract locked", marketLocked],
  ];

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent title={`Buy for ${price}`} description={`Vault ${vaultNumber(vault.token_id)}, from ${listing.seller}.`}>
        <div className="flex flex-col gap-5">
            <div className="rounded-[14px] border border-gold/35 bg-gold/[0.06] px-4 py-3.5">
              <p className="text-[12px] font-medium uppercase tracking-[0.12em] text-fg-3">You get</p>
              <p className="mt-2 text-[13.5px] leading-relaxed">
                The vault and control of its three addresses. At them now, observed
                {observations ? <span className="text-fg-3"> ({formatUsd(observedUsd(observations))} est.)</span> : null}:
              </p>
              <div className="mt-3">
                <ObservedHoldings observations={observations} now={now} />
              </div>
              <p className="mt-3 text-[12.5px] leading-relaxed text-fg-3">
                Observations, not guarantees: what public data shows right now. Pending deposits can still fail, and
                prices move.
              </p>
            </div>

            <div className="overflow-hidden rounded-[14px] border border-line bg-bg">
              <p className="border-b border-line px-3.5 py-3 text-[13.5px] font-medium">Checked just now</p>
              <ul className="py-1.5 text-[13.5px] text-fg-2">
                {checks.map(([label, ok]) => (
                  <li key={label} className="flex items-center gap-2.5 px-3.5 py-1.5">
                    {ok === null ? (
                      <Loader2 className="size-3.5 animate-spin text-fg-3" aria-label="Checking" />
                    ) : ok ? (
                      <Check className="size-3.5 text-ok" strokeWidth={3} aria-label="Passed" />
                    ) : (
                      <X className="size-3.5 text-danger" strokeWidth={3} aria-label="Not passed" />
                    )}
                    {label}
                  </li>
                ))}
              </ul>
            </div>

            <ReviewBlock title="You pay" tone="neutral">
              <li>Exactly {price}, to the market contract</li>
              <li>The vault moves to you first; the seller is paid only once it has</li>
              <li>If the vault doesn&apos;t move, your {price} comes back and the listing stands</li>
            </ReviewBlock>

            <ReviewBlock title="Sealed isn't risk-free" tone="danger">
              <li>This is a testnet prototype. Neither contract has been audited</li>
              <li>Sealed means no withdrawal was ever signed. It doesn&apos;t say what the coins are worth</li>
              {marketLocked === false ? (
                <li>The market contract isn&apos;t locked yet: whoever holds its key could act as this vault&apos;s owner until it&apos;s yours</li>
              ) : null}
            </ReviewBlock>

            <Button
              variant="primary"
              size="lg"
              disabled={buy.isPending}
              onClick={() =>
                buy.mutate(
                  { id: vault.token_id, priceYocto: listing.price, signer },
                  {
                    // The vault page's "received" moment takes over once the vault is the buyer's.
                    onSuccess: () => close(false),
                    onError: (e) => toast.error(errorCopy(e)),
                  },
                )
              }
            >
              {buy.isPending ? <Loader2 className="size-4 animate-spin" /> : <ShoppingBag className="size-4" />}
              {buy.isPending ? "Confirm, then settling…" : `Pay ${price}`}
            </Button>
            <p className="text-center text-[12.5px] text-fg-3">One NEAR transaction. Settlement takes a few seconds.</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
