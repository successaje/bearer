import type { CSSProperties } from "react";
import type { ChainTag } from "@/lib/bearer/types";
import { CHAIN_META } from "@/lib/format";
import { cn } from "@/lib/utils";

export function ChainIcon({
  chain,
  className,
  ring,
  label,
}: {
  chain: ChainTag;
  className?: string;
  /** Color of a 2px ring, used when icons overlap in a stack. */
  ring?: string;
  /** Pass a label when the icon is the only thing naming the chain. */
  label?: boolean;
}) {
  const style: CSSProperties | undefined = ring ? { boxShadow: `0 0 0 2px ${ring}` } : undefined;
  const a11y = label ? { role: "img", "aria-label": CHAIN_META[chain].name } : { "aria-hidden": true };
  return (
    <svg viewBox="0 0 24 24" className={cn("size-6 shrink-0 rounded-full", className)} style={style} {...a11y}>
      {chain === "btc" ? (
        <>
          <circle cx="12" cy="12" r="12" fill="#F7931A" />
          <text
            x="12"
            y="16.6"
            textAnchor="middle"
            fontSize="13"
            fontWeight="700"
            fill="#fff"
            fontFamily="system-ui, -apple-system, sans-serif"
            transform="rotate(12 12 12)"
          >
            ₿
          </text>
        </>
      ) : null}
      {chain === "evm" ? (
        <>
          <circle cx="12" cy="12" r="12" fill="#0052FF" />
          <circle cx="12" cy="12" r="6.6" fill="#fff" />
          <rect x="4.6" y="11.25" width="7.6" height="1.5" fill="#0052FF" />
        </>
      ) : null}
      {chain === "sol" ? (
        <>
          <circle cx="12" cy="12" r="12" fill="#14141A" />
          <path d="M8.3 7h9.2l-1.8 2H6.5z M6.5 11h9.2l1.8 2H8.3z M8.3 15h9.2l-1.8 2H6.5z" fill="url(#bearer-sol)" />
        </>
      ) : null}
    </svg>
  );
}

export function ChainStack({
  chains,
  ring,
  className,
  iconClassName,
}: {
  chains: ChainTag[];
  ring: string;
  className?: string;
  iconClassName?: string;
}) {
  const names = chains.map((c) => CHAIN_META[c].name).join(", ");
  return (
    <span className={cn("flex", className)} role="img" aria-label={names}>
      {chains.map((chain, i) => (
        <ChainIcon key={chain} chain={chain} ring={ring} className={cn("size-5", i > 0 && "-ml-1.5", iconClassName)} />
      ))}
    </span>
  );
}
