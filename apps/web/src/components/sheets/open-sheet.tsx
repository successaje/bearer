"use client";

import { ArrowUpRight, Check, Loader2, Lock, TriangleAlert } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ChainIcon } from "@/components/brand/chain-icon";
import { Button } from "@/components/ui/button";
import { Callout, FieldMessage, Input, Label, SimulatedTag } from "@/components/ui/primitives";
import { SegmentedList, SegmentedRoot, SegmentedTrigger } from "@/components/ui/segmented";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { NETWORK_FEES, OPEN_NEAR_COST } from "@/lib/bearer/fees";
import { useOpen, useOpenRequest, useProveEvm } from "@/lib/bearer/hooks";
import { slotTotals } from "@/lib/bearer/seal";
import type { Card, ChainTag, OpenRequest, RequestStage } from "@/lib/bearer/types";
import { IS_SIMULATED, explorer } from "@/lib/config";
import { CHAIN_META, formatAmount, formatUsd, fromDecimal, toDecimalString, toUsd, truncateMiddle } from "@/lib/format";
import { validateAddress } from "@/lib/validation";
import { cn } from "@/lib/utils";

export function OpenSheet({
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
  const [requestId, setRequestId] = useState<string | null>(null);

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setRequestId(null);
      }}
    >
      <SheetContent
        title="Open funds"
        description={requestId ? undefined : "Withdraw native coins to an address you choose. The contract builds the transaction; NEAR's MPC network signs it."}
      >
        {requestId ? (
          <OpenProgress requestId={requestId} card={card} onClose={() => onOpenChange(false)} />
        ) : (
          <OpenForm card={card} signer={signer} onStarted={setRequestId} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function OpenForm({ card, signer, onStarted }: { card: Card; signer: string; onStarted: (id: string) => void }) {
  const toId = useId();
  const amountId = useId();
  const [chain, setChain] = useState<ChainTag>("evm");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const open = useOpen();

  const totals = slotTotals(card);
  const fee = NETWORK_FEES[chain];
  const available = Math.max(0, totals[chain].sealed - fee);
  const meta = CHAIN_META[chain];

  const toError = validateAddress(chain, to);
  const parsed = fromDecimal(chain, amount);
  const amountError = !amount
    ? "Enter an amount."
    : parsed === null || parsed <= 0
      ? "Enter a valid amount."
      : parsed > available
        ? `You can open up to ${formatAmount(chain, available)} ${meta.unit} after the network fee.`
        : null;

  const listed = Boolean(card.listing);
  const btcInputs =
    chain === "btc" && parsed
      ? (() => {
          let total = 0;
          let n = 0;
          for (const c of card.slots.btc.coins.filter((c) => !c.encumbered).sort((a, b) => b.amount - a.amount)) {
            if (total >= parsed + fee) break;
            total += c.amount;
            n++;
          }
          return n;
        })()
      : 0;

  function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (listed || toError || amountError || parsed === null) return;
    open.mutate(
      { id: card.id, input: { chain, to: to.trim(), amount: parsed }, signer },
      { onSuccess: (req) => onStarted(req.id), onError: (err) => toast.error(err.message) },
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      {listed ? (
        <Callout tone="warn" icon={<Lock />}>
          While listed, this card can&apos;t sign withdrawals. Delist it first.
        </Callout>
      ) : null}

      <SegmentedRoot
        value={chain}
        onValueChange={(v) => {
          setChain(v as ChainTag);
          setAmount("");
          setTo("");
          setSubmitted(false);
        }}
      >
        <SegmentedList aria-label="Slot" className="grid grid-cols-3">
          {(["btc", "evm", "sol"] as const).map((c) => (
            <SegmentedTrigger key={c} value={c} className="h-auto flex-col gap-1 py-2.5">
              <ChainIcon chain={c} className="size-5" />
              <span className="text-[13px]">{CHAIN_META[c].name}</span>
              <span className="tabular text-[11.5px] font-normal text-fg-3">
                {formatAmount(c, totals[c].sealed)} {CHAIN_META[c].unit}
              </span>
            </SegmentedTrigger>
          ))}
        </SegmentedList>
      </SegmentedRoot>

      <div>
        <Label htmlFor={toId}>Destination</Label>
        <Input
          id={toId}
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder={chain === "btc" ? "tb1q…" : chain === "evm" ? "0x…" : "Solana address"}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={submitted && toError ? true : undefined}
          aria-describedby={`${toId}-msg`}
          className="mt-2 bg-bg font-mono text-[14px]"
        />
        <FieldMessage id={`${toId}-msg`} tone={submitted && toError ? "error" : "muted"}>
          {submitted && toError
            ? toError
            : chain === "evm"
              ? "A Base Sepolia address. The same 0x address works on every EVM network, but this sends on Base Sepolia."
              : `A ${meta.name} ${meta.network} address.`}
        </FieldMessage>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <Label htmlFor={amountId}>Amount</Label>
          <button
            type="button"
            onClick={() => setAmount(toDecimalString(chain, available))}
            className="text-[13px] font-medium text-accent hover:underline"
          >
            Max {formatAmount(chain, available)}
          </button>
        </div>
        <div className="relative mt-2">
          <Input
            id={amountId}
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(",", "."))}
            inputMode="decimal"
            placeholder="0.00"
            autoComplete="off"
            aria-invalid={submitted && amountError ? true : undefined}
            aria-describedby={`${amountId}-msg`}
            className="tabular bg-bg pr-16 text-[16px]"
          />
          <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[14px] text-fg-3">{meta.unit}</span>
        </div>
        <FieldMessage id={`${amountId}-msg`} tone={submitted && amountError ? "error" : "muted"}>
          {submitted && amountError
            ? amountError
            : parsed
              ? `${formatUsd(toUsd(chain, parsed))} est.${chain === "btc" && btcInputs ? ` · spends ${btcInputs} coin${btcInputs > 1 ? "s" : ""}` : ""}`
              : "Only sealed funds can be opened."}
        </FieldMessage>
      </div>

      <dl className="grid grid-cols-[1fr_auto] gap-y-2.5 rounded-[14px] border border-line bg-bg px-4 py-3.5 text-[13.5px]">
        <dt className="text-fg-3">Network fee</dt>
        <dd className="tabular m-0 text-right">
          {formatAmount(chain, fee)} {meta.unit}
        </dd>
        <dt className="text-fg-3">NEAR cost</dt>
        <dd className="tabular m-0 text-right">{OPEN_NEAR_COST} NEAR</dd>
        <dd className="col-span-2 m-0 text-[12px] leading-relaxed text-fg-3">
          Pays for the signature record and NEAR&apos;s MPC fee. While the signature is in flight, the card can&apos;t change
          hands.
        </dd>
      </dl>

      <Button type="submit" variant="primary" size="lg" disabled={listed || open.isPending}>
        {open.isPending ? <Loader2 className="size-4 animate-spin" /> : <ArrowUpRight className="size-4" />}
        {open.isPending ? "Confirm in your wallet…" : `Open ${amount && parsed ? `${amount} ${meta.unit}` : "funds"}`}
      </Button>
    </form>
  );
}

