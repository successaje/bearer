"use client";

import type { VaultSwitch } from "@bearer/sdk";
import Link from "next/link";
import { BearerCard } from "@/components/card/bearer-card";
import { formatWhen, untilText } from "@/components/schedule/when";
import { Skeleton } from "@/components/ui/primitives";
import { formatUsd, relativeTime, vaultNumber } from "@/lib/vault/format";
import { useObservation, useVault } from "@/lib/vault/hooks";
import { observedUsd } from "@/lib/vault/report";
import { dueMs, intervalMs, intervalText, lastCheckInMs } from "./switch-bits";

/** A vault in a switch, as a card: who it goes to and how long the clock has left. */
export function SwitchCard({ sw, viewer, now }: { sw: VaultSwitch; viewer: string | null; now: number }) {
  const vault = useVault(sw.token_id).data;
  const obs = useObservation(vault).data;
  const name = vault?.name ?? `Vault ${sw.token_id}`;
  const due = dueMs(sw);
  const quiet = now >= due;
  const mine = viewer === sw.owner;

  return (
    <Link
      href={`/v/${sw.token_id}`}
      className="group block rounded-[20px] border border-line bg-surface p-3.5 transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lifted focus-visible:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      {vault ? (
        <BearerCard name={name} id={vault.token_id} finish={vault.finish} seal="monogram" chains={[]} shadow={false} />
      ) : (
        <Skeleton className="aspect-[1.586] w-full rounded-[14px]" />
      )}
      <div className="px-1.5 pb-1 pt-4">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="truncate text-[16px] font-semibold tracking-[-0.01em]">{name}</h3>
          <p className="tabular shrink-0 text-[15px] font-semibold">{obs ? formatUsd(observedUsd(obs)) : "…"}</p>
        </div>
        <p className="mt-1 text-[13px] text-fg-2">
          {mine ? (
            <>
              To <span className="font-mono">{sw.beneficiary}</span> after {intervalText(intervalMs(sw))} of silence
            </>
          ) : (
            <>
              From <span className="font-mono">{sw.owner}</span>, if they go quiet for {intervalText(intervalMs(sw))}
            </>
          )}
        </p>
        <p className="mt-1 text-[12.5px] text-fg-3">
          <span className="font-mono">{vaultNumber(sw.token_id)}</span> · last check-in {relativeTime(lastCheckInMs(sw), now)}
        </p>
        <span
          className={
            quiet
              ? "mt-3.5 inline-flex h-6 items-center rounded-full border border-warn/30 bg-warn/10 px-2.5 text-[12px] font-medium text-warn"
              : "mt-3.5 inline-flex h-6 items-center rounded-full border border-ok/30 bg-ok/10 px-2.5 text-[12px] font-medium text-ok"
          }
        >
          {quiet ? (mine ? "Overdue: check in now" : "Due: it can be handed over") : mine ? `Due ${untilText(due, now)}` : `Not before ${formatWhen(due)}`}
        </span>
      </div>
    </Link>
  );
}
