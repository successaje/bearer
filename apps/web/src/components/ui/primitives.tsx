import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Small uppercase mono label used above headings and in the footer. */
export function Eyebrow({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      className={cn("font-mono text-[11.5px] font-medium uppercase tracking-[0.16em] text-accent", className)}
      {...props}
    />
  );
}

export function Panel({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("rounded-panel border border-line bg-surface", className)} {...props} />;
}

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-raised", className)} {...props} />;
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-12 w-full min-w-0 rounded-control border border-line-strong bg-surface px-3.5 text-[15px] text-fg outline-none transition-[border-color,box-shadow] duration-150",
        "focus-visible:border-gold focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-gold/20",
        "aria-[invalid=true]:border-danger/60 aria-[invalid=true]:focus-visible:ring-danger/15",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("block text-[13.5px] font-medium text-fg", className)} {...props} />;
}

export function FieldMessage({
  tone = "muted",
  className,
  ...props
}: ComponentProps<"p"> & { tone?: "muted" | "ok" | "error" }) {
  return (
    <p
      className={cn(
        "mt-1.5 text-[12.5px] leading-snug",
        tone === "muted" && "text-fg-3",
        tone === "ok" && "text-ok",
        tone === "error" && "text-danger",
        className,
      )}
      {...props}
    />
  );
}

type CalloutTone = "info" | "warn" | "danger" | "ok" | "neutral";

export function Callout({
  tone = "neutral",
  icon,
  children,
  className,
}: {
  tone?: CalloutTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex gap-2.5 rounded-control border px-3.5 py-3 text-[13.5px] leading-relaxed",
        tone === "info" && "border-info/25 bg-info/[0.07] text-fg",
        tone === "warn" && "border-warn/30 bg-warn/[0.08] text-fg",
        tone === "danger" && "border-danger/30 bg-danger/[0.08] text-fg",
        tone === "ok" && "border-ok/25 bg-ok/[0.07] text-fg",
        tone === "neutral" && "border-line-strong bg-surface-2 text-fg-2",
        className,
      )}
    >
      {icon ? (
        <span
          className={cn(
            "mt-0.5 [&_svg]:size-4",
            tone === "info" && "text-info",
            tone === "warn" && "text-warn",
            tone === "danger" && "text-danger",
            tone === "ok" && "text-ok",
            tone === "neutral" && "text-accent",
          )}
        >
          {icon}
        </span>
      ) : null}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function SimulatedTag({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-[5px] border border-warn/35 bg-warn/10 px-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-warn",
        className,
      )}
    >
      Simulated
    </span>
  );
}
