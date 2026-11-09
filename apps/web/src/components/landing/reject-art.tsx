"use client";

import { RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { Seal } from "@/components/brand/seal";
import { IS_SIMULATED } from "@/lib/config";
import { cn } from "@/lib/utils";
import { useInView, useReducedMotion } from "./motion";

type Tone = "cmd" | "ok" | "dim" | "note";

// The calls and test names match the attack lab and contracts/tests/vault.test.ts.
const LINES: [Tone, string][] = [
  ["cmd", "$ alice.testnet → withdraw_btc(vault 42)"],
  ["ok", "✓ rejected: ERR_NOT_OWNER"],
  ["note", "  You no longer hold this vault. Only bob.testnet can withdraw from it."],
  ["dim", "  test: alice_cannot_withdraw_after_transfer (T1)"],
  ["cmd", "$ alice.testnet → break_seal(vault 42)"],
  ["ok", "✓ rejected: ERR_NOT_OWNER"],
  ["dim", "  test: alice_cannot_break_seal_after_transfer (T1)"],
  ["cmd", "$ alice.testnet → sign(any payload)"],
  ["ok", "✓ rejected: MethodNotFound"],
  ["dim", "  test: no_privileged_methods (T11)"],
];

/** Chapter 3: the former owner's attempts bounce off the seal, logged like the attack lab. */
export function RejectArt() {
  const [ref, inView] = useInView<HTMLDivElement>();
  const reduced = useReducedMotion();
  const [count, setCount] = useState(LINES.length);

  useEffect(() => {
    const el = ref.current;
    if (!el || reduced) return;
    if (el.getBoundingClientRect().top > window.innerHeight) setCount(0);
  }, [ref, reduced]);

  useEffect(() => {
    if (!inView || count >= LINES.length) return;
    const next = LINES[count]?.[0];
    const t = setTimeout(() => setCount((c) => c + 1), count === 0 ? 400 : next === "cmd" ? 700 : 260);
    return () => clearTimeout(t);
  }, [inView, count]);

  return (
    <div ref={ref} className="relative w-full max-w-[540px]">
      <div className="flex items-center gap-3 rounded-[16px] border border-line bg-surface p-3.5 shadow-lifted">
        <div className="min-w-0 shrink-0">
          <p className="font-mono text-[12px] text-fg">alice.testnet</p>
          <p className="text-[11px] text-fg-3">former owner</p>
        </div>
        <div className="@container relative h-6 flex-1">
          <span aria-hidden className="absolute inset-x-0 top-1/2 border-t border-dashed border-line-strong" />
          <span
            aria-hidden
            className="texture-anim motion-anim absolute top-1/2 -mt-[5px] size-2.5 animate-[bounce-off_3.4s_cubic-bezier(0.4,0,0.2,1)_infinite] rounded-full bg-danger"
          />
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <span className="texture-anim motion-anim rounded-full animate-[impact_3.4s_cubic-bezier(0.4,0,0.2,1)_infinite]">
            <Seal className="size-9" />
          </span>
          <div className="min-w-0">
            <p className="text-[12.5px] font-medium text-fg">No. 0042</p>
            <p className="font-mono text-[11px] text-fg-3">owner bob.testnet</p>
          </div>
        </div>
      </div>

      <div className="mt-3 overflow-hidden rounded-[16px] border border-[#2a2a31] bg-[#0b0b0f] shadow-lifted">
        <div className="flex items-center justify-between gap-3 border-b border-[#1c1c22] px-4 py-2.5">
          <div className="flex items-center gap-1.5" aria-hidden>
            <span className="size-2.5 rounded-full bg-[#2a2a31]" />
            <span className="size-2.5 rounded-full bg-[#2a2a31]" />
            <span className="size-2.5 rounded-full bg-[#2a2a31]" />
          </div>
          <span className="truncate font-mono text-[11px] text-[#8b8b94]">
            example<span className="hidden sm:inline"> · {IS_SIMULATED ? "run it live in the attack lab" : "each refusal is a sandbox test"}</span>
          </span>
          <button
            type="button"
            onClick={() => setCount(0)}
            className="inline-flex h-7 items-center gap-1.5 rounded-[7px] px-2 text-[11.5px] text-[#a1a1aa] transition-colors hover:bg-[#17171c] hover:text-white"
          >
            <RotateCcw className="size-3" />
            Replay
          </button>
        </div>
        <div aria-live="polite" className="min-h-[244px] p-4 font-mono text-[12px] leading-[1.75]">
          {LINES.slice(0, count).map(([tone, text], i) => (
            <p
              key={i}
              className={cn(
                "whitespace-pre-wrap break-words",
                tone === "cmd" && "mt-1.5 text-[#e8cd7a] first:mt-0",
                tone === "ok" && "text-[#4acb85]",
                tone === "note" && "text-[#d4d4d8]",
                tone === "dim" && "text-[#8b8b94]",
              )}
            >
              {text}
            </p>
          ))}
          {count < LINES.length ? <span aria-hidden className="inline-block h-3.5 w-2 animate-pulse bg-[#e8cd7a]/70" /> : null}
        </div>
      </div>
    </div>
  );
}
