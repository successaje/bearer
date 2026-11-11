"use client";

import type { ChainObservation, VaultView } from "@bearer/sdk";
import { Dialog } from "radix-ui";
import { ArrowRight, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { LEND_CONTRACT, MARKET_CONTRACT, SCHEDULE_CONTRACT } from "@/lib/config";
import { formatDate, formatUsd, nsToMs, vaultNumber } from "@/lib/vault/format";
import { isSealed, observedUsd } from "@/lib/vault/report";
import { cn } from "@/lib/utils";
import { VaultCard } from "./vault-card";

const seenKey = (v: VaultView) => `bearer:received:${v.token_id}:${v.custody[v.custody.length - 1]?.since_ns}`;

/** True the first time the new holder opens a vault that was just handed to them. */
export function useJustReceived(vault: VaultView | null | undefined, viewer: string | null) {
  const [show, setShow] = useState(false);
  const latest = vault?.custody[vault.custody.length - 1];
  // A vault coming back from the lending contract to its borrower (repaid, or a request taken back) isn't a hand-over.
  const home = !!LEND_CONTRACT && vault?.custody.at(-2)?.account_id === LEND_CONTRACT && vault?.custody.at(-3)?.account_id === viewer;
  const fresh = !!vault && !!viewer && vault.owner_id === viewer && vault.custody.length > 1 && latest?.account_id === viewer && !home;
  const key = vault && fresh ? seenKey(vault) : null;
  useEffect(() => {
    if (!key) return;
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShow(localStorage.getItem(key) === null);
    } catch {}
  }, [key]);
  const dismiss = () => {
    setShow(false);
    try {
      if (key) localStorage.setItem(key, "1");
    } catch {}
  };
  return { show, dismiss };
}

/**
 * The receiving end of a hand-over: the card arrives, turns to show its newest endorsement
 * ("Held by" the viewer), then turns back. The seal stays intact throughout, on purpose.
 */
export function ReceivedMoment({
  vault,
  observations,
  open,
  onDone,
  onHandOn,
}: {
  vault: VaultView;
  observations: ChainObservation[] | undefined;
  open: boolean;
  onDone: () => void;
  onHandOn: () => void;
}) {
  const [phase, setPhase] = useState<"arrive" | "endorse" | "rest">("arrive");
  const from = vault.custody[vault.custody.length - 2];
  // Bought through the market: name the seller, not the escrow account in between.
  const seller = MARKET_CONTRACT && from?.account_id === MARKET_CONTRACT ? vault.custody[vault.custody.length - 3] : undefined;
  // Handed over on schedule: name the giver, not the escrow account in between.
  const giver = SCHEDULE_CONTRACT && from?.account_id === SCHEDULE_CONTRACT ? vault.custody[vault.custody.length - 3] : undefined;
  // Taken as collateral: name the borrower, not the escrow account in between.
  const borrower = LEND_CONTRACT && from?.account_id === LEND_CONTRACT ? vault.custody[vault.custody.length - 3] : undefined;
  const since = vault.custody[vault.custody.length - 1];
  const sealed = isSealed(vault);
  const value = observations ? observedUsd(observations) : null;

  useEffect(() => {
    if (!open) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPhase("rest");
      return;
    }
    setPhase("arrive");
    const a = setTimeout(() => setPhase("endorse"), 1100);
    const b = setTimeout(() => setPhase("rest"), 3400);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [open]);

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onDone()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[rgb(5_5_8/0.86)] backdrop-blur-md data-[state=open]:animate-fade-in" />
        <Dialog.Content
          data-theme="dark"
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-5 text-[#f4f4f5] outline-none"
        >
          <div aria-hidden className="pointer-events-none absolute left-1/2 top-[38%] size-[620px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(201_162_39/0.22),transparent)]" />
          <div className="relative flex w-full max-w-[520px] flex-col items-center text-center">
            <p className="inline-flex items-center gap-2 font-mono text-[11.5px] uppercase tracking-[0.2em] text-gold-light">
              <Sparkles className="size-3.5" />
              Received · {vaultNumber(vault.token_id)}
            </p>

            <div
              className={cn(
                "mt-8 w-full max-w-[440px] motion-safe:animate-[received-in_1000ms_cubic-bezier(0.2,0.8,0.2,1)_both]",
              )}
            >
              <VaultCard vault={vault} valueUsd={value} flippable={false} flipped={phase === "endorse"} />
            </div>

            <Dialog.Title className="text-balance mt-9 text-[clamp(28px,6vw,40px)] font-semibold leading-[1.05] tracking-[-0.035em]">
              {vault.name ?? `Vault ${vault.token_id}`} <span className="text-white/45">is yours.</span>
            </Dialog.Title>
            <Dialog.Description className="mt-3 max-w-[420px] text-[15px] leading-relaxed text-white/70">
              {from ? (
                <>
                  {seller ? "Bought from " : "From "}
                  <span className="font-mono text-white/90">{(seller ?? giver ?? borrower ?? from).account_id}</span>
                  {seller ? " through the market" : giver ? ", as scheduled," : borrower ? ", for a loan they didn't repay," : null} on {formatDate(nsToMs(since.since_ns))}.{" "}
                </>
              ) : null}
              {sealed
                ? "Still sealed: no signature has ever been requested for it, and only you can break the seal."
                : "It was already opened, so it stays with you."}
            </Dialog.Description>

            <ul className="mt-6 flex flex-wrap justify-center gap-2 text-[12.5px]">
              {[
                "Nothing moved on Bitcoin, Base or Solana",
                sealed ? "0 signatures ever requested" : "Opened · can't change hands",
                value !== null ? `${formatUsd(value)} est. inside` : null,
              ]
                .filter(Boolean)
                .map((t) => (
                  <li key={t} className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.04] px-3 py-1.5 text-white/75">
                    <ShieldCheck className="size-3.5 text-mint" />
                    {t}
                  </li>
                ))}
            </ul>

            <div className="mt-9 flex w-full flex-col gap-2.5 sm:flex-row sm:justify-center">
              <Button variant="primary" size="lg" onClick={onDone}>
                See what&apos;s inside
                <ArrowRight className="size-4" />
              </Button>
              {sealed ? (
                <button
                  type="button"
                  onClick={onHandOn}
                  className="inline-flex h-[52px] items-center justify-center rounded-control border border-white/15 px-6 text-[15px] font-medium text-white/85 transition-colors hover:bg-white/[0.06]"
                >
                  Hand it on
                </button>
              ) : null}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
