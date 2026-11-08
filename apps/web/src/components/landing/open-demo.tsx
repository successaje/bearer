"use client";

import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { Seal } from "@/components/brand/seal";
import { SealPress } from "@/components/vault/seal-press";

/** Chapter 4: the real press-and-hold seal, on a pretend vault. Nothing is sent. */
export function OpenDemo() {
  const [round, setRound] = useState(0);
  const [opened, setOpened] = useState(false);

  return (
    <div className="relative w-full max-w-[440px] rounded-[22px] border border-white/10 bg-white/[0.04] p-6 shadow-lifted backdrop-blur sm:p-8">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-mint">Try it · nothing is sent</p>
        <span className="font-mono text-[11px] text-white/50">No. 0042</span>
      </div>

      <div className="mt-7 flex min-h-[262px] flex-col items-center justify-center">
        {opened ? (
          <div className="flex animate-fade-in flex-col items-center text-center" aria-live="polite">
            <Seal variant="opened" className="size-28" />
            <p className="mt-5 text-[20px] font-semibold tracking-[-0.02em] text-white">Opened · can&apos;t change hands</p>
            <p className="mt-1.5 max-w-[300px] text-[13.5px] leading-relaxed text-white/65">
              Its owner can withdraw now or later, as many times as they like. It can never be transferred again.
            </p>
            <button
              type="button"
              onClick={() => {
                setOpened(false);
                setRound((r) => r + 1);
              }}
              className="mt-6 inline-flex h-9 items-center gap-2 rounded-full border border-white/15 px-3.5 text-[13px] text-white/80 transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              <RotateCcw className="size-3.5" />
              Reset the demo
            </button>
          </div>
        ) : (
          <SealPress key={round} onBreak={() => setOpened(true)} />
        )}
      </div>

      <p className="mt-6 border-t border-white/10 pt-4 text-[12.5px] leading-relaxed text-white/55">
        On a real vault this goes in the same NEAR transaction as the first withdrawal, after a screen that says
        exactly what can&apos;t be undone.
      </p>
    </div>
  );
}
