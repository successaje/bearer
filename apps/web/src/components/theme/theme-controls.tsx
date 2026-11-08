"use client";

import { DropdownMenu } from "radix-ui";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme, type ThemePreference } from "./theme-provider";

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

/** Compact theme picker for the header. */
export function ThemeMenu() {
  const { preference, resolved, setPreference } = useTheme();
  const Icon = resolved === "dark" ? Moon : Sun;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label="Change theme"
        className="inline-flex size-9 items-center justify-center rounded-control text-fg-2 transition-colors hover:bg-raised hover:text-fg data-[state=open]:bg-raised data-[state=open]:text-fg"
      >
        <Icon className="size-[18px]" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 min-w-40 rounded-[12px] border border-line-strong bg-surface-2 p-1 shadow-lifted data-[state=open]:animate-panel-in"
        >
          <DropdownMenu.RadioGroup
            value={preference}
            onValueChange={(v) => setPreference(v as ThemePreference)}
          >
            {OPTIONS.map(({ value, label, icon: ItemIcon }) => (
              <DropdownMenu.RadioItem
                key={value}
                value={value}
                className="flex h-9 cursor-pointer select-none items-center gap-2.5 rounded-[8px] px-2.5 text-[14px] text-fg-2 outline-none data-[highlighted]:bg-raised data-[highlighted]:text-fg data-[state=checked]:text-fg"
              >
                <ItemIcon className="size-4" />
                <span className="flex-1">{label}</span>
                <DropdownMenu.ItemIndicator>
                  <Check className="size-4 text-accent" />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Three-way segmented control, used on the gold footer. */
export function ThemeSwitch({ className }: { className?: string }) {
  const { preference, setPreference } = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn("inline-flex rounded-full border border-ink/20 bg-ink/[0.06] p-1", className)}
    >
      {OPTIONS.map(({ value, label, icon: ItemIcon }) => {
        const active = preference === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            onClick={() => setPreference(value)}
            className={cn(
              "inline-flex size-9 items-center justify-center rounded-full text-ink/70 transition-colors hover:text-ink",
              active && "bg-ink text-gold hover:text-gold",
            )}
          >
            <ItemIcon className="size-4" />
          </button>
        );
      })}
    </div>
  );
}
