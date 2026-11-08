"use client";

import type { ChainObservation, ChainTag } from "@bearer/sdk";
import { ChevronDown, ExternalLink, Info } from "lucide-react";
import { ChainIcon } from "@/components/brand/chain-icon";
import { QrDialog } from "@/components/card/qr-dialog";
import { CopyButton } from "@/components/ui/copy-button";
import { Skeleton, SimulatedTag } from "@/components/ui/primitives";
import { IS_SIMULATED, explorer } from "@/lib/config";
import { CHAIN_META, chunkAddress, formatAmount, formatUsd, relativeTime, toUsd, truncateMiddle } from "@/lib/vault/format";

function ExplorerButton({ chain, address }: { chain: ChainTag; address: string }) {
  if (IS_SIMULATED) {
    return (
      <span
        title="Simulated address: no explorer"
        aria-label="Explorer unavailable for simulated addresses"
        className="inline-flex size-11 shrink-0 cursor-not-allowed items-center justify-center rounded-control border border-line bg-surface-2 text-fg-3 opacity-50"
      >
        <ExternalLink className="size-4" />
      </span>
    );
  }
  return (
    <a
      href={explorer.address(chain, address)}
      target="_blank"
      rel="noreferrer"
      aria-label={`View the ${CHAIN_META[chain].name} address on an explorer`}
      className="inline-flex size-11 shrink-0 items-center justify-center rounded-control border border-line bg-surface-2 text-fg-2 transition-colors hover:bg-raised hover:text-fg"
    >
      <ExternalLink className="size-4" />
    </a>
  );
}

export function SlotCardSkeleton() {
  return (
    <div className="rounded-panel border border-line bg-surface p-5">
      <div className="flex items-center gap-3.5">
        <Skeleton className="size-10 rounded-full" />
        <Skeleton className="h-5 w-32" />
        <Skeleton className="ml-auto h-6 w-28" />
      </div>
      <Skeleton className="mt-4 h-11 w-full" />
    </div>
  );
}

export function SlotCard({ obs, now, opened }: { obs: ChainObservation; now: number; opened: boolean }) {
  const meta = CHAIN_META[obs.chain];
  const pending = BigInt(obs.pending) > 0n;
  return (
    <article className="rounded-panel border border-line bg-surface p-5 sm:px-[22px]">
      <div className="flex flex-wrap items-center gap-3.5">
        <ChainIcon chain={obs.chain} className="size-10" />
        <div className="min-w-0 flex-[1_1_160px]">
          <h3 className="text-[16px] font-semibold">{meta.name}</h3>
          <p className="mt-0.5 text-[13px] text-fg-3">{meta.detail}</p>
        </div>
        <div className="text-right">
          <p className="tabular text-[18px] font-semibold">
            {formatAmount(obs.chain, obs.confirmed)} <span className="font-medium text-fg-2">{meta.unit}</span>
          </p>
          <p className="tabular mt-0.5 text-[13px] text-fg-3">
            {pending ? (
              <span className="mr-2 inline-flex h-5 items-center rounded-full bg-info/10 px-2 text-[11.5px] font-medium text-info">
                +{formatAmount(obs.chain, obs.pending)} pending
              </span>
            ) : null}
            {formatUsd(toUsd(obs.chain, obs.confirmed))} est.
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <div
          className="h-11 min-w-0 flex-1 truncate rounded-control border border-line bg-bg px-3.5 font-mono text-[13px] leading-[42px] tracking-[0.02em]"
          title={obs.address}
        >
          {chunkAddress(obs.address)}
        </div>
        <CopyButton value={obs.address} label={`Copy ${meta.name} address`} />
        <QrDialog chain={obs.chain} address={obs.address} />
        <ExplorerButton chain={obs.chain} address={obs.address} />
      </div>

      {obs.chain === "evm" ? (
        <div className="mt-3 flex gap-2.5 rounded-control border border-info/25 bg-info/[0.07] px-3 py-2.5 text-[13px] leading-relaxed">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-info" />
          <span>
            <strong className="font-semibold">Send only on Base Sepolia.</strong> This address exists on every EVM network,
            but this version can only withdraw on Base Sepolia.
          </span>
        </div>
      ) : null}

      <div className="mt-3.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-fg-3">
        <span>
          Observed via {obs.source} · {now ? relativeTime(obs.observedAt, now) : "now"}
        </span>
        <span aria-hidden>·</span>
        <span>
          {opened ? "Withdrawal fee" : "Fee when withdrawn"} ≈ {formatAmount(obs.chain, obs.feeEstimate)} {meta.unit}
        </span>
        {obs.simulated ? <SimulatedTag /> : null}
      </div>

      {obs.deposits.length > 0 ? (
        <details className="group mt-3">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-[12.5px] font-medium text-fg-2 hover:text-fg">
            {obs.deposits.length} deposit{obs.deposits.length > 1 ? "s" : ""}
            <ChevronDown aria-hidden className="size-3.5 transition-transform group-open:rotate-180" />
          </summary>
          <ul className="mt-2 divide-y divide-line rounded-control border border-line bg-bg text-[12.5px]">
            {obs.deposits.slice(0, 5).map((d) => (
              <li key={d.txHash} className="flex items-center gap-3 px-3 py-2">
                <span className="font-mono text-fg-2">{truncateMiddle(d.txHash, 8, 6)}</span>
                <span className="tabular ml-auto font-medium text-ok">
                  +{formatAmount(obs.chain, d.amount)} {meta.unit}
                </span>
                <span className={d.confirmed ? "text-fg-3" : "text-info"}>{d.confirmed ? "confirmed" : "pending"}</span>
                <span className="w-16 text-right text-fg-3">{now ? relativeTime(d.at, now) : ""}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <p className="mt-3 text-[12.5px] text-fg-3">Waiting for a deposit.</p>
      )}
    </article>
  );
}
