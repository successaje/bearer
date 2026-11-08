import type { CSSProperties } from "react";
import { Seal, type SealVariant } from "@/components/brand/seal";
import { ChainStack } from "@/components/brand/chain-icon";
import type { ChainTag, Finish } from "@bearer/sdk";
import { formatUsd, vaultNumber } from "@/lib/vault/format";
import { cn } from "@/lib/utils";

interface FinishStyle {
  label: string;
  background: string;
  border: string;
  text: string;
  muted: string;
  /** Ring around stacked chain icons, matching the card face. */
  ring: string;
  light: boolean;
  swatch: string;
}

export const FINISHES: Record<Finish, FinishStyle> = {
  obsidian: {
    label: "Obsidian",
    background: "radial-gradient(130% 100% at 0% 0%, #2c2c34 0%, #17171c 42%, #0d0d10 100%)",
    border: "rgb(255 255 255 / 0.11)",
    text: "#f4f4f5",
    muted: "#a1a1aa",
    ring: "#17171c",
    light: false,
    swatch: "radial-gradient(130% 100% at 0% 0%, #3a3a44 0%, #17171c 50%, #0d0d10 100%)",
  },
  champagne: {
    label: "Champagne",
    background: "linear-gradient(140deg, #f1e2ae 0%, #d6b651 38%, #a8841d 72%, #7c6012 100%)",
    border: "rgb(255 255 255 / 0.35)",
    text: "#2b2108",
    muted: "rgb(43 33 8 / 0.72)",
    ring: "#c9a227",
    light: true,
    swatch: "linear-gradient(140deg, #f1e2ae 0%, #d6b651 45%, #8c6d14 100%)",
  },
  graphite: {
    label: "Graphite",
    background: "linear-gradient(140deg, #4a4b52 0%, #2a2b30 45%, #17181b 100%)",
    border: "rgb(255 255 255 / 0.14)",
    text: "#f4f4f5",
    muted: "#b4b4bc",
    ring: "#2a2b30",
    light: false,
    swatch: "linear-gradient(140deg, #5a5b62 0%, #2a2b30 55%, #17181b 100%)",
  },
  ivory: {
    label: "Ivory",
    background: "linear-gradient(140deg, #fbf8ef 0%, #e9e3d2 55%, #cfc6ac 100%)",
    border: "rgb(0 0 0 / 0.08)",
    text: "#2b2108",
    muted: "rgb(43 33 8 / 0.62)",
    ring: "#e9e3d2",
    light: true,
    swatch: "linear-gradient(140deg, #fbf8ef 0%, #e9e3d2 55%, #cfc6ac 100%)",
  },
  midnight: {
    label: "Midnight",
    background: "radial-gradient(130% 100% at 0% 0%, #2a3a66 0%, #16203d 45%, #0b1022 100%)",
    border: "rgb(255 255 255 / 0.12)",
    text: "#f4f4f5",
    muted: "#aeb8d6",
    ring: "#16203d",
    light: false,
    swatch: "radial-gradient(130% 100% at 0% 0%, #34477a 0%, #16203d 55%, #0b1022 100%)",
  },
  sage: {
    label: "Sage",
    background: "radial-gradient(130% 100% at 0% 0%, #3b4a40 0%, #1f2922 45%, #101612 100%)",
    border: "rgb(255 255 255 / 0.12)",
    text: "#f4f4f5",
    muted: "#b3c2b8",
    ring: "#1f2922",
    light: false,
    swatch: "radial-gradient(130% 100% at 0% 0%, #4a5c50 0%, #1f2922 55%, #101612 100%)",
  },
};

export const FINISH_ORDER: Finish[] = ["obsidian", "champagne", "graphite", "ivory", "midnight", "sage"];

/**
 * The physical card. Sizes scale with its container (cqw), so it looks right
 * from a 90px illustration up to the hero.
 */
export function BearerCard({
  name,
  id,
  finish,
  valueUsd,
  chains = ["btc", "evm", "sol"],
  seal = "monogram",
  className,
  style,
  shadow = true,
  valueLabel = "Observed value",
}: {
  name: string;
  id?: string;
  finish: Finish;
  valueUsd?: number | null;
  chains?: ChainTag[];
  seal?: SealVariant;
  className?: string;
  style?: CSSProperties;
  shadow?: boolean;
  valueLabel?: string;
}) {
  const f = FINISHES[finish];
  return (
    <div className={cn("@container w-full", className)} style={style}>
      <div
        className={cn(
          "relative isolate flex aspect-[1.586] w-full flex-col justify-between overflow-hidden rounded-[5.2cqw] border p-[6.2cqw] text-left",
          shadow && "shadow-[inset_0_1px_0_rgb(255_255_255/0.08),0_40px_80px_-30px_rgb(0_0_0/0.55)]",
        )}
        style={{ background: f.background, borderColor: f.border, color: f.text }}
      >
        <div aria-hidden className={cn("absolute inset-0 -z-10", f.light ? "guilloche-ink" : "guilloche")} />
        <div className="flex items-start justify-between">
          <span className="text-[2.8cqw] font-semibold tracking-[0.26em]" style={{ color: f.muted }}>
            BEARER
          </span>
          <Seal variant={seal} tone={f.light && seal === "monogram" ? "dark" : "gold"} className="size-[11.5cqw]" />
        </div>
        <div>
          <div className="truncate text-[5.4cqw] font-medium tracking-[-0.02em]">{name}</div>
          {id ? (
            <div className="mt-[0.8cqw] font-mono text-[3cqw]" style={{ color: f.muted }}>
              {vaultNumber(id)}
            </div>
          ) : null}
        </div>
        <div className="flex items-end justify-between">
          {chains.length > 0 ? (
            <ChainStack chains={chains} ring={f.ring} iconClassName="size-[5.6cqw]" />
          ) : (
            <span />
          )}
          {valueUsd !== undefined && valueUsd !== null ? (
            <div className="text-right">
              <div className="text-[2.8cqw]" style={{ color: f.muted }}>
                {valueLabel}
              </div>
              <div className="tabular text-[4.8cqw] font-semibold">
                {formatUsd(valueUsd)}{" "}
                <span className="text-[2.8cqw] font-medium" style={{ color: f.muted }}>
                  est.
                </span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
