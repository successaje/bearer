import type { CSSProperties } from "react";
import type { ChainTag } from "@bearer/sdk";
import { CHAIN_META } from "@/lib/vault/format";
import { cn } from "@/lib/utils";

/** The chains a card can show: the vault's own addresses, plus NEAR, which a v2 vault holds itself. */
export type CardChain = ChainTag | "near";

const chainName = (c: CardChain) => (c === "near" ? "NEAR" : CHAIN_META[c].name);

export function ChainIcon({
  chain,
  className,
  ring,
  label,
}: {
  chain: CardChain;
  className?: string;
  /** Color of a 2px ring, used when icons overlap in a stack. */
  ring?: string;
  /** Pass a label when the icon is the only thing naming the chain. */
  label?: boolean;
}) {
  const style: CSSProperties | undefined = ring ? { boxShadow: `0 0 0 2px ${ring}` } : undefined;
  const a11y = label ? { role: "img", "aria-label": chainName(chain) } : { "aria-hidden": true };
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
      {chain === "near" ? (
        <>
          <circle cx="12" cy="12" r="12" fill="#00EC97" />
          <path d="M8 7.2h1.6l6 7V7.2h1.5v9.6h-1.6l-6-7v7H8z" fill="#111" />
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
  chains: CardChain[];
  ring: string;
  className?: string;
  iconClassName?: string;
}) {
  const names = chains.map(chainName).join(", ");
  return (
    <span className={cn("flex", className)} role="img" aria-label={names}>
      {chains.map((chain, i) => (
        <ChainIcon key={chain} chain={chain} ring={ring} className={cn("size-5", i > 0 && "-ml-1.5", iconClassName)} />
      ))}
    </span>
  );
}
