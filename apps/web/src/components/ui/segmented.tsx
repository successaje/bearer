"use client";

import { Tabs } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const SegmentedRoot = Tabs.Root;
export const SegmentedContent = Tabs.Content;

export function SegmentedList({ className, ...props }: ComponentProps<typeof Tabs.List>) {
  return (
    <Tabs.List
      className={cn(
        "flex gap-1 rounded-[12px] border border-line bg-bg p-1",
        className,
      )}
      {...props}
    />
  );
}

export function SegmentedTrigger({ className, ...props }: ComponentProps<typeof Tabs.Trigger>) {
  return (
    <Tabs.Trigger
      className={cn(
        "inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-[8px] px-3 text-[14px] text-fg-2 transition-colors",
        "hover:text-fg data-[state=active]:bg-raised data-[state=active]:font-medium data-[state=active]:text-fg data-[state=active]:shadow-[0_1px_0_rgb(255_255_255/0.04)]",
        className,
      )}
      {...props}
    />
  );
}