const STEPS: { stage: RequestStage; label: string; hint: string }[] = [
  { stage: "recorded", label: "Confirmed on NEAR", hint: "Request recorded on the card." },
  { stage: "signing", label: "Requesting signature from NEAR's MPC network…", hint: "Usually takes a few seconds." },
  { stage: "broadcasting", label: "Broadcast", hint: "Stored on NEAR, so anyone can re-send it." },
  { stage: "confirmed", label: "Confirmed", hint: "" },
];

const ORDER: RequestStage[] = ["recorded", "signing", "broadcasting", "confirmed"];

function OpenProgress({ requestId, card, onClose }: { requestId: string; card: Card; onClose: () => void }) {
  const { data: req } = useOpenRequest(requestId);
  const prove = useProveEvm();
  const [proven, setProven] = useState(false);

  if (!req) {
    return (
      <div className="flex items-center gap-3 py-10 text-fg-2">
        <Loader2 className="size-5 animate-spin" /> Loading request…
      </div>
    );
  }

  const meta = CHAIN_META[req.chain];
  const current = req.stage === "failed" ? -1 : ORDER.indexOf(req.stage);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center text-center">
        <ChainIcon chain={req.chain} className="size-9" />
        <p className="mt-2.5 text-[13px] text-fg-3">Sending from the {meta.name} slot</p>
        <p className="mt-1.5 flex items-baseline gap-2">
          <span className="tabular text-[36px] font-semibold leading-none tracking-[-0.04em]">{formatAmount(req.chain, req.amount)}</span>
          <span className="text-[18px] font-medium text-fg-2">{meta.unit}</span>
        </p>
        <p className="mt-1.5 text-[13px] text-fg-3">
          to <span className="font-mono">{truncateMiddle(req.to, 6, 4)}</span>
        </p>
      </div>

      {req.stage === "failed" ? (
        <Callout tone="danger" icon={<TriangleAlert />}>
          <p className="font-medium text-fg">No signature was produced.</p>
          <p className="mt-0.5 text-fg-2">
            Your funds didn&apos;t move. For safety this request stays on the card&apos;s record until it expires or is cleared.
          </p>
        </Callout>
      ) : (
        <ol aria-live="polite" className="flex flex-col">
          {STEPS.map((step, i) => {
            const state = i < current || req.stage === "confirmed" ? "done" : i === current ? "active" : "todo";
            const label = step.stage === "broadcasting" ? `Broadcast to ${meta.name} ${meta.network}` : step.stage === "confirmed" ? `Confirmed on ${meta.name}` : step.label;
            return (
              <li key={step.stage} className="relative flex gap-3.5 pb-5 last:pb-0">
                {i < STEPS.length - 1 ? (
                  <span
                    aria-hidden
                    className={cn("absolute left-[13px] top-[30px] bottom-0.5 w-0.5", state === "done" ? "bg-[#1F9D55]/60" : "bg-line-strong")}
                  />
                ) : null}
                <span
                  aria-hidden
                  className={cn(
                    "inline-flex size-7 shrink-0 items-center justify-center rounded-full",
                    state === "done" && "bg-ok/15 text-ok",
                    state === "active" && "bg-gold/15 text-accent",
                    state === "todo" && "border-2 border-line-strong",
                  )}
                >
                  {state === "done" ? <Check className="size-3.5" strokeWidth={3} /> : null}
                  {state === "active" ? <Loader2 className="size-4 animate-spin" /> : null}
                </span>
                <div className="min-w-0 pt-1">
                  <p className={cn("text-[14.5px]", state === "active" ? "font-semibold" : "font-medium", state === "todo" && "text-fg-3")}>
                    {label}
                  </p>
                  {step.hint && state !== "todo" ? <p className="mt-0.5 text-[12.5px] text-fg-3">{step.hint}</p> : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {req.stage === "confirmed" && req.chain === "evm" && !proven ? (
        <Callout tone="warn" icon={<Lock />}>
          <p className="text-fg">Prove this withdrawal on NEAR so the card can change hands again.</p>
          <Button
            variant="primary"
            size="sm"
            className="mt-3"
            disabled={prove.isPending}
            onClick={() =>
              prove.mutate(
                { id: card.id },
                {
                  onSuccess: () => {
                    setProven(true);
                    toast.success("Base withdrawal proven");
                  },
                  onError: (e) => toast.error(e.message),
                },
              )
            }
          >
            {prove.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {prove.isPending ? "Proving on NEAR…" : "Prove on NEAR"}
          </Button>
        </Callout>
      ) : null}

      {req.stage !== "confirmed" && req.stage !== "failed" ? (
        <Callout tone="neutral" icon={<Lock />}>
          Your funds haven&apos;t moved yet. Until this finishes, the card can&apos;t change hands.
        </Callout>
      ) : null}

      <div className="flex flex-col gap-2.5">
        <TxLinks req={req} />
        <Button variant={req.stage === "confirmed" ? "primary" : "secondary"} size="lg" onClick={onClose}>
          {req.stage === "confirmed" ? "Done" : "Close"}
        </Button>
        {req.stage !== "confirmed" && req.stage !== "failed" ? (
          <p className="text-center text-[12.5px] text-fg-3">Progress is saved on NEAR. You can come back later.</p>
        ) : null}
      </div>
    </div>
  );
}

function TxLinks({ req }: { req: OpenRequest }) {
  if (IS_SIMULATED) {
    return (
      <p className="flex items-center justify-center gap-2 text-[12.5px] text-fg-3">
        <SimulatedTag /> No explorer links for simulated transactions.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap justify-center gap-4 text-[13.5px]">
      <a href={explorer.nearTx(req.nearTxHash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
        NEAR request <ArrowUpRight className="size-3.5" />
      </a>
      {req.chainTxHash ? (
        <a href={explorer.tx(req.chain, req.chainTxHash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
          {CHAIN_META[req.chain].name} transaction <ArrowUpRight className="size-3.5" />
        </a>
      ) : null}
    </div>
  );
}
