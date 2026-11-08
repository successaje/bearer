import { Ban, Clock, Link2, ShieldCheck, Tag, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import type { Verdict } from "@/lib/bearer/seal";
import type { CardStatus } from "@/lib/bearer/types";
import { cn } from "@/lib/utils";

type Tone = "ok" | "warn" | "danger" | "info" | "gold" | "neutral";

const TONES: Record<Tone, string> = {
  ok: "border-ok/30 bg-ok/10 text-ok",
  warn: "border-warn/35 bg-warn/10 text-warn",
  danger: "border-danger/35 bg-danger/10 text-danger",
  info: "border-info/30 bg-info/10 text-info",
  gold: "border-gold/40 bg-gold/12 text-accent",
  neutral: "border-line-strong bg-raised text-fg-2",
};

export function Badge({
  tone,
  icon,
  children,
  className,
}: {
  tone: Tone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[26px] shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] font-medium [&_svg]:size-3.5",
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

const STATUS: Record<CardStatus, { tone: Tone; icon: ReactNode; label: string }> = {
  sealed: { tone: "ok", icon: <ShieldCheck aria-hidden />, label: "Sealed" },
  pending_signature: { tone: "info", icon: <Clock aria-hidden />, label: "Pending signature" },
  listed: { tone: "gold", icon: <Tag aria-hidden />, label: "Listed" },
  claim_pending: { tone: "neutral", icon: <Link2 aria-hidden />, label: "Claim pending" },
  action_needed: { tone: "warn", icon: <TriangleAlert aria-hidden />, label: "Unsealed: action needed" },
};

export function StatusBadge({ status, className }: { status: CardStatus; className?: string }) {
  const s = STATUS[status];
  return (
    <Badge tone={s.tone} icon={s.icon} className={className}>
      {s.label}
    </Badge>
  );
}

const VERDICT: Record<Verdict, { tone: Tone; icon: ReactNode; label: string }> = {
  sealed: { tone: "ok", icon: <ShieldCheck aria-hidden />, label: "Sealed" },
  sealed_with_exclusions: { tone: "warn", icon: <TriangleAlert aria-hidden />, label: "Sealed, with exclusions" },
  not_transferable: { tone: "danger", icon: <Ban aria-hidden />, label: "Not transferable yet" },
};

export function VerdictBadge({ verdict, className }: { verdict: Verdict; className?: string }) {
  const v = VERDICT[verdict];
  return (
    <Badge tone={v.tone} icon={v.icon} className={className}>
      {v.label}
    </Badge>
  );
}
