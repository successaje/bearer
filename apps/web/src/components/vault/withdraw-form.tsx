"use client";

import type { ChainObservation, ChainTag, WithdrawRequest } from "@bearer/sdk";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { ChainIcon } from "@/components/brand/chain-icon";
import { Button } from "@/components/ui/button";
import { FieldMessage, Input, Label } from "@/components/ui/primitives";
import { SegmentedList, SegmentedRoot, SegmentedTrigger } from "@/components/ui/segmented";
import { CHAIN_META, formatAmount, formatUsd, fromDecimal, toDecimalString, toUsd } from "@/lib/vault/format";
import { validateAddress } from "@/lib/validation";

export function toRequest(chain: ChainTag, to: string, amount: bigint): WithdrawRequest {
  const s = amount.toString();
  return chain === "evm" ? { chain, to, amountWei: s } : chain === "btc" ? { chain, to, amountSats: s } : { chain, to, lamports: s };
}

/** Chain, destination and amount for one withdrawal. Only confirmed funds can be withdrawn. */
export function WithdrawForm({
  observations,
  submitLabel,
  onSubmit,
  busy,
  footer,
}: {
  observations: ChainObservation[];
  submitLabel: (summary: string | null) => ReactNode;
  onSubmit: (request: WithdrawRequest, summary: string) => void;
  busy?: boolean;
  footer?: ReactNode;
}) {
  const toId = useId();
  const amountId = useId();
  const firstFunded = observations.find((o) => BigInt(o.confirmed) > BigInt(o.feeEstimate))?.chain ?? "btc";
  const [chain, setChain] = useState<ChainTag>(firstFunded);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const obs = observations.find((o) => o.chain === chain);
  const meta = CHAIN_META[chain];
  const fee = BigInt(obs?.feeEstimate ?? "0");
  const available = obs ? BigInt(obs.confirmed) - fee : 0n;
  const max = available > 0n ? available : 0n;
  const parsed = fromDecimal(chain, amount);

  const toError = validateAddress(chain, to);
  const amountError = !amount
    ? "Enter an amount."
    : parsed === null || parsed <= 0n
      ? "Enter a valid amount."
      : parsed > max
        ? `You can withdraw up to ${formatAmount(chain, max)} ${meta.unit} after the network fee.`
        : null;
  const summary = parsed && !amountError ? `${formatAmount(chain, parsed)} ${meta.unit}` : null;

  function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (toError || amountError || parsed === null) return;
    onSubmit(toRequest(chain, to.trim(), parsed), `${formatAmount(chain, parsed)} ${meta.unit} on ${meta.name}`);
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
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
          {observations.map((o) => (
            <SegmentedTrigger key={o.chain} value={o.chain} className="h-auto flex-col gap-1 py-2.5">
              <ChainIcon chain={o.chain} className="size-5" />
              <span className="text-[13px]">{CHAIN_META[o.chain].name}</span>
              <span className="tabular text-[11.5px] font-normal text-fg-3">
                {formatAmount(o.chain, o.confirmed)} {CHAIN_META[o.chain].unit}
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
              ? "A Base Sepolia address. This version withdraws on Base Sepolia only."
              : `An address you control on ${meta.name} ${meta.network}.`}
        </FieldMessage>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <Label htmlFor={amountId}>Amount</Label>
          <button
            type="button"
            onClick={() => setAmount(toDecimalString(chain, max))}
            disabled={max === 0n}
            className="text-[13px] font-medium text-accent hover:underline disabled:opacity-40"
          >
            Max {formatAmount(chain, max)}
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
          {submitted && amountError ? amountError : parsed ? `${formatUsd(toUsd(chain, parsed))} est.` : "Only confirmed funds can be withdrawn."}
        </FieldMessage>
      </div>

      <dl className="grid grid-cols-[1fr_auto] gap-y-2.5 rounded-[14px] border border-line bg-bg px-4 py-3.5 text-[13.5px]">
        <dt className="text-fg-3">Network fee (estimate)</dt>
        <dd className="tabular m-0 text-right">
          {formatAmount(chain, fee)} {meta.unit}
        </dd>
        <dt className="text-fg-3">NEAR cost</dt>
        <dd className="tabular m-0 text-right">0.01 NEAR</dd>
        <dd className="col-span-2 m-0 text-[12px] leading-relaxed text-fg-3">
          Pays for the withdrawal record and NEAR&apos;s MPC fee. The contract builds the transaction; NEAR&apos;s MPC
          network signs it.
        </dd>
      </dl>

      {footer}

      <Button type="submit" variant="primary" size="lg" disabled={busy}>
        {submitLabel(summary)}
      </Button>
    </form>
  );
}
