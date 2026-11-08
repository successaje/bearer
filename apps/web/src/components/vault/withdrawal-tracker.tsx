"use client";

import type { Withdrawal, WithdrawalStage } from "@bearer/sdk";
import { ArrowUpRight, Check, Loader2, Lock, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { ChainIcon } from "@/components/brand/chain-icon";
import { Callout, SimulatedTag } from "@/components/ui/primitives";
import { withdrawalAmount } from "@/lib/vault/report";
import { useBroadcast, useWithdrawalProgress } from "@/lib/vault/hooks";
import { CHAIN_META, formatAmount, truncateMiddle } from "@/lib/vault/format";
import { IS_SIMULATED } from "@/lib/config";
import { cn } from "@/lib/utils";

const ORDER: WithdrawalStage[] = ["signing", "broadcasting", "confirming", "confirmed"];

/** Live steps for one withdrawal: NEAR → MPC signature → broadcast → confirmation. */
export function WithdrawalTracker({ tokenId, withdrawal }: { tokenId: string; withdrawal: Withdrawal }) {
  const { data: progress } = useWithdrawalProgress(tokenId, withdrawal.index);
  const broadcast = useBroadcast();
  const sent = useRef(false);
  const { chain, amount, to } = withdrawalAmount(withdrawal);
  const meta = CHAIN_META[chain];
  const stage: WithdrawalStage = progress?.stage ?? "signing";
  const current = stage === "failed" ? -1 : ORDER.indexOf(stage);

  // Live adapter: the owner who just withdrew sends the signed transaction once it exists.
  useEffect(() => {
    if (IS_SIMULATED || stage !== "broadcasting" || sent.current) return;
    sent.current = true;
    broadcast.mutate({ id: tokenId, index: withdrawal.index });
  }, [stage, broadcast, tokenId, withdrawal.index]);

  const steps = [
    { label: "Confirmed on NEAR", hint: "Request recorded on the vault." },
    { label: "Requesting signature from NEAR's MPC network…", done: "Signed by NEAR's MPC network", hint: "Usually takes a few seconds." },
    { label: `Broadcast to ${meta.name} ${meta.network}`, hint: "The signed transaction is stored on NEAR, so anyone can re-send it." },
    { label: `Confirmed on ${meta.name}`, hint: "" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center text-center">
        <ChainIcon chain={chain} className="size-9" />
        <p className="mt-2.5 text-[13px] text-fg-3">Withdrawing from the {meta.name} slot</p>
        <p className="mt-1.5 flex items-baseline gap-2">
          <span className="tabular text-[36px] font-semibold leading-none tracking-[-0.04em]">{formatAmount(chain, amount)}</span>
          <span className="text-[18px] font-medium text-fg-2">{meta.unit}</span>
        </p>
        <p className="mt-1.5 text-[13px] text-fg-3">
          to <span className="font-mono">{truncateMiddle(to, 8, 6)}</span>
        </p>
      </div>

      {stage === "failed" ? (
        <Callout tone="danger" icon={<TriangleAlert />}>
          {withdrawal.status === "failed" || !progress?.chainTxHash ? (
            <>
              <p className="font-medium text-fg">NEAR&apos;s signing network didn&apos;t answer in time.</p>
              <p className="mt-0.5 text-fg-2">Nothing was sent. The vault stays opened; you can try again.</p>
            </>
          ) : (
            <>
              <p className="font-medium text-fg">{meta.name} didn&apos;t accept it.</p>
              <p className="mt-0.5 text-fg-2">{progress.error ?? "The vault stays opened; you can withdraw again."}</p>
            </>
          )}
        </Callout>
      ) : (
        <ol aria-live="polite" className="flex flex-col">
          {steps.map((s, i) => {
            // Step 0 is done as soon as the request exists.
            const idx = i - 1;
            const state = i === 0 || idx < current || stage === "confirmed" ? "done" : idx === current ? "active" : "todo";
            return (
              <li key={s.label} className="relative flex gap-3.5 pb-5 last:pb-0">
                {i < steps.length - 1 ? (
                  <span aria-hidden className={cn("absolute bottom-0.5 left-[13px] top-[30px] w-0.5", state === "done" ? "bg-[#1F9D55]/60" : "bg-line-strong")} />
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
                    {state === "done" && s.done ? s.done : s.label}
                  </p>
                  {s.hint && state !== "todo" ? <p className="mt-0.5 text-[12.5px] text-fg-3">{s.hint}</p> : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {stage !== "confirmed" && stage !== "failed" ? (
        <Callout tone="neutral" icon={<Lock />}>
          You can close this. Progress is saved on NEAR, and the vault page keeps tracking it.
        </Callout>
      ) : null}

      {IS_SIMULATED ? (
        <p className="flex items-center justify-center gap-2 text-[12.5px] text-fg-3">
          <SimulatedTag /> No explorer links for simulated transactions.
        </p>
      ) : progress?.explorerUrl ? (
        <a
          href={progress.explorerUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center gap-1 text-[13.5px] font-medium text-accent hover:underline"
        >
          {meta.name} transaction <span className="font-mono">{truncateMiddle(progress.chainTxHash ?? "", 8, 6)}</span>
          <ArrowUpRight className="size-3.5" />
        </a>
      ) : null}
      {broadcast.isError ? (
        <Callout tone="warn" icon={<TriangleAlert />}>
          Couldn&apos;t broadcast yet: {String(broadcast.error).slice(0, 160)}. It&apos;s stored on NEAR, so you can retry from
          the vault page.
        </Callout>
      ) : null}
    </div>
  );
}

export function StatusPill({ stage }: { stage: WithdrawalStage | undefined }) {
  const map: Record<WithdrawalStage, { label: string; cls: string; icon: React.ReactNode }> = {
    signing: { label: "Signing", cls: "bg-gold/12 text-accent", icon: <Loader2 className="size-3 animate-spin" /> },
    broadcasting: { label: "Broadcasting", cls: "bg-info/10 text-info", icon: <Loader2 className="size-3 animate-spin" /> },
    confirming: { label: "Confirming", cls: "bg-info/10 text-info", icon: <Loader2 className="size-3 animate-spin" /> },
    confirmed: { label: "Confirmed", cls: "bg-ok/10 text-ok", icon: <Check className="size-3" strokeWidth={3} /> },
    failed: { label: "Failed", cls: "bg-danger/10 text-danger", icon: <X className="size-3" strokeWidth={3} /> },
  };
  const s = map[stage ?? "signing"];
  return (
    <span className={cn("inline-flex h-6 items-center gap-1 rounded-full px-2 text-[12px] font-medium", s.cls)}>
      {s.icon}
      {s.label}
    </span>
  );
}
