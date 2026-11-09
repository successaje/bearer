"use client";

import type { Withdrawal } from "@bearer/sdk";
import { ArrowUpRight, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { ChainIcon } from "@/components/brand/chain-icon";
import { IS_SIMULATED } from "@/lib/config";
import { useBroadcast, useWithdrawalProgress } from "@/lib/vault/hooks";
import { withdrawalAmount } from "@/lib/vault/report";
import { CHAIN_META, formatAmount, nsToMs, relativeTime, truncateMiddle } from "@/lib/vault/format";
import { StatusPill } from "./withdrawal-tracker";

function Row({ tokenId, w, now }: { tokenId: string; w: Withdrawal; now: number }) {
  const { data } = useWithdrawalProgress(tokenId, w.index);
  const broadcast = useBroadcast();
  const { chain, amount, to } = withdrawalAmount(w);
  const meta = CHAIN_META[chain];
  // On testnet, "broadcasting" means signed and stored on NEAR, waiting for someone to send it.
  const waiting = !IS_SIMULATED && data?.stage === "broadcasting";
  const chainError = w.status !== "failed" && data?.stage === "failed" ? data.error : null;
  return (
    <li className="flex items-center gap-3.5 px-5 py-4">
      <ChainIcon chain={chain} className="size-8" />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium">
          {formatAmount(chain, amount)} {meta.unit} <span className="font-normal text-fg-3">to</span>{" "}
          <span className="font-mono text-[13px]">{truncateMiddle(to, 8, 6)}</span>
        </p>
        <p className="mt-0.5 text-[12.5px] text-fg-3">
          {w.error
            ? `Failed: ${w.error === "ERR_SIGNER_FAILED" ? "the signing network didn't answer in time" : w.error}. Nothing was sent.`
            : chainError
              ? chainError
              : `Signature ${w.index + 1} · ${meta.name} ${meta.network}`}
          {data?.explorerUrl && data.stage !== "broadcasting" ? (
            <a href={data.explorerUrl} target="_blank" rel="noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 font-medium text-accent hover:underline">
              explorer <ArrowUpRight className="size-3" />
            </a>
          ) : null}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {waiting ? (
          <button
            type="button"
            onClick={() =>
              broadcast.mutate(
                { id: tokenId, index: w.index },
                { onError: (e) => toast.error(`${meta.name} didn't accept it`, { description: String(e).slice(0, 180) }) },
              )
            }
            disabled={broadcast.isPending}
            title="Signed and stored on NEAR. Anyone can send it; it only pays where the owner chose."
            className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line-strong px-2.5 text-[12px] font-medium text-fg transition-colors hover:bg-raised disabled:opacity-60"
          >
            {broadcast.isPending ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
            Broadcast
          </button>
        ) : (
          <StatusPill stage={w.status === "failed" ? "failed" : data?.stage} />
        )}
        <span className="text-[12px] text-fg-3">{now ? relativeTime(nsToMs(w.requested_at_ns), now) : ""}</span>
      </div>
    </li>
  );
}

export function WithdrawalsList({ tokenId, withdrawals, now }: { tokenId: string; withdrawals: Withdrawal[]; now: number }) {
  if (withdrawals.length === 0) {
    return (
      <div className="rounded-panel border border-dashed border-line-strong px-5 py-8 text-center text-[14px] text-fg-3">
        No withdrawals yet.
      </div>
    );
  }
  return (
    <ol className="divide-y divide-line overflow-hidden rounded-panel border border-line bg-surface">
      {[...withdrawals].reverse().map((w) => (
        <Row key={w.index} tokenId={tokenId} w={w} now={now} />
      ))}
    </ol>
  );
}
