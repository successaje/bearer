"use client";

import type { Withdrawal } from "@bearer/sdk";
import { ChainIcon } from "@/components/brand/chain-icon";
import { useWithdrawalProgress } from "@/lib/vault/hooks";
import { withdrawalAmount } from "@/lib/vault/report";
import { CHAIN_META, formatAmount, nsToMs, relativeTime, truncateMiddle } from "@/lib/vault/format";
import { StatusPill } from "./withdrawal-tracker";

function Row({ tokenId, w, now }: { tokenId: string; w: Withdrawal; now: number }) {
  const { data } = useWithdrawalProgress(tokenId, w.index);
  const { chain, amount, to } = withdrawalAmount(w);
  const meta = CHAIN_META[chain];
  return (
    <li className="flex items-center gap-3.5 px-5 py-4">
      <ChainIcon chain={chain} className="size-8" />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium">
          {formatAmount(chain, amount)} {meta.unit} <span className="font-normal text-fg-3">to</span>{" "}
          <span className="font-mono text-[13px]">{truncateMiddle(to, 8, 6)}</span>
        </p>
        <p className="mt-0.5 text-[12.5px] text-fg-3">
          {w.error ? `Failed: ${w.error === "ERR_SIGNER_FAILED" ? "the signing network didn't answer in time" : w.error}. Nothing was sent.` : `Signature ${w.index + 1} · ${meta.name} ${meta.network}`}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <StatusPill stage={w.status === "failed" ? "failed" : data?.stage} />
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
