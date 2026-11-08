"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export const CHAPTERS = [
  { id: "seal", label: "Seal" },
  { id: "transfer", label: "Transfer" },
  { id: "reject", label: "Reject" },
  { id: "open", label: "Open" },
  { id: "verify", label: "Verify" },
] as const;

/**
 * Sticky mono index beside the chapters, after braintrust.dev's section nav. It takes the
 * colour of whichever chapter is under the middle of the screen.
 */
export function ChapterIndex() {
  const [active, setActive] = useState<string | null>(null);
  const [tone, setTone] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const els = CHAPTERS.map((c) => document.getElementById(`chapter-${c.id}`)).filter((e): e is HTMLElement => !!e);
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const el = e.target as HTMLElement;
          setActive(el.dataset.chapter ?? null);
          setTone(el.dataset.tone === "light" ? "light" : "dark");
        }
      },
      { rootMargin: "-49% 0px -50% 0px" },
    );
    for (const el of els) io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <nav aria-label="Chapters" className="pointer-events-auto sticky top-[calc(50vh-84px)] w-[132px]">
      <ol className="flex flex-col gap-1">
        {CHAPTERS.map((c, i) => {
          const on = active === c.id;
          return (
            <li key={c.id}>
              <a
                href={`#chapter-${c.id}`}
                aria-current={on ? "step" : undefined}
                className={cn(
                  "group flex h-7 items-center gap-2.5 font-mono text-[11.5px] tracking-[0.14em] transition-colors duration-300",
                  tone === "dark" ? "text-white/40 hover:text-white/80" : "text-ink/45 hover:text-ink/80",
                  on && (tone === "dark" ? "text-white" : "text-ink"),
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "h-px transition-[width,background-color] duration-300",
                    on ? "w-6" : "w-3",
                    tone === "dark" ? (on ? "bg-gold" : "bg-white/30") : on ? "bg-ink" : "bg-ink/30",
                  )}
                />
                <span className="tabular opacity-70">{String(i + 1).padStart(2, "0")}</span>
                {c.label.toUpperCase()}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
