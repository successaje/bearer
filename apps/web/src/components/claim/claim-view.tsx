"use client";

import { ArrowLeft, Check, Copy, Eye, EyeOff, Loader2, Lock, ShieldCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ChainIcon } from "@/components/brand/chain-icon";
import { BearerCard } from "@/components/card/bearer-card";
import { EmptyState, ErrorState } from "@/components/layout/page-states";
import { Button, buttonVariants } from "@/components/ui/button";
import { Callout, FieldMessage, Input, Label, SimulatedTag, Skeleton } from "@/components/ui/primitives";
import { useWallet } from "@/components/wallet/wallet-provider";
import { useAccountExists, useClaim, useClaimLookup, useCreateAccountAndClaim, useNow } from "@/lib/bearer/hooks";
import { DEMO_CLAIM_KEY, RECOVERY_WORDS } from "@/lib/bearer/mock-data";
import { computeSealReport, slotTotals } from "@/lib/bearer/seal";
import { CHAINS, type Card } from "@/lib/bearer/types";
import { IS_SIMULATED, NEAR_ACCOUNT_SUFFIX } from "@/lib/config";
import { CHAIN_META, formatAmount, formatUsd } from "@/lib/format";
import { validateNewAccountName } from "@/lib/validation";
import { cn } from "@/lib/utils";
import { Confetti } from "./confetti";

type Phase = "choose" | "name" | "words" | "done";

export function ClaimView() {
  // The key lives in the URL fragment so it never reaches a server (brief 3.3, Flow C).
  const [key, setKey] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const fragment = window.location.hash.slice(1);
    if (fragment) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setKey(fragment);
      history.replaceState(null, "", window.location.pathname);
    } else {
      // Keep a key already read: effects can run twice, and the first run cleared the address bar.
      setKey((prev) => prev ?? null);
    }
  }, []);

  if (key === undefined) return <Frame><ClaimSkeleton /></Frame>;
  if (key === null) return <Frame><MissingKey onDemo={() => setKey(DEMO_CLAIM_KEY)} /></Frame>;
  return <ClaimFlow claimKey={key} />;
}

function ClaimFlow({ claimKey }: { claimKey: string }) {
  const lookup = useClaimLookup(claimKey);
  const [phase, setPhase] = useState<Phase>("choose");
  const [claimed, setClaimed] = useState<{ card: Card; owner: string } | null>(null);

  if (claimed) return <Frame><Success card={claimed.card} owner={claimed.owner} /></Frame>;
  if (lookup.isPending) return <Frame><ClaimSkeleton /></Frame>;
  if (lookup.isError) return <Frame><ErrorState error={new Error("We couldn't reach NEAR testnet. Your link still works; try again in a moment.")} onRetry={() => void lookup.refetch()} /></Frame>;

  const result = lookup.data;
  if (result.status === "claimed") {
    return (
      <Frame>
        <EmptyState seal="opened" title="This card was already claimed">
          Ask the sender for a new link.
        </EmptyState>
      </Frame>
    );
  }
  if (result.status === "cancelled") {
    return (
      <Frame>
        <EmptyState seal="opened" title="This link was cancelled">
          The sender cancelled it before anyone claimed the card. Ask them for a new one.
        </EmptyState>
      </Frame>
    );
  }
  if (result.status === "invalid") {
    return (
      <Frame>
        <EmptyState seal="cracked" title="This link isn't valid">
          It may be incomplete or mistyped. Ask the sender to send it again.
        </EmptyState>
      </Frame>
    );
  }

  const onClaimed = (card: Card, owner: string) => setClaimed({ card, owner });

  return (
    <Frame>
      {phase === "choose" ? (
        <Choose card={result.card} from={result.from} claimKey={claimKey} onCreate={() => setPhase("name")} onClaimed={onClaimed} />
      ) : (
        <CreateAccount claimKey={claimKey} card={result.card} phase={phase} setPhase={setPhase} onClaimed={onClaimed} />
      )}
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="relative mx-auto max-w-[520px] px-5 pb-8 pt-10 md:pt-14">{children}</div>;
}

function ClaimSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <Skeleton className="h-7 w-40 rounded-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="mx-auto aspect-[1.586] w-[300px] rounded-[16px]" />
      <Skeleton className="h-24 w-full rounded-panel" />
      <Skeleton className="h-[52px] w-full" />
      <span className="sr-only" role="status">
        Checking your link…
      </span>
    </div>
  );
}

