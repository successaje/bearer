"use client";

import { ArrowLeft, Expand, Moon, Send, ShieldCheck, Shrink, Smartphone, Sun } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Halftone } from "@/components/landing/textures";
import { EmptyState, ErrorState } from "@/components/layout/page-states";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { TransferSheet } from "@/components/vault/transfer-sheet";
import { VaultCard } from "@/components/vault/vault-card";
import { useWallet } from "@/components/wallet/wallet-provider";
import { formatUsd, nsToMs, relativeTime, vaultNumber } from "@/lib/vault/format";
import { useNow, useObservation, useVault } from "@/lib/vault/hooks";
import { isSealed, observedUsd } from "@/lib/vault/report";
import { cn } from "@/lib/utils";

/** Keeps the screen on while the vault is being shown, where the browser allows it. */
function useWakeLock() {
  const [awake, setAwake] = useState(false);
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    navigator.wakeLock
      ?.request("screen")
      .then((l) => {
        if (cancelled) return void l.release();
        lock = l;
        setAwake(true);
        l.addEventListener("release", () => setAwake(false));
      })
      .catch(() => setAwake(false));
    return () => {
      cancelled = true;
      void lock?.release();
    };
  }, []);
  return awake;
}

/**
 * Hand-over mode: a stage for giving a vault in person. The recipient scans the QR to check the
 * seal on their own phone; the holder transfers it; this screen notices the new owner on-chain
 * and turns the card over to show the new endorsement.
 */
export function HandoverView() {
  const { id } = useParams<{ id: string }>();
  const query = useVault(id);
  const vault = query.data;
  const obs = useObservation(vault);
  const now = useNow(1000);
  const { accountId, ready, openConnect } = useWallet();
  const awake = useWakeLock();
  const stage = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [openedAt] = useState(() => Date.now());

  // Watch the chain closely while presenting: the hand-over should land on screen within seconds.
  const { refetch } = query;
  useEffect(() => {
    const t = setInterval(() => void refetch(), 2000);
    return () => clearInterval(t);
  }, [refetch]);

  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === stage.current);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  if (query.isPending || !now) return <Stage><Skeleton className="mx-auto mt-16 aspect-[1.586] w-full max-w-[560px] rounded-[24px]" /></Stage>;
  if (query.isError) return <Stage><ErrorState error={query.error} onRetry={() => void query.refetch()} /></Stage>;
  if (!vault) {
    return (
      <Stage>
        <EmptyState seal="opened" title={`There's no vault ${vaultNumber(id)}`} />
      </Stage>
    );
  }

  const sealed = isSealed(vault);
  const latest = vault.custody[vault.custody.length - 1];
  // A new custody entry after this screen opened means the hand-over just happened.
  const handedTo = vault.custody.length > 1 && nsToMs(latest.since_ns) > openedAt ? latest.account_id : null;
  const holder = vault.owner_id;
  const isHolder = ready && accountId === holder;
  const url = `${window.location.origin}/v/${vault.token_id}?handover=1`;
  const value = obs.data ? observedUsd(obs.data) : null;

  function toggleFull() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stage.current?.requestFullscreen?.();
  }

  return (
    <Stage
      ref={stage}
      bar={
        <>
          <Link href={`/v/${vault.token_id}`} className="inline-flex items-center gap-1.5 text-[13px] text-white/60 transition-colors hover:text-white">
            <ArrowLeft className="size-4" />
            Leave hand-over mode
          </Link>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1.5 text-[12px] text-white/45 sm:inline-flex" title={awake ? "This screen stays on while it's open." : "Your browser may dim the screen."}>
              {awake ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
              {awake ? "Screen stays on" : "Screen may dim"}
            </span>
            <button
              type="button"
              onClick={toggleFull}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/15 px-3 text-[12.5px] text-white/75 transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              {full ? <Shrink className="size-3.5" /> : <Expand className="size-3.5" />}
              {full ? "Exit full screen" : "Full screen"}
            </button>
          </div>
        </>
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-16">
        <div className="min-w-0">
          <p className="font-mono text-[11.5px] uppercase tracking-[0.18em] text-gold-light">
            Hand-over · {vaultNumber(vault.token_id)}
          </p>
          <h1 className="text-balance mt-3 text-[clamp(34px,4.6vw,58px)] font-semibold leading-[1.0] tracking-[-0.04em]">
            {handedTo ? (
              <>
                It&apos;s {handedTo}&apos;s now. <span className="text-white/40">Nothing moved on Bitcoin, Base or Solana.</span>
              </>
            ) : sealed ? (
              <>
                {vault.name ?? `Vault ${vault.token_id}`} <span className="text-white/40">is ready to hand over.</span>
              </>
            ) : (
              <>
                {vault.name ?? `Vault ${vault.token_id}`} <span className="text-white/40">is opened. It can&apos;t change hands.</span>
              </>
            )}
          </h1>

          <div className={cn("relative mx-auto mt-10 max-w-[560px] transition-transform duration-700", handedTo && "motion-safe:scale-[1.02]")}>
            <div aria-hidden className="absolute inset-x-[8%] -bottom-8 h-16 rounded-[50%] bg-gold/25 blur-3xl" />
            <VaultCard vault={vault} valueUsd={value} flipped={handedTo ? true : undefined} flippable={!handedTo} />
          </div>

          <Ticker>
            <Live />
            {sealed ? "Unopened · 0 signatures ever requested" : "Opened · can't change hands"}
            <Dot />
            held by <span className="font-mono text-white/85">{holder}</span>
            {value !== null ? (
              <>
                <Dot />
                {formatUsd(value)} est.
              </>
            ) : null}
            <Dot />
            checked {relativeTime(query.dataUpdatedAt || now, now)}
          </Ticker>
        </div>

        <ol className="flex min-w-0 flex-col gap-3">
          <Step n="1" icon={<Smartphone />} title="Check it on your own phone" done={!!handedTo}>
            Scan this. It opens the vault&apos;s public page, read straight from NEAR, so you don&apos;t have to take the
            holder&apos;s word for anything.
            <div className="mt-4 flex items-center gap-4">
              <div className="rounded-[14px] bg-white p-3 shadow-[0_20px_60px_-20px_rgb(201_162_39/0.55)]">
                <QRCodeSVG value={url} size={176} level="M" marginSize={0} className="size-[140px] sm:size-[176px]" role="img" aria-label={`QR code for ${url}`} />
              </div>
              <ul className="flex flex-col gap-1.5 text-[13px] text-white/70">
                <li className="flex items-center gap-1.5">
                  <ShieldCheck className="size-4 text-mint" /> Sealed
                </li>
                <li className="flex items-center gap-1.5">
                  <ShieldCheck className="size-4 text-mint" /> 0 signatures
                </li>
                <li className="flex items-center gap-1.5">
                  <ShieldCheck className="size-4 text-mint" /> Who holds it now
                </li>
              </ul>
            </div>
          </Step>
          <Step n="2" icon={<Send />} title="Say which NEAR account to send it to" done={!!handedTo}>
            Any <span className="font-mono">name.testnet</span> account. The holder types it in and reviews exactly what
            changes hands.
          </Step>
          <Step n="3" icon={<ShieldCheck />} title={handedTo ? `Handed to ${handedTo}` : "The holder transfers it"} done={!!handedTo} last>
            {handedTo ? (
              <>One NEAR transaction. The back of the card now carries the new endorsement.</>
            ) : !sealed ? (
              <>Opened vaults can&apos;t change hands: every signature they produce pays their current owner.</>
            ) : isHolder ? (
              <Button variant="primary" size="lg" className="mt-1 w-full" onClick={() => setSheet(true)}>
                <Send className="size-4" />
                Transfer {vaultNumber(vault.token_id)}
              </Button>
            ) : (
              <>
                Only <span className="font-mono">{holder}</span> can hand this over.{" "}
                {ready && !accountId ? (
                  <button type="button" onClick={() => openConnect()} className="font-medium text-gold-light underline-offset-4 hover:underline">
                    Connect as the holder
                  </button>
                ) : null}
              </>
            )}
          </Step>
        </ol>
      </div>

      {isHolder && accountId ? (
        <TransferSheet open={sheet} onOpenChange={setSheet} vault={vault} observations={obs.data} signer={accountId} />
      ) : null}
      {handedTo ? (
        <div className="mt-12 flex justify-center">
          <Link href={`/v/${vault.token_id}`} className={buttonVariants({ size: "lg" })}>
            See the vault&apos;s page
          </Link>
        </div>
      ) : null}
    </Stage>
  );
}

function Stage({
  ref,
  bar,
  children,
}: {
  ref?: React.Ref<HTMLDivElement>;
  bar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      ref={ref}
      data-theme="dark"
      data-inview="true"
      className="relative isolate min-h-[calc(100dvh-64px)] overflow-hidden bg-ink text-[#f4f4f5] [&:fullscreen]:min-h-dvh"
    >
      <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_30%_35%,rgb(201_162_39/0.16),transparent_70%)]" />
      <Halftone className="-left-40 top-10 -z-10 size-[720px] text-gold/[0.14]" />
      <div className="mx-auto max-w-[1200px] px-5 pb-16 pt-6 md:px-8">
        {bar ? <div className="flex items-center justify-between gap-3">{bar}</div> : null}
        <div className="mt-8 md:mt-12">{children}</div>
      </div>
    </div>
  );
}

