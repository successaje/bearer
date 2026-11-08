import {
  ArrowDownLeft,
  Ban,
  Check,
  Hourglass,
  Link2,
  PenLine,
  Plus,
  Send,
  ShieldCheck,
  Tag,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import type { ActivityItem, ActivityKind } from "@/lib/bearer/types";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const KIND: Record<ActivityKind, { icon: LucideIcon; tone: string }> = {
  created: { icon: Plus, tone: "bg-raised text-fg-2" },
  deposit: { icon: ArrowDownLeft, tone: "bg-raised text-fg-2" },
  signed: { icon: PenLine, tone: "bg-gold/15 text-accent" },
  broadcast: { icon: Check, tone: "bg-raised text-fg-2" },
  proven: { icon: ShieldCheck, tone: "bg-ok/15 text-ok" },
  handed_over: { icon: Send, tone: "bg-gold/15 text-accent" },
  listed: { icon: Tag, tone: "bg-gold/15 text-accent" },
  delisted: { icon: Undo2, tone: "bg-raised text-fg-2" },
  sold: { icon: Tag, tone: "bg-ok/15 text-ok" },
  claim_created: { icon: Link2, tone: "bg-raised text-fg-2" },
  claim_cancelled: { icon: Ban, tone: "bg-raised text-fg-2" },
  claimed: { icon: Send, tone: "bg-ok/15 text-ok" },
  expired: { icon: Hourglass, tone: "bg-warn/15 text-warn" },
};

export function ActivityList({ items, now, limit }: { items: ActivityItem[]; now: number; limit?: number }) {
  const shown = limit ? items.slice(0, limit) : items;
  if (shown.length === 0) {
    return (
      <div className="rounded-panel border border-dashed border-line-strong px-5 py-8 text-center text-[14px] text-fg-3">
        Nothing has happened on this card yet.
      </div>
    );
  }
  return (
    <ol className="overflow-hidden rounded-panel border border-line bg-surface">
      {shown.map((item, i) => {
        const { icon: Icon, tone } = KIND[item.kind];
        return (
          <li key={item.id} className={cn("flex items-start gap-3.5 px-5 py-4", i > 0 && "border-t border-line")}>
            <span aria-hidden className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-full", tone)}>
              <Icon className="size-[15px]" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium">{item.title}</p>
              <p className="mt-0.5 text-[13px] leading-relaxed text-fg-3">{item.detail}</p>
            </div>
            <time
              dateTime={new Date(item.at).toISOString()}
              className="shrink-0 whitespace-nowrap pt-0.5 text-[12.5px] text-fg-3"
            >
              {now ? relativeTime(item.at, now) : ""}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
