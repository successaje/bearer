"use client";

import type { ChainTag } from "@bearer/sdk";
import { Check, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ChainIcon } from "@/components/brand/chain-icon";
import { Seal } from "@/components/brand/seal";
import { BearerCard } from "@/components/card/bearer-card";
import { CHAIN_META } from "@/lib/vault/format";
import { cn } from "@/lib/utils";
import { useInView, useReducedMotion } from "./motion";

const SLOTS: { chain: ChainTag; address: string; amount: string }[] = [
  { chain: "btc", address: "tb1q 8v4z wq7m … 9pdl", amount: "0.00041" },
  { chain: "evm", address: "0x71C7 656E … 9A2f", amount: "0.0042" },
  { chain: "sol", address: "7xKX tg2C … gAsU", amount: "0.032" },
];

/** Two ticks per slot: pending, then confirmed. */
const FINAL = SLOTS.length * 2;

/** Chapter 1: three slots fill with deposits while the seal stays intact. */
export function SealArt() {
  const [ref, inView] = useInView<HTMLDivElement>();
  const reduced = useReducedMotion();
  const [tick, setTick] = useState(FINAL);

  useEffect(() => {
    const el = ref.current;
    if (!el || reduced) return;
    // Below the fold on load: empty the slots so they can fill as the chapter arrives.
    if (el.getBoundingClientRect().top > window.innerHeight) setTick(0);
  }, [ref, reduced]);

  useEffect(() => {
    if (!inView || tick >= FINAL) return;
    const t = setTimeout(() => setTick((x) => x + 1), tick === 0 ? 350 : 650);
    return () => clearTimeout(t);
  }, [inView, tick]);

  return (
    <div ref={ref} className="relative mx-auto w-full max-w-[460px]">
      <div className="@container relative">
        <BearerCard name="Theo's birthday" id="42" finish="obsidian" chains={[]} />
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[5.2cqw]">
          <div className="texture-anim motion-anim absolute inset-y-0 left-0 w-1/3 animate-[glint_5.5s_ease-in-out_infinite] bg-[linear-gradient(90deg,transparent,rgb(255_255_255/0.14),transparent)]" />
        </div>
      </div>

      <ul className="relative z-10 mx-3 -mt-6 flex flex-col gap-2 sm:mx-6" aria-label="Deposit slots">
        {SLOTS.map((s, i) => {
          const pending = tick >= i * 2 + 1;
          const confirmed = tick >= i * 2 + 2;
          return (
            <li
              key={s.chain}
              className={cn(
                "flex h-14 items-center gap-3 rounded-[12px] border bg-surface-2/95 px-3.5 shadow-lifted backdrop-blur transition-colors duration-300",
                confirmed ? "border-ok/30" : "border-line-strong",
              )}
            >
              <ChainIcon chain={s.chain} className="size-7 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium text-fg">{CHAIN_META[s.chain].name}</p>
                <p className="truncate font-mono text-[11.5px] text-fg-3">{s.address}</p>
              </div>
              <span
                className={cn(
                  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition-colors duration-300",
                  confirmed
                    ? "border-ok/30 bg-ok/10 text-ok"
                    : pending
                      ? "border-info/30 bg-info/10 text-info"
                      : "border-dashed border-line-strong text-fg-3",
                )}
              >
                {confirmed ? (
                  <>
                    <Check className="size-3" strokeWidth={3} />
                    <span className="tabular">
                      +{s.amount} {CHAIN_META[s.chain].unit}
                    </span>
                  </>
                ) : pending ? (
                  <>
                    <Loader2 className="size-3 animate-spin" />
                    Pending
                  </>
                ) : (
                  "Waiting for deposit"
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="mx-3 mt-3 flex items-center gap-2.5 rounded-[12px] border border-line bg-surface/80 px-3.5 py-2.5 sm:mx-6">
        <Seal className="size-6 shrink-0" />
        <p className="text-[12.5px] text-fg-2">
          <span className="font-semibold text-fg">Unopened</span> · 0 signatures ever requested
        </p>
      </div>
    </div>
  );
}
