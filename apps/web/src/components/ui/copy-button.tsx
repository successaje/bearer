"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function CopyButton({
  value,
  label,
  className,
  size = "md",
}: {
  value: string;
  /** Accessible name, e.g. "Copy Bitcoin address". */
  label: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Couldn't copy. Select the text and copy it manually.");
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-control border border-line bg-surface-2 text-fg-2 transition-colors hover:bg-raised hover:text-fg",
        size === "md" ? "size-11" : "size-8 rounded-[7px] border-transparent bg-transparent",
        className,
      )}
    >
      {copied ? <Check className="size-4 text-ok" /> : <Copy className={size === "md" ? "size-4" : "size-3.5"} />}
    </button>
  );
}
