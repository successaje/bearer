"use client";

import { Check, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ChainStack } from "@/components/brand/chain-icon";
import { Button } from "@/components/ui/button";
import { FieldMessage, Input, Label } from "@/components/ui/primitives";
import { useWallet } from "@/components/wallet/wallet-provider";
import { STORAGE_DEPOSIT_NEAR } from "@/lib/bearer/fees";
import { useCreateCard } from "@/lib/bearer/hooks";
import type { Finish } from "@/lib/bearer/types";
import { cn } from "@/lib/utils";
import { BearerCard, FINISHES, FINISH_ORDER } from "./bearer-card";

const MAX_NAME = 32;

export function CreateView() {
  const router = useRouter();
  const nameId = useId();
  const { accountId, ready, openConnect } = useWallet();
  const [name, setName] = useState("");
  const [finish, setFinish] = useState<Finish>("obsidian");
  const create = useCreateCard();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!accountId) {
      openConnect("Connect a wallet to create a card. It pays the storage deposit and becomes the owner.");
      return;
    }
    create.mutate(
      { name: name.trim(), finish, signer: accountId },
      {
        onSuccess: (card) => {
          toast.success("Card created", { description: "Send coins to its addresses to fill it." });
          router.push(`/c/${card.id}`);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <div className="mx-auto max-w-[1200px] px-5 pb-8 pt-10 md:px-8 md:pt-14">
      <div className="max-w-[640px]">
        <h1 className="text-[clamp(32px,4vw,44px)] font-semibold leading-[1.05] tracking-[-0.04em]">Create a card</h1>
        <p className="mt-3 text-[16px] leading-relaxed text-fg-2">
          One NEAR transaction gives you a card with its own Bitcoin, Base and Solana addresses.
        </p>
      </div>

      <div className="mt-10 grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:gap-16">
        <div className="order-last lg:order-first lg:sticky lg:top-24">
          <div className="relative mx-auto max-w-[520px] py-6">
            <div aria-hidden className="absolute inset-x-0 top-1/2 h-[120%] -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(201_162_39/0.14),transparent)]" />
            <div className="relative">
              <BearerCard name={name.trim() || "Your card"} finish={finish} valueUsd={0} />
            </div>
          </div>
          <p className="mt-2 text-center text-[13px] text-fg-3">Preview. Its number is assigned when it&apos;s created.</p>
        </div>

        <form onSubmit={submit} noValidate className="flex flex-col gap-7">
          <div>
            <div className="flex items-center justify-between">
              <Label htmlFor={nameId}>Name</Label>
              <span className="text-[13px] text-fg-3">Optional</span>
            </div>
            <Input
              id={nameId}
              value={name}
              maxLength={MAX_NAME}
              onChange={(e) => setName(e.target.value)}
              placeholder="Theo's birthday"
              autoComplete="off"
              aria-describedby={`${nameId}-msg`}
              className="mt-2"
            />
            <FieldMessage id={`${nameId}-msg`}>
              Shown on the card. It&apos;s public on NEAR. {name.length}/{MAX_NAME}
            </FieldMessage>
          </div>

          <fieldset>
            <legend className="flex w-full justify-between text-[13.5px] font-medium">
              Finish <span className="font-normal text-fg-2">{FINISHES[finish].label}</span>
            </legend>
            <div role="radiogroup" aria-label="Finish" className="mt-3 grid grid-cols-6 gap-2 sm:gap-3">
              {FINISH_ORDER.map((f) => {
                const on = f === finish;
                return (
                  <button
                    key={f}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={FINISHES[f].label}
                    onClick={() => setFinish(f)}
                    className={cn(
                      "relative aspect-square w-full max-w-14 rounded-full shadow-[inset_0_0_0_1px_rgb(255_255_255/0.14)] transition-[box-shadow,transform] hover:scale-105",
                      on && "ring-2 ring-gold ring-offset-[3px] ring-offset-bg",
                    )}
                    style={{ background: FINISHES[f].swatch }}
                  >
                    {on ? (
                      <Check
                        aria-hidden
                        className={cn("absolute inset-0 m-auto size-4", FINISHES[f].light ? "text-ink" : "text-white")}
                        strokeWidth={3}
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="overflow-hidden rounded-panel border border-line bg-surface">
            <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
              <ChainStack chains={["btc", "evm", "sol"]} ring="var(--surface)" />
              <div className="min-w-0">
                <p className="text-[14px] font-medium">Three addresses, ready to fill</p>
                <p className="mt-0.5 text-[12.5px] text-fg-3">Bitcoin testnet4 · Base Sepolia · Solana devnet</p>
              </div>
            </div>
            <div className="flex items-start justify-between gap-4 px-4 py-3.5">
              <div>
                <p className="text-[14px] font-medium">Storage deposit</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-fg-3">Pays for on-chain storage. Not refundable.</p>
              </div>
              <p className="tabular whitespace-nowrap text-[15px] font-semibold">{STORAGE_DEPOSIT_NEAR} NEAR</p>
            </div>
          </div>

          <div>
            <Button type="submit" variant="primary" size="lg" className="w-full" disabled={create.isPending || !ready}>
              {create.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              {create.isPending
                ? "Creating on NEAR…"
                : accountId
                  ? `Create card · ${STORAGE_DEPOSIT_NEAR} NEAR`
                  : "Connect wallet to create"}
            </Button>
            <p className="mt-3 text-center text-[12.5px] text-fg-3" aria-live="polite">
              {create.isPending ? (
                "Waiting for NEAR to confirm the transaction."
              ) : accountId ? (
                <>
                  Signing as <span className="font-mono text-fg-2">{accountId}</span>
                </>
              ) : (
                "You'll need a NEAR testnet wallet."
              )}
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
