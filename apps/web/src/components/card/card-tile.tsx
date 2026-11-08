import Link from "next/link";
import { ChainStack } from "@/components/brand/chain-icon";
import { cardStatus, computeSealReport, slotTotals } from "@/lib/bearer/seal";
import { CHAINS, type Card } from "@/lib/bearer/types";
import { formatUsd, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BearerCard } from "./bearer-card";
import { StatusBadge } from "./status-badge";

function secondaryLine(card: Card, now: number) {
  const status = cardStatus(card, now);
  switch (status) {
    case "listed":
      return { text: `Listed for ${card.listing?.priceNear} NEAR. Withdrawals locked.`, warn: false };
    case "pending_signature": {
      const p = card.pending[0];
      return { text: `${p.summary}. Requested ${relativeTime(p.requestedAt, now)}.`, warn: false };
    }
    case "claim_pending":
      return {
        text: `Claim link sent ${card.claimLink ? relativeTime(card.claimLink.createdAt, now) : ""}. Not claimed yet.`,
        warn: false,
      };
    case "action_needed":
      return { text: computeSealReport(card, now).detail, warn: true };
    default:
      return { text: `Last activity ${relativeTime(card.activity[0]?.at ?? card.createdAt, now)}`, warn: false };
  }
}

export function CardTile({ card, now }: { card: Card; now: number }) {
  const status = cardStatus(card, now);
  const report = computeSealReport(card, now);
  const totals = slotTotals(card);
  const chains = CHAINS.filter((c) => totals[c].total > 0);
  const line = secondaryLine(card, now);

  return (
    <Link
      href={`/c/${card.id}`}
      className={cn(
        "group block rounded-[20px] border bg-surface p-3.5 transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lifted",
        status === "action_needed" ? "border-warn/30" : "border-line",
      )}
    >
      <BearerCard
        name={card.name}
        id={card.id}
        finish={card.finish}
        seal={status === "action_needed" ? "cracked" : "monogram"}
        chains={[]}
        shadow={false}
      />
      <div className="px-1.5 pb-1 pt-4">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="truncate text-[16px] font-semibold tracking-[-0.01em]">{card.name}</h3>
          <p className="tabular shrink-0 text-[17px] font-semibold">
            {formatUsd(report.sealedUsd)} <span className="text-[12px] font-medium text-fg-3">est.</span>
          </p>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <StatusBadge status={status} />
          {chains.length ? <ChainStack chains={chains} ring="var(--surface)" iconClassName="size-[18px]" /> : null}
        </div>
        <p className={cn("mt-2.5 line-clamp-2 text-[13px] leading-snug", line.warn ? "text-warn" : "text-fg-3")}>{line.text}</p>
      </div>
    </Link>
  );
}
