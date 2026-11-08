"use client";

import { Check, CircleCheck, Link2, Loader2, Send, ShieldCheck, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { BearerCard } from "@/components/card/bearer-card";
import { QrCodeBlock } from "@/components/card/qr-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Callout, FieldMessage, Input, Label } from "@/components/ui/primitives";
import { SegmentedContent, SegmentedList, SegmentedRoot, SegmentedTrigger } from "@/components/ui/segmented";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  useAccountExists,
  useCancelClaimLink,
  useCreateClaimLink,
  useDelist,
  useHandOver,
} from "@/lib/bearer/hooks";
import { cardValueUsd, type SealReport } from "@/lib/bearer/seal";
import type { Card } from "@/lib/bearer/types";
import { formatUsd, relativeTime } from "@/lib/format";
import { validateNearAccount } from "@/lib/validation";
import { cn } from "@/lib/utils";

const claimStorageKey = (id: string) => `bearer:claim:${id}`;

export function HandOverSheet({
  open,
  onOpenChange,
  card,
  report,
  signer,
  now,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  card: Card;
  report: SealReport;
  signer: string;
  now: number;
}) {
  const [tab, setTab] = useState<"account" | "link">(card.claimLink ? "link" : "account");
  const [done, setDone] = useState<string | null>(null);

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setDone(null);
      }}
    >
      <SheetContent title={done ? "Handed over" : "Hand over"} description={done ? undefined : "Give this card, and everything inside it, to someone else."}>
        {done ? (
          <HandedOver card={card} receiver={done} />
        ) : (
          <SegmentedRoot value={tab} onValueChange={(v) => setTab(v as "account" | "link")}>
            <SegmentedList aria-label="How to hand over" className="grid grid-cols-2">
              <SegmentedTrigger value="account">
                <Send className="size-4" />
                NEAR account
              </SegmentedTrigger>
              <SegmentedTrigger value="link">
                <Link2 className="size-4" />
                Claim link
              </SegmentedTrigger>
            </SegmentedList>
            <SegmentedContent value="account" className="mt-5 outline-none">
              <ToAccount card={card} report={report} signer={signer} onDone={setDone} />
            </SegmentedContent>
            <SegmentedContent value="link" className="mt-5 outline-none">
              <ClaimLinkTab card={card} report={report} signer={signer} now={now} />
            </SegmentedContent>
          </SegmentedRoot>
        )}
      </SheetContent>
    </Sheet>
  );
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Pre-flight checks shown before any hand-over (brief 3.3, Flow B). */
function PreflightCheck({ card, report }: { card: Card; report: SealReport }) {
  const rows: { label: string; ok: boolean }[] = [
    { label: "No signature in flight", ok: card.pending.length === 0 },
    { label: "Base slot settled", ok: report.checks.find((c) => c.id === "evm")?.state === "pass" },
    { label: "Solana slot settled", ok: report.checks.find((c) => c.id === "sol")?.state === "pass" },
    { label: "Not listed, no open claim link", ok: !card.listing && !card.claimLink },
  ];
  const passed = rows.every((r) => r.ok);
  return (
    <div className="overflow-hidden rounded-[14px] border border-line bg-bg">
      <div className="flex items-center justify-between border-b border-line px-3.5 py-3">
        <span className="inline-flex items-center gap-2 text-[13.5px] font-medium">
          <ShieldCheck className={cn("size-4", passed ? "text-ok" : "text-danger")} aria-hidden />
          Seal check
        </span>
        <span
          className={cn(
            "inline-flex h-[22px] items-center rounded-full border px-2 text-[12px] font-medium",
            passed ? "border-ok/30 bg-ok/10 text-ok" : "border-danger/30 bg-danger/10 text-danger",
          )}
        >
          {passed ? "Passed" : "Not passed"}
        </span>
      </div>
      <ul className="py-1.5 text-[13.5px]">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center gap-2.5 px-3.5 py-1.5 text-fg-2">
            {r.ok ? (
              <Check aria-label="Passed" className="size-3.5 text-ok" strokeWidth={3} />
            ) : (
              <X aria-label="Not passed" className="size-3.5 text-danger" strokeWidth={3} />
            )}
            {r.label}
          </li>
        ))}
      </ul>
      {report.exclusions.length > 0 ? (
        <p className="border-t border-line px-3.5 py-2.5 text-[12.5px] text-warn">{report.detail}</p>
      ) : null}
    </div>
  );
}

