"use client";

import type { HandoverSchedule } from "@bearer/sdk";
import Link from "next/link";
import { BearerCard } from "@/components/card/bearer-card";
import { Skeleton } from "@/components/ui/primitives";
import { vaultNumber } from "@/lib/vault/format";
import { useVault } from "@/lib/vault/hooks";
import { formatWhen, nsToMsNumber, untilText } from "./when";

/** A scheduled vault in a grid: whose it'll be, when, and from whom. */
export function ScheduleCard({ schedule, viewer, now }: { schedule: HandoverSchedule; viewer: string | null; now: number }) {
  const vault = useVault(schedule.token_id).data;
  const name = vault?.name ?? `Vault ${schedule.token_id}`;
  const at = nsToMsNumber(schedule.release_at_ns);
  const due = now >= at;
  return (
    <Link
      href={`/v/${schedule.token_id}`}
      className="group block rounded-[20px] border border-line bg-surface p-3.5 transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lifted focus-visible:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      {vault ? (
        <BearerCard name={name} id={vault.token_id} finish={vault.finish} seal="monogram" chains={[]} shadow={false} />
      ) : (
        <Skeleton className="aspect-[1.586] w-full rounded-[14px]" />
      )}
      <div className="px-1.5 pb-1 pt-4">
        <h3 className="truncate text-[16px] font-semibold tracking-[-0.01em]">{name}</h3>
        <p className="mt-1 truncate text-[12.5px] text-fg-3">
          <span className="font-mono">{vaultNumber(schedule.token_id)}</span> ·{" "}
          {viewer === schedule.recipient ? `from ${schedule.giver}` : `for ${schedule.recipient}`}
        </p>
        <div className="mt-3.5 flex items-center justify-between gap-3">
          <span className="inline-flex h-6 items-center rounded-full border border-gold/35 bg-gold/10 px-2.5 text-[12px] font-medium text-accent">
            {due ? "Ready to hand over" : now ? untilText(at, now) : "Scheduled"}
          </span>
          <span className="text-[12px] text-fg-3">{schedule.cancellable ? "Cancellable" : "Can't be cancelled"}</span>
        </div>
        <p className="tabular mt-2.5 text-[13px] text-fg-3">On or after {formatWhen(at)}</p>
      </div>
    </Link>
  );
}
