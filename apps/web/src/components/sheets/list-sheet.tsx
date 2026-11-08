"use client";

import { Loader2, Lock, Tag } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Callout, FieldMessage, Input, Label } from "@/components/ui/primitives";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useDelist, useList } from "@/lib/bearer/hooks";
import { cardValueUsd } from "@/lib/bearer/seal";
import type { Card } from "@/lib/bearer/types";
import { formatUsd } from "@/lib/format";

export function ListSheet({
  open,
  onOpenChange,
  card,
  signer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  card: Card;
  signer: string;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title={card.listing ? "Listed for sale" : "List for sale"}
        description={
          card.listing
            ? "Anyone can buy this card from its public page."
            : "Set a fixed price in NEAR. The buyer pays, you get paid and the card moves in one transaction."
        }
      >
        {card.listing ? (
          <Listed card={card} signer={signer} onDone={() => onOpenChange(false)} />
        ) : (
          <ListForm card={card} signer={signer} onDone={() => onOpenChange(false)} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function ListForm({ card, signer, onDone }: { card: Card; signer: string; onDone: () => void }) {
  const id = useId();
  const [price, setPrice] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const list = useList();
  const error = !/^\d+(\.\d{1,4})?$/.test(price.trim()) || Number(price) <= 0 ? "Enter a price in NEAR, like 120." : null;

  function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (error || card.claimLink) return;
    list.mutate(
      { id: card.id, priceNear: price.trim(), signer },
      {
        onSuccess: () => {
          toast.success(`Listed for ${price.trim()} NEAR`);
          onDone();
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      {card.claimLink ? (
        <Callout tone="warn" icon={<Lock />}>
          This card has an open claim link. Cancel it before listing.
        </Callout>
      ) : null}
      <div>
        <Label htmlFor={id}>Price</Label>
        <div className="relative mt-2">
          <Input
            id={id}
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(",", "."))}
            inputMode="decimal"
            placeholder="0"
            autoComplete="off"
            aria-invalid={submitted && error ? true : undefined}
            aria-describedby={`${id}-msg`}
            className="tabular h-14 bg-bg pr-20 text-[22px] font-semibold"
          />
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[15px] text-fg-3">NEAR</span>
        </div>
        <FieldMessage id={`${id}-msg`} tone={submitted && error ? "error" : "muted"}>
          {submitted && error ? error : `Sealed value inside: ${formatUsd(cardValueUsd(card).sealed)} est.`}
        </FieldMessage>
      </div>
      <Callout tone="warn" icon={<Lock />}>
        While listed, this card can&apos;t sign withdrawals. You can delist any time.
      </Callout>
      <Callout tone="neutral" icon={<Tag />}>
        Buyers see the live Seal report. If anything on the card changes before their transaction lands, the purchase
        reverts and they keep their NEAR.
      </Callout>
      <Button type="submit" variant="primary" size="lg" disabled={list.isPending || Boolean(card.claimLink)}>
        {list.isPending ? <Loader2 className="size-4 animate-spin" /> : <Tag className="size-4" />}
        {list.isPending ? "Confirm in your wallet…" : "List card"}
      </Button>
    </form>
  );
}

function Listed({ card, signer, onDone }: { card: Card; signer: string; onDone: () => void }) {
  const delist = useDelist();
  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-[14px] border border-gold/35 bg-gold/[0.07] px-5 py-4">
        <p className="text-[13px] text-fg-2">Price</p>
        <p className="mt-1 flex items-baseline gap-2">
          <span className="tabular text-[40px] font-semibold leading-none tracking-[-0.04em]">{card.listing?.priceNear}</span>
          <span className="text-[17px] text-fg-2">NEAR</span>
        </p>
      </div>
      <p className="text-[14px] leading-relaxed text-fg-2">
        Withdrawals are locked while the card is listed. Delist to open funds or hand the card over directly.
      </p>
      <Button
        size="lg"
        disabled={delist.isPending}
        onClick={() =>
          delist.mutate(
            { id: card.id, signer },
            {
              onSuccess: () => {
                toast.success("Delisted");
                onDone();
              },
              onError: (e) => toast.error(e.message),
            },
          )
        }
      >
        {delist.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
        {delist.isPending ? "Confirm in your wallet…" : "Delist"}
      </Button>
    </div>
  );
}