function Blockers({ card, signer }: { card: Card; signer: string }) {
  const delist = useDelist();
  const cancel = useCancelClaimLink();
  if (card.listing) {
    return (
      <Callout tone="warn" icon={<TriangleAlert />}>
        <p>This card is listed. Delist it before handing it over.</p>
        <Button
          size="sm"
          className="mt-3"
          disabled={delist.isPending}
          onClick={() => delist.mutate({ id: card.id, signer }, { onError: (e) => toast.error(e.message) })}
        >
          {delist.isPending ? "Delisting…" : "Delist"}
        </Button>
      </Callout>
    );
  }
  if (card.claimLink) {
    return (
      <Callout tone="warn" icon={<TriangleAlert />}>
        <p>This card has an open claim link. Cancel the link before handing it over directly.</p>
        <Button
          size="sm"
          className="mt-3"
          disabled={cancel.isPending}
          onClick={() => cancel.mutate({ id: card.id, signer }, { onError: (e) => toast.error(e.message) })}
        >
          {cancel.isPending ? "Cancelling…" : "Cancel link"}
        </Button>
      </Callout>
    );
  }
  return null;
}

function ToAccount({
  card,
  report,
  signer,
  onDone,
}: {
  card: Card;
  report: SealReport;
  signer: string;
  onDone: (receiver: string) => void;
}) {
  const id = useId();
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const handOver = useHandOver();
  const receiver = value.trim().toLowerCase();
  const formatError = validateNearAccount(receiver);
  const debounced = useDebounced(receiver, 400);
  const checkable = !formatError && debounced === receiver && receiver !== signer;
  const exists = useAccountExists(checkable ? receiver : null);

  const self = receiver === signer;
  const message = !touched || !receiver
    ? { tone: "muted" as const, text: "A NEAR testnet account, like theo.testnet." }
    : formatError
      ? { tone: "error" as const, text: formatError }
      : self
        ? { tone: "error" as const, text: "That's you. Enter someone else's account." }
        : exists.isFetching || debounced !== receiver
          ? { tone: "muted" as const, text: "Checking account…" }
          : exists.data === false
            ? { tone: "error" as const, text: `${receiver} doesn't exist on NEAR testnet.` }
            : exists.data
              ? { tone: "ok" as const, text: "Account found on NEAR testnet." }
              : { tone: "muted" as const, text: "" };

  const transferable = report.verdict !== "not_transferable" && !card.listing && !card.claimLink;
  const canSubmit = transferable && !formatError && !self && exists.data === true && !handOver.isPending;

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!canSubmit) return;
    handOver.mutate(
      { id: card.id, receiver, signer },
      {
        onSuccess: () => onDone(receiver),
        onError: (err) => toast.error(err.message),
      },
    );
  }

  const value$ = cardValueUsd(card).sealed;

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <Blockers card={card} signer={signer} />
      <div>
        <Label htmlFor={id}>Recipient</Label>
        <div className="relative mt-2">
          <Input
            id={id}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setTouched(true);
            }}
            placeholder="name.testnet"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={message.tone === "error" ? true : undefined}
            aria-describedby={`${id}-msg`}
            className={cn("bg-bg pr-11 font-mono", message.tone === "ok" && "border-ok/50")}
          />
          <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2">
            {exists.isFetching ? <Loader2 className="size-4 animate-spin text-fg-3" aria-hidden /> : null}
            {message.tone === "ok" ? <Check className="size-[18px] text-ok" strokeWidth={2.5} aria-hidden /> : null}
          </span>
        </div>
        <FieldMessage id={`${id}-msg`} tone={message.tone} aria-live="polite">
          {message.text}
        </FieldMessage>
      </div>

      <PreflightCheck card={card} report={report} />

      {report.verdict === "not_transferable" ? (
        <Callout tone="danger" icon={<TriangleAlert />}>
          <p className="font-medium">Not transferable yet</p>
          <p className="mt-0.5 text-fg-2">{report.detail} Fix it from the Seal panel, then come back.</p>
        </Callout>
      ) : null}

      <div className="flex items-center justify-between gap-3 rounded-[14px] bg-raised px-4 py-3.5">
        <div className="min-w-0">
          <p className="text-[13px] text-fg-3">{exists.data && receiver ? `${receiver} receives` : "They receive"}</p>
          <p className="mt-0.5 text-[14.5px] font-medium">The card and everything inside</p>
        </div>
        <div className="text-right">
          <p className="tabular text-[18px] font-semibold">{formatUsd(value$)}</p>
          <p className="text-[12px] text-fg-3">est.</p>
        </div>
      </div>

      <div>
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={!canSubmit}>
          {handOver.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          {handOver.isPending ? "Confirm in your wallet…" : exists.data && receiver ? `Hand over to ${receiver}` : "Hand over"}
        </Button>
        <p className="mt-3 text-center text-[12.5px] leading-relaxed text-fg-3">
          One NEAR transaction. Nothing moves on Bitcoin, Base or Solana.
        </p>
      </div>
    </form>
  );
}

