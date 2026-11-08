import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { Seal, type SealVariant } from "@/components/brand/seal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function EmptyState({
  seal = "monogram",
  title,
  children,
  action,
  className,
}: {
  seal?: SealVariant;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-[20px] border border-dashed border-line-strong bg-surface px-6 py-14 text-center sm:py-20",
        className,
      )}
    >
      <Seal variant={seal} className="size-16" />
      <h2 className="mt-6 text-[22px] font-semibold tracking-[-0.02em]">{title}</h2>
      {children ? <div className="mt-2 max-w-[420px] text-[15px] leading-relaxed text-fg-2">{children}</div> : null}
      {action ? <div className="mt-7 flex flex-wrap justify-center gap-3">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <EmptyState seal="cracked" title="We couldn't load this" action={onRetry ? <Button onClick={onRetry}><RefreshCw className="size-4" />Try again</Button> : null}>
      <p>{message}</p>
    </EmptyState>
  );
}
