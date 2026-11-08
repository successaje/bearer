"use client";

import type { VaultView } from "@bearer/sdk";
import { Repeat } from "lucide-react";
import { useState } from "react";
import { BearerCard, FINISHES } from "@/components/card/bearer-card";
import { formatDate, nsToMs, vaultNumber } from "@/lib/vault/format";
import { isSealed } from "@/lib/vault/report";
import { cn } from "@/lib/utils";

/**
 * The vault as a physical card. Flip it to read the back: its custody, written as
 * endorsements, the way bearer bonds and cheques were signed over (brief 10.2).
 */
export function VaultCard({
  vault,
  valueUsd,
  className,
  flippable = true,
}: {
  vault: VaultView;
  valueUsd?: number | null;
  className?: string;
  flippable?: boolean;
}) {
  const [flipped, setFlipped] = useState(false);
  const sealed = isSealed(vault);
  return (
    <div className={cn("w-full", className)}>
      <div className="[perspective:1400px]">
        <div
          className={cn(
            "relative transition-transform duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)] [transform-style:preserve-3d] motion-reduce:transition-none",
            flipped && "[transform:rotateY(180deg)]",
          )}
        >
          <div className="[backface-visibility:hidden]" aria-hidden={flipped}>
            <BearerCard
              name={vault.name ?? `Vault ${vault.token_id}`}
              id={vault.token_id}
              finish={vault.finish}
              valueUsd={valueUsd}
              seal={sealed ? "monogram" : "opened"}
            />
          </div>
          <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)]" aria-hidden={!flipped}>
            <CardBack vault={vault} />
          </div>
        </div>
      </div>
      {flippable ? (
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={() => setFlipped((f) => !f)}
            aria-pressed={flipped}
            className="inline-flex h-9 items-center gap-2 rounded-full px-3 text-[13px] text-fg-2 transition-colors hover:bg-raised hover:text-fg"
          >
            <Repeat className="size-3.5" />
            {flipped ? "Show the front" : "Flip to see who held it"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function CardBack({ vault }: { vault: VaultView }) {
  const f = FINISHES[vault.finish];
  const sealed = isSealed(vault);
  const rows = vault.custody.slice(-4);
  const earlier = vault.custody.length - rows.length;
  return (
    <div className="@container w-full">
      <div
        className="relative isolate flex aspect-[1.586] w-full flex-col overflow-hidden rounded-[5.2cqw] border p-[5.6cqw] text-left shadow-[0_40px_80px_-30px_rgb(0_0_0/0.55)]"
        style={{ background: f.background, borderColor: f.border, color: f.text }}
      >
        <div aria-hidden className={cn("absolute inset-0 -z-10 opacity-60", f.light ? "guilloche-ink" : "guilloche")} />
        <div className="flex items-baseline justify-between">
          <span className="text-[2.6cqw] font-semibold tracking-[0.26em]" style={{ color: f.muted }}>
            ENDORSEMENTS
          </span>
          <span className="font-mono text-[2.6cqw]" style={{ color: f.muted }}>
            {vaultNumber(vault.token_id)}
          </span>
        </div>
        <ol className="mt-[3cqw] flex flex-1 flex-col justify-end gap-[1.6cqw]">
          {earlier > 0 ? (
            <li className="text-[2.6cqw]" style={{ color: f.muted }}>
              + {earlier} earlier holder{earlier > 1 ? "s" : ""}
            </li>
          ) : null}
          {rows.map((c, i) => {
            const current = i === rows.length - 1;
            return (
              <li
                key={`${c.account_id}-${c.since_ns}`}
                className="flex items-end justify-between gap-[2cqw] border-b pb-[0.8cqw]"
                style={{ borderColor: f.light ? "rgb(43 33 8 / 0.25)" : "rgb(255 255 255 / 0.18)" }}
              >
                <span className="min-w-0 truncate">
                  <span className="mr-[1.4cqw] text-[2.4cqw] uppercase tracking-[0.12em]" style={{ color: f.muted }}>
                    {current ? "Held by" : "Pay to"}
                  </span>
                  <span className={cn("font-mono text-[3.3cqw]", current && "font-semibold")}>{c.account_id}</span>
                </span>
                <span className="shrink-0 text-[2.5cqw]" style={{ color: f.muted }}>
                  {formatDate(nsToMs(c.since_ns))}
                </span>
              </li>
            );
          })}
        </ol>
        <div
          className={cn(
            "absolute right-[5cqw] top-[12cqw] -rotate-[11deg] rounded-[1.4cqw] border-[0.5cqw] px-[2cqw] py-[0.8cqw] text-center font-mono text-[2.4cqw] font-semibold uppercase leading-tight tracking-[0.12em] opacity-90",
            sealed ? "border-[#1F9D55] text-[#1F9D55]" : "border-[#D97706] text-[#D97706]",
          )}
        >
          {sealed ? (
            <>
              Unopened
              <br />0 signatures
            </>
          ) : (
            <>
              Opened
              <br />
              {vault.state.kind === "opened" ? formatDate(nsToMs(vault.state.at_ns)) : ""}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