function ClaimLinkTab({ card, report, signer, now }: { card: Card; report: SealReport; signer: string; now: number }) {
  const create = useCreateClaimLink();
  const cancel = useCancelClaimLink();
  const [key, setKey] = useState<string | null>(null);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setKey(card.claimLink ? localStorage.getItem(claimStorageKey(card.id)) : null);
    } catch {}
  }, [card.claimLink, card.id]);

  const link = key ? `${window.location.origin}/claim#${key}` : null;

  if (card.claimLink) {
    return (
      <div className="flex flex-col gap-5">
        <Callout tone="neutral" icon={<Link2 />}>
          <p className="text-fg">Claim link open since {now ? relativeTime(card.claimLink.createdAt, now) : "recently"}.</p>
          <p className="mt-0.5">The first person to open it and claim gets the card.</p>
        </Callout>
        {link ? (
          <div className="flex flex-col items-center gap-4">
            <QrCodeBlock value={link} label="QR code for the claim link" size={168} />
            <div className="flex w-full items-center gap-2 rounded-control border border-line bg-bg py-1 pl-3 pr-1">
              <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{link}</span>
              <CopyButton value={link} label="Copy claim link" size="sm" />
            </div>
          </div>
        ) : (
          <p className="text-[13.5px] leading-relaxed text-fg-3">
            The link was created in another browser. For safety it can&apos;t be shown again here; cancel it and create a
            new one if you lost it.
          </p>
        )}
        <Button
          variant="danger"
          size="lg"
          disabled={cancel.isPending}
          onClick={() =>
            cancel.mutate(
              { id: card.id, signer },
              {
                onSuccess: () => {
                  try {
                    localStorage.removeItem(claimStorageKey(card.id));
                  } catch {}
                  toast.success("Claim link cancelled", { description: "It no longer works." });
                },
                onError: (e) => toast.error(e.message),
              },
            )
          }
        >
          {cancel.isPending ? "Cancelling…" : "Cancel link"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Callout tone="warn" icon={<TriangleAlert />}>
        <p className="font-medium text-fg">Anyone with this link can claim the card.</p>
        <p className="mt-0.5 text-fg-2">Send it privately. They don&apos;t need a wallet: they can make a free account on the claim page.</p>
      </Callout>
      {card.listing ? <Blockers card={card} signer={signer} /> : null}
      {report.verdict === "not_transferable" ? (
        <Callout tone="danger" icon={<TriangleAlert />}>
          {report.detail} The link will work once the card is sealed.
        </Callout>
      ) : null}
      <ul className="flex flex-col gap-2.5 text-[13.5px] leading-relaxed text-fg-2">
        <li className="flex gap-2.5">
          <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
          The key is made in your browser and lives only in the link&apos;s # part, which never reaches a server.
        </li>
        <li className="flex gap-2.5">
          <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
          It can only claim this card. You can cancel it until it&apos;s used.
        </li>
      </ul>
      <Button
        variant="primary"
        size="lg"
        disabled={create.isPending || Boolean(card.listing)}
        onClick={() =>
          create.mutate(
            { id: card.id, signer },
            {
              onSuccess: ({ key: k }) => {
                try {
                  localStorage.setItem(claimStorageKey(card.id), k);
                } catch {}
                setKey(k);
                toast.success("Claim link created");
              },
              onError: (e) => toast.error(e.message),
            },
          )
        }
      >
        {create.isPending ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
        {create.isPending ? "Confirm in your wallet…" : "Create claim link"}
      </Button>
    </div>
  );
}

function HandedOver({ card, receiver }: { card: Card; receiver: string }) {
  return (
    <div className="flex flex-col items-center pt-2 text-center" aria-live="polite">
      <div className="w-[260px] animate-card-flip">
        <BearerCard name={card.name} id={card.id} finish={card.finish} />
      </div>
      <p className="mt-7 text-[20px] font-semibold tracking-[-0.02em]">Handed over to {receiver}</p>
      <p className="mt-2 max-w-[320px] text-[14.5px] leading-relaxed text-fg-2">
        Nothing moved on Bitcoin, Base or Solana. The card and everything inside it belong to {receiver} now.
      </p>
      <div className="mt-7 flex w-full flex-col gap-2.5">
        <Link href="/cards" className={buttonVariants({ variant: "primary", size: "lg" })}>
          Back to my cards
        </Link>
        <Link href={`/c/${card.id}`} className={buttonVariants({ variant: "secondary", size: "lg" })}>
          View the public card
        </Link>
      </div>
    </div>
  );
}
