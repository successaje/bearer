"use client";

import type { Finish } from "@bearer/sdk";
import { Check, Loader2, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ChainStack } from "@/components/brand/chain-icon";
import { Button } from "@/components/ui/button";
import { FieldMessage, Input, Label } from "@/components/ui/primitives";
import { useWallet } from "@/components/wallet/wallet-provider";
import { BearerCard, FINISHES, FINISH_ORDER } from "@/components/card/bearer-card";
import { CREATE_DEPOSIT_NEAR } from "@/lib/config";
import { CATEGORIES, nameBytes, nameWith, type Category } from "@/lib/vault/category";
import { useCreateVault } from "@/lib/vault/hooks";
import { cn } from "@/lib/utils";

/** The contract's limit, in UTF-8 bytes (MAX_NAME_LEN): a category's emoji and its space take 4 or 5. */
const MAX_NAME = 32;

export function CreateView() {
  const router = useRouter();
  const nameId = useId();
  const { accountId, ready, openConnect } = useWallet();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<Category | null>(null);
  const [finish, setFinish] = useState<Finish>("obsidian");
  // What's stored: the category's emoji, then the name, which defaults to the category's label.
  const fullName = nameWith(category, name.trim() || (category ? category.label : ""));
  const fits = (title: string, c: Category | null) => nameBytes(nameWith(c, title)) <= MAX_NAME;
  const create = useCreateVault();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!accountId) {
      openConnect("Connect a wallet to create a vault. It pays the storage deposit and becomes the first owner.");
      return;
    }
    create.mutate(
      { name: fullName, finish, signer: accountId },
      {
        onSuccess: (vault) => {
          toast.success("Vault created", {
            description: "Deposit into this vault, then hand it to someone. Nothing moves on these chains when you do.",
          });
          router.push(`/v/${vault.token_id}`);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <div className="mx-auto max-w-[1200px] px-5 pb-8 pt-10 md:px-8 md:pt-14">
      <div className="max-w-[640px]">
        <h1 className="text-[clamp(32px,4vw,44px)] font-semibold leading-[1.05] tracking-[-0.04em]">Create a vault</h1>
        <p className="mt-3 text-[16px] leading-relaxed text-fg-2">
          One NEAR transaction gives you a sealed vault with its own Bitcoin, Base and Solana addresses. Fill it,
          then hand it to someone.
        </p>
      </div>

      <div className="mt-10 grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:gap-16">
        <div className="order-last lg:order-first lg:sticky lg:top-24">
          <div className="relative mx-auto max-w-[520px] py-6">
            <div aria-hidden className="absolute inset-x-0 top-1/2 h-[120%] -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(201_162_39/0.14),transparent)]" />
            <div className="relative">
              <BearerCard name={fullName || "Your vault"} finish={finish} valueUsd={0} />
            </div>
          </div>
          <p className="mt-2 text-center text-[13px] text-fg-3">Preview. Its number is assigned when it&apos;s created.</p>
        </div>

        <form onSubmit={submit} noValidate className="flex flex-col gap-7">
          <fieldset>
            <legend className="flex w-full justify-between text-[13.5px] font-medium">
              What&apos;s it for? <span className="font-normal text-fg-2">{category ? category.blurb : "The classic card"}</span>
            </legend>
            <div role="radiogroup" aria-label="What it's for" className="mt-3 flex flex-wrap gap-2">
              {[null, ...CATEGORIES].map((c) => {
                const on = (c?.id ?? null) === (category?.id ?? null);
                return (
                  <button
                    key={c?.id ?? "classic"}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => {
                      // Keep the name within the limit once the emoji is in front of it.
                      let title = name;
                      while (title && !fits(title, c)) title = Array.from(title).slice(0, -1).join("");
                      setName(title);
                      setCategory(c);
                    }}
                    className={cn(
                      "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13.5px] transition-colors",
                      on ? "border-gold bg-gold/10 text-fg" : "border-line-strong bg-surface text-fg-2 hover:bg-raised hover:text-fg",
                    )}
                  >
                    {c ? <span aria-hidden>{c.emoji}</span> : null}
                    {c ? c.label : "Classic"}
                    {c?.fun ? <span className="rounded-full bg-raised px-1.5 text-[10.5px] font-medium uppercase tracking-wide text-fg-3">fun</span> : null}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div>
            <div className="flex items-center justify-between">
              <Label htmlFor={nameId}>Name</Label>
              <span className="text-[13px] text-fg-3">Optional</span>
            </div>
            <Input
              id={nameId}
              value={name}
              onChange={(e) => {
                // Trim to the contract's byte limit rather than refuse a paste.
                let title = e.target.value;
                while (title && !fits(title, category)) title = Array.from(title).slice(0, -1).join("");
                setName(title);
              }}
              placeholder={category ? category.label : "Theo's birthday"}
              autoComplete="off"
              aria-describedby={`${nameId}-msg`}
              className="mt-2"
            />
            <FieldMessage id={`${nameId}-msg`}>
              Shown on the vault{category ? `, after ${category.emoji}` : ""}. It&apos;s public on NEAR. {nameBytes(fullName)}/{MAX_NAME} bytes
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
            <div className="flex items-start gap-3 border-b border-line px-4 py-3.5">
              <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-ok/12 text-ok">
                <ShieldCheck className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-[14px] font-medium">Sealed from the start</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-fg-3">
                  No withdrawal can be signed until its owner breaks the seal. Until then, it can change hands.
                </p>
              </div>
            </div>
            <div className="flex items-start justify-between gap-4 px-4 py-3.5">
              <div>
                <p className="text-[14px] font-medium">Storage deposit</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-fg-3">
                  Pays for the token, the vault record and its 16-entry custody log. Not refundable.
                </p>
              </div>
              <p className="tabular whitespace-nowrap text-[15px] font-semibold">{CREATE_DEPOSIT_NEAR} NEAR</p>
            </div>
          </div>

          <div>
            <Button type="submit" variant="primary" size="lg" className="w-full" disabled={create.isPending || !ready}>
              {create.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              {create.isPending
                ? "Creating on NEAR…"
                : accountId
                  ? `Create vault · ${CREATE_DEPOSIT_NEAR} NEAR`
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
