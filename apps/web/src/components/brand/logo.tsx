import Link from "next/link";
import { cn } from "@/lib/utils";
import { Seal } from "./seal";

export function Logo({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      aria-label="Bearer home"
      className={cn("inline-flex items-center gap-2.5 rounded-md text-fg", className)}
    >
      <Seal className="size-7" />
      <span className="text-[17px] font-semibold tracking-[-0.02em]">Bearer</span>
    </Link>
  );
}
