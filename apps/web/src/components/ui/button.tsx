import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-medium transition-[background-color,border-color,color,box-shadow,opacity] duration-150 ease-out active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-gold font-semibold text-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_10px_30px_-12px_rgb(201_162_39/0.55)] hover:bg-[#d6b03a]",
        secondary: "border border-line-strong bg-surface-2 text-fg hover:border-fg-3/40 hover:bg-raised",
        inverse: "bg-fg text-bg hover:opacity-90",
        ghost: "text-fg-2 hover:bg-raised hover:text-fg",
        danger: "border border-danger/40 bg-danger/10 text-danger hover:bg-danger/15",
        link: "h-auto px-0 text-accent underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-9 rounded-control px-3 text-[13.5px]",
        md: "h-11 rounded-control px-4 text-[15px]",
        lg: "h-[52px] rounded-control px-6 text-base",
        icon: "size-11 rounded-control",
        "icon-sm": "size-9 rounded-control",
      },
    },
    compoundVariants: [{ variant: "link", class: "h-auto px-0" }],
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      type={asChild ? undefined : (type ?? "button")}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