function Step({
  n,
  icon,
  title,
  done,
  last,
  children,
}: {
  n: string;
  icon: ReactNode;
  title: string;
  done: boolean;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <li className={cn("relative rounded-[18px] border p-5 transition-colors duration-500", done ? "border-mint/30 bg-mint/[0.05]" : "border-white/10 bg-white/[0.03]", last && !done && "border-gold/30")}>
      <div className="flex items-center gap-3">
        <span className={cn("inline-flex size-8 items-center justify-center rounded-full font-mono text-[12px] font-semibold", done ? "bg-mint text-forest" : "bg-white/10 text-white")}>
          {done ? "✓" : n}
        </span>
        <span aria-hidden className="text-white/45 [&_svg]:size-4">
          {icon}
        </span>
        <h2 className="text-[16px] font-semibold tracking-[-0.01em]">{title}</h2>
      </div>
      <div className="mt-2.5 pl-11 text-[14px] leading-relaxed text-white/65">{children}</div>
    </li>
  );
}

function Ticker({ children }: { children: ReactNode }) {
  return (
    <p aria-live="polite" className="mx-auto mt-10 flex max-w-[560px] flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-[13px] text-white/55">
      {children}
    </p>
  );
}

function Live() {
  return (
    <span className="relative mr-1 inline-flex size-2">
      <span className="absolute inset-0 animate-ping rounded-full bg-mint/70 motion-reduce:animate-none" />
      <span className="relative inline-flex size-2 rounded-full bg-mint" />
    </span>
  );
}

function Dot() {
  return <span aria-hidden className="text-white/25">·</span>;
}
