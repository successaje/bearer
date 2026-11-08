"use client";

import { Dialog } from "radix-ui";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.Close;

/**
 * A bottom sheet on phones and a floating side panel from md up.
 * Radix traps focus and closes on Esc (brief 3.7).
 */
export function SheetContent({
  title,
  description,
  children,
  className,
  footer,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  footer?: ReactNode;
}) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
      <Dialog.Content
        className={cn(
          "fixed z-50 flex flex-col bg-surface-2 text-fg shadow-lifted outline-none",
          "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-[24px] border-t border-line-strong data-[state=open]:animate-sheet-up",
          "md:inset-y-3 md:right-3 md:left-auto md:max-h-none md:w-[460px] md:rounded-[20px] md:border data-[state=open]:md:animate-panel-in",
          className,
        )}
      >
        <div aria-hidden className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-line-strong md:hidden" />
        <div className="flex shrink-0 items-start justify-between gap-4 px-5 pt-4 md:px-6 md:pt-6">
          <div className="min-w-0">
            <Dialog.Title className="text-[21px] font-semibold tracking-[-0.02em]">{title}</Dialog.Title>
            {description ? (
              <Dialog.Description className="mt-1 text-[14px] leading-relaxed text-fg-2">
                {description}
              </Dialog.Description>
            ) : (
              <Dialog.Description className="sr-only">{title}</Dialog.Description>
            )}
          </div>
          <Dialog.Close
            aria-label="Close"
            className="-mr-2 -mt-1 inline-flex size-11 shrink-0 items-center justify-center rounded-control text-fg-2 transition-colors hover:bg-raised hover:text-fg"
          >
            <X className="size-5" />
          </Dialog.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-5 md:px-6">{children}</div>
        {footer ? (
          <div className="shrink-0 border-t border-line px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 md:px-6">
            {footer}
          </div>
        ) : null}
      </Dialog.Content>
    </Dialog.Portal>
  );
}
