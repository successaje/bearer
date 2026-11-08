import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type BadgeTone = "ok" | "warn" | "danger" | "info" | "gold" | "neutral";

const TONES: Record<BadgeTone, string> = {
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
  tone: BadgeTone;
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