function MissingKey({ onDemo }: { onDemo: () => void }) {
  return (
    <EmptyState
      title="Open the link you were sent"
      action={
        IS_SIMULATED ? (
          <Button variant="primary" size="lg" onClick={onDemo}>
            Try a demo claim link
          </Button>
        ) : (
          <Link href="/" className={buttonVariants({ size: "lg" })}>
            What is Bearer?
          </Link>
        )
      }
    >
      Claim links look like <span className="font-mono text-fg">/claim#…</span>. The part after # is the key, so open the
      whole link exactly as you received it.
    </EmptyState>
  );
}

function CardPreview({ card }: { card: Card }) {
  const totals = slotTotals(card);
  const now = useNow(5000);
  const report = now ? computeSealReport(card, now) : null;
  return (
    <>
      <div className="relative mt-6 flex h-[200px] items-center justify-center">
        <div aria-hidden className="absolute h-[260px] w-[380px] rounded-full bg-[radial-gradient(closest-side,rgb(201_162_39/0.16),transparent)]" />
        <div className="relative w-[300px] -rotate-[2.5deg]">
          <BearerCard name={card.name} id={card.id} finish={card.finish} chains={[]} />
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-panel border border-line bg-surface">
        <div className="flex items-baseline justify-between border-b border-line px-4 py-3">
          <span className="text-[13px] text-fg-3">Inside</span>
          <span className="tabular text-[15px] font-semibold">
            {report ? formatUsd(report.sealedUsd) : "…"} <span className="text-[12px] font-medium text-fg-3">est.</span>
          </span>
        </div>
        <div className="tabular grid grid-cols-3 divide-x divide-line">
          {CHAINS.map((chain) => (
            <div key={chain} className="px-4 py-3">
              <ChainIcon chain={chain} className="size-[18px]" label />
              <p className="mt-1.5 text-[13.5px] font-semibold">{formatAmount(chain, totals[chain].sealed)}</p>
              <p className="text-[11.5px] text-fg-3">{CHAIN_META[chain].asset}</p>
            </div>
          ))}
        </div>
      </div>

      {report ? (
        <Link
          href={`/c/${card.id}`}
          target="_blank"
          className={cn(
            "mt-2.5 flex items-center gap-3 rounded-panel border px-3.5 py-3 transition-colors",
            report.verdict === "not_transferable"
              ? "border-danger/30 bg-danger/[0.06] hover:bg-danger/10"
              : report.verdict === "sealed_with_exclusions"
                ? "border-warn/30 bg-warn/[0.06] hover:bg-warn/10"
                : "border-ok/25 bg-ok/[0.06] hover:bg-ok/10",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "inline-flex size-8 shrink-0 items-center justify-center rounded-full",
              report.verdict === "not_transferable" ? "bg-danger/15 text-danger" : report.verdict === "sealed" ? "bg-ok/15 text-ok" : "bg-warn/15 text-warn",
            )}
          >
            {report.verdict === "sealed" ? <ShieldCheck className="size-4" /> : <TriangleAlert className="size-4" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold">{report.headline}</span>
            <span className="mt-0.5 block text-[12.5px] leading-snug text-fg-2">{report.detail}</span>
          </span>
          <span className="text-[13px] font-medium text-accent">Report</span>
        </Link>
      ) : null}
    </>
  );
}

function Choose({
  card,
  from,
  claimKey,
  onCreate,
  onClaimed,
}: {
  card: Card;
  from: string;
  claimKey: string;
  onCreate: () => void;
  onClaimed: (card: Card, owner: string) => void;
}) {
  const { accountId, openConnect } = useWallet();
  const claim = useClaim();

  function signIn() {
    if (!accountId) {
      openConnect("Sign in with the NEAR account that should receive this card.");
      return;
    }
    claim.mutate(
      { key: claimKey, receiver: accountId },
      { onSuccess: (c) => onClaimed(c, accountId), onError: (e) => toast.error(e.message) },
    );
  }

  return (
    <div>
      <div className="inline-flex h-8 items-center gap-2 rounded-full border border-line-strong bg-surface-2 pl-1 pr-3 text-[13px] text-fg-2">
        <span aria-hidden className="inline-flex size-6 items-center justify-center rounded-full bg-raised text-[11px] font-semibold">
          {from[0].toUpperCase()}
        </span>
        From <span className="font-mono text-fg">{from}</span>
      </div>
      <h1 className="text-balance mt-4 text-[30px] font-semibold leading-[1.12] tracking-[-0.035em]">
        Someone handed you a Bearer card.
      </h1>

      <CardPreview card={card} />

      {accountId === card.owner ? (
        <Callout tone="neutral" icon={<Lock />} className="mt-6">
          You created this link. Send it to the person you want to have the card; it works for whoever opens it first.
        </Callout>
      ) : null}

      <div className="mt-6 flex flex-col gap-2.5">
        <Button variant="primary" size="lg" onClick={signIn} disabled={claim.isPending}>
          {claim.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          {claim.isPending ? "Claiming…" : accountId ? `Claim as ${accountId}` : "Sign in to claim it"}
        </Button>
        <Button size="lg" onClick={onCreate} disabled={claim.isPending}>
          Create a free account
        </Button>
      </div>
      <p className="mt-4 text-center text-[12.5px] leading-relaxed text-fg-3">
        <Lock aria-hidden className="-mt-0.5 mr-1.5 inline size-3.5" />
        Anyone with this link can claim the card, so keep it private.
      </p>
    </div>
  );
}

/** Twelve distinct demo words (Fisher–Yates with crypto randomness). */
function pickWords(): string[] {
  const pool = [...new Set(RECOVERY_WORDS)];
  const rand = new Uint32Array(pool.length);
  crypto.getRandomValues(rand);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = rand[i] % (i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 12);
}

function CreateAccount({
  claimKey,
  card,
  phase,
  setPhase,
  onClaimed,
}: {
  claimKey: string;
  card: Card;
  phase: Phase;
  setPhase: (p: Phase) => void;
  onClaimed: (card: Card, owner: string) => void;
}) {
  const nameId = useId();
  const { connect } = useWallet();
  const [name, setName] = useState("");
  const [taken, setTaken] = useState(false);
  const [words, setWords] = useState<string[]>([]);
  const [hidden, setHidden] = useState(false);
  const [saved, setSaved] = useState(false);
  const create = useCreateAccountAndClaim();

  const clean = name.trim().toLowerCase();
  const nameError = clean ? validateNewAccountName(clean) : null;
  const accountId = `${clean}${NEAR_ACCOUNT_SUFFIX}`;
  const exists = useAccountExists(clean && !nameError ? accountId : null);
  const available = exists.data === false && !taken;

  function toWords(e: FormEvent) {
    e.preventDefault();
    if (!clean || nameError || !available) return;
    setWords(pickWords());
    setSaved(false);
    setPhase("words");
  }

  function finish() {
    create.mutate(
      { key: claimKey, accountId },
      {
        onSuccess: (c) => {
          connect(accountId);
          onClaimed(c, accountId);
        },
        onError: (e) => {
          if ("code" in e && e.code === "ACCOUNT_TAKEN") {
            setTaken(true);
            setPhase("name");
          } else {
            toast.error(e.message);
          }
        },
      },
    );
  }

  const nameMessage = taken
    ? { tone: "error" as const, text: "That name is taken. Try another one; your link still works." }
    : !clean
      ? { tone: "muted" as const, text: "Lowercase letters, numbers, - or _. This becomes your NEAR account." }
      : nameError
        ? { tone: "error" as const, text: nameError }
        : exists.isFetching
          ? { tone: "muted" as const, text: "Checking…" }
          : exists.data === true
            ? { tone: "error" as const, text: "That name is taken. Try another one; your link still works." }
            : exists.data === false
              ? { tone: "ok" as const, text: `${accountId} is available.` }
              : { tone: "muted" as const, text: "" };

  return (
    <div>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setPhase(phase === "words" ? "name" : "choose")}
          className="-ml-2 inline-flex h-10 items-center gap-1.5 rounded-control px-2 text-[14px] text-fg-2 hover:bg-raised hover:text-fg"
        >
          <ArrowLeft className="size-4" />
          Back
        </button>
        <span className="text-[13px] text-fg-3">Step {phase === "words" ? 2 : 1} of 2</span>
      </div>

      {phase === "name" ? (
        <form onSubmit={toWords} noValidate>
          <h1 className="mt-4 text-[28px] font-semibold leading-[1.15] tracking-[-0.035em]">Pick a name</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-fg-2">
            We&apos;ll create a free NEAR testnet account and put &ldquo;{card.name}&rdquo; in it.
          </p>
          <div className="mt-7">
            <Label htmlFor={nameId}>Account name</Label>
            <div className="relative mt-2">
              <Input
                id={nameId}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setTaken(false);
                }}
                placeholder="theo"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-invalid={nameMessage.tone === "error" ? true : undefined}
                aria-describedby={`${nameId}-msg`}
                className={cn("pr-24 font-mono", nameMessage.tone === "ok" && "border-ok/50")}
              />
              <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 font-mono text-[15px] text-fg-3">
                {NEAR_ACCOUNT_SUFFIX}
              </span>
            </div>
            <FieldMessage id={`${nameId}-msg`} tone={nameMessage.tone} aria-live="polite">
              {nameMessage.text}
            </FieldMessage>
          </div>
          <Button type="submit" variant="primary" size="lg" className="mt-7 w-full" disabled={!available || Boolean(nameError)}>
            Continue
          </Button>
        </form>
      ) : (
        <div>
          <div className="mt-4 inline-flex h-8 items-center gap-2 rounded-full border border-line-strong bg-surface-2 px-3 text-[13px]">
            <span className="font-mono">{accountId}</span>
            <span className="inline-flex items-center gap-1 text-ok">
              <Check aria-hidden className="size-3.5" strokeWidth={2.5} />
              Available
            </span>
          </div>
          <h1 className="mt-4 text-[28px] font-semibold leading-[1.15] tracking-[-0.035em]">Save these 12 words</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-fg-2">
            They&apos;re the only way to open your card from another device.
          </p>

          <ol
            aria-label="Recovery phrase"
            className={cn(
              "mt-5 grid grid-flow-col grid-cols-2 grid-rows-6 gap-2 transition-[filter]",
              hidden && "select-none blur-[6px]",
            )}
          >
            {words.map((w, i) => (
              <li key={i} className="flex h-11 items-center gap-2.5 rounded-control border border-line bg-surface px-3">
                <span className="w-5 font-mono text-[11.5px] text-fg-3">{i + 1}</span>
                <span className="font-mono text-[14.5px]">{w}</span>
              </li>
            ))}
          </ol>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              onClick={() =>
                void navigator.clipboard
                  .writeText(words.join(" "))
                  .then(() => toast.success("Words copied", { description: "Paste them somewhere safe, then clear your clipboard." }))
              }
            >
              <Copy className="size-3.5" />
              Copy words
            </Button>
            <Button size="sm" onClick={() => setHidden((h) => !h)} aria-pressed={hidden}>
              {hidden ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
              {hidden ? "Show" : "Hide"}
            </Button>
          </div>

          <Callout tone="warn" icon={<TriangleAlert />} className="mt-5">
            This is a testnet prototype. Your key stays in this browser until you import it into a wallet.
            {IS_SIMULATED ? (
              <span className="mt-2 flex items-center gap-2 text-fg-3">
                <SimulatedTag /> These words are for show; no real key is made.
              </span>
            ) : null}
          </Callout>

          <label className="mt-5 flex cursor-pointer items-center gap-3 text-[14px]">
            <input
              type="checkbox"
              checked={saved}
              onChange={(e) => setSaved(e.target.checked)}
              className="size-5 shrink-0 accent-[#C9A227]"
            />
            I saved my 12 words somewhere safe
          </label>

          <Button variant="primary" size="lg" className="mt-6 w-full" disabled={!saved || create.isPending} onClick={finish}>
            {create.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            {create.isPending ? "Creating account…" : "Create account and claim"}
          </Button>
          <p className="mt-3 text-center text-[12.5px] text-fg-3" aria-live="polite">
            {create.isPending ? "Creating your account and moving the card. This is one step." : `Creates ${accountId} and moves the card to it in one step.`}
          </p>
        </div>
      )}
    </div>
  );
}

function Success({ card, owner }: { card: Card; owner: string }) {
  return (
    <div className="flex flex-col items-center text-center" aria-live="polite">
      <Confetti />
      <div className="mt-4 w-[300px] animate-card-flip">
        <BearerCard name={card.name} id={card.id} finish={card.finish} />
      </div>
      <h1 className="mt-8 text-[30px] font-semibold leading-tight tracking-[-0.035em]">It&apos;s yours.</h1>
      <p className="mt-2 max-w-[360px] text-[15px] leading-relaxed text-fg-2">
        &ldquo;{card.name}&rdquo; now belongs to <span className="font-mono text-fg">{owner}</span>. Nothing moved on
        Bitcoin, Base or Solana.
      </p>
      <div className="mt-8 flex w-full flex-col gap-2.5">
        <Link href={`/c/${card.id}`} className={buttonVariants({ variant: "primary", size: "lg" })}>
          Open my card
        </Link>
        <Link href="/cards" className={buttonVariants({ size: "lg" })}>
          Go to my cards
        </Link>
      </div>
    </div>
  );
}
