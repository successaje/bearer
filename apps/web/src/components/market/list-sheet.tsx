"use client";

import type { VaultView } from "@bearer/sdk";
import { ArrowLeft, Loader2, Store } from "lucide-react";
import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { FieldMessage, Input, Label } from "@/components/ui/primitives";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ReviewBlock } from "@/components/vault/transfer-sheet";
import { VaultCard } from "@/components/vault/vault-card";
import { MARKET_CONTRACT } from "@/lib/config";
import { errorCopy } from "@/lib/vault/errors";
import { formatNear, parseNear, vaultNumber } from "@/lib/vault/format";
import { useListVault, useMarketConfig } from "@/lib/vault/hooks";
import { MarketLock } from "./market-bits";

type Step = "price" | "review" | "done";

/** List a sealed vault: a price, then a review of what the market will hold and when you're paid. */
export function ListSheet({
  open,
  onOpenChange,
  vault,
  signer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vault: VaultView;
  signer: string;
}) {
  const [step, setStep] = useState<Step>("price");
  const [price, setPrice] = useState<string | null>(null);
  const config = useMarketConfig();
  const list = useListVault();
  const deposit = config.data ? formatNear(config.data.listing_deposit) : "a small";

  function close(o: boolean) {
    onOpenChange(o);
    if (!o) {
      setStep("price");
      setPrice(null);
    }
  }

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent
        title={step === "done" ? "Listed" : step === "review" ? "Review the listing" : "List it for sale"}
        description={step === "price" ? "The market holds the vault, still sealed, until someone buys it or you take it back." : undefined}
      >
        {step === "price" ? (
          <PriceStep
            initial={price}
            min={config.data?.min_price ?? null}
            onNext={(p) => {
              setPrice(p);
              setStep("review");
            }}
          />
        ) : null}

        {step === "review" && price ? (
          <div className="flex flex-col gap-5">
            <p className="text-[15px]">
              List vault <span className="font-mono">{vaultNumber(vault.token_id)}</span> for{" "}
              <span className="font-semibold">{formatNear(price)}</span>?
            </p>

            <ReviewBlock title="While it's listed" tone="neutral">
              <li>The market contract ({MARKET_CONTRACT}) holds it in escrow. It stays sealed</li>
              <li>Nobody can break the seal or withdraw: not you, and not a buyer until it&apos;s theirs</li>
              <li>You can take it back any time a sale isn&apos;t settling</li>
            </ReviewBlock>

            <ReviewBlock title="When it sells" tone="gold">
              <li>The buyer pays exactly {formatNear(price)}, and the vault moves to them first</li>
              <li>Then you&apos;re paid {formatNear(price)} plus your listing deposit, automatically</li>
              <li>If your payout can&apos;t be delivered, the market keeps it for you to claim</li>
            </ReviewBlock>

            <ReviewBlock title="Listing deposit" tone="neutral">
              <li>
                {deposit} per listing pays for its storage on the market. You get it back when the vault sells or you
                delist it
              </li>
              <li>The first time, your wallet asks for two transactions: the deposit, then the vault</li>
            </ReviewBlock>

            <div className="rounded-[14px] border border-line bg-bg px-3.5 py-3">
              <MarketLock />
            </div>

            <div className="flex flex-col gap-2.5">
              <Button
                variant="primary"
                size="lg"
                disabled={list.isPending}
                onClick={() =>
                  list.mutate(
                    { id: vault.token_id, priceYocto: price, signer },
                    { onSuccess: () => setStep("done"), onError: (e) => toast.error(errorCopy(e)) },
                  )
                }
              >
                {list.isPending ? <Loader2 className="size-4 animate-spin" /> : <Store className="size-4" />}
                {list.isPending ? "Confirm in your wallet…" : `List for ${formatNear(price)}`}
              </Button>
              <Button variant="ghost" onClick={() => setStep("price")} disabled={list.isPending}>
                <ArrowLeft className="size-4" />
                Change the price
              </Button>
            </div>
          </div>
        ) : null}

        {step === "done" && price ? (
          <div className="flex flex-col items-center pt-2 text-center" aria-live="polite">
            <div className="w-[260px] animate-card-flip">
              <VaultCard vault={vault} flippable={false} />
            </div>
            <p className="mt-7 text-[20px] font-semibold tracking-[-0.02em]">Listed for {formatNear(price)}</p>
            <p className="mt-2 max-w-[320px] text-[14.5px] leading-relaxed text-fg-2">
              The market holds it, sealed. When someone buys it you&apos;re paid automatically; until then you can take it
              back from this page.
            </p>
            <div className="mt-7 flex w-full flex-col gap-2.5">
              <Link href="/market" className={buttonVariants({ variant: "primary", size: "lg" })}>
                See it on the market
              </Link>
              <Button size="lg" onClick={() => close(false)}>
                Back to the vault
              </Button>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function PriceStep({ initial, min, onNext }: { initial: string | null; min: string | null; onNext: (yocto: string) => void }) {
  const id = useId();
  const [value, setValue] = useState(initial ? formatNear(initial, 24).replace(/ NEAR$/, "").replace(/,/g, "") : "");
  const [touched, setTouched] = useState(false);
  const yocto = parseNear(value);
  const error = !value.trim()
    ? "Enter a price in NEAR."
    : !yocto
      ? "Use a plain number, like 2 or 0.5."
      : min && BigInt(yocto) < BigInt(min)
        ? `The lowest price is ${formatNear(min)}.`
        : null;

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!error && yocto) onNext(yocto);
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <div>
        <Label htmlFor={id}>Price</Label>
        <div className="relative mt-2">
          <Input
            id={id}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setTouched(true);
            }}
            inputMode="decimal"
            placeholder="2"
            autoComplete="off"
            aria-invalid={touched && error ? true : undefined}
            aria-describedby={`${id}-msg`}
            className="tabular bg-bg pr-16 text-[17px]"
          />
          <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[13px] font-medium text-fg-3">NEAR</span>
        </div>
        <FieldMessage id={`${id}-msg`} tone={touched && error ? "error" : "muted"} aria-live="polite">
          {touched && error ? error : "Buyers pay exactly this. You can't change it later; delist and list again instead."}
        </FieldMessage>
      </div>
      <Button type="submit" variant="primary" size="lg" disabled={!!error}>
        Review the listing
      </Button>
    </form>
  );
}
