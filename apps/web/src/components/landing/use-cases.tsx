"use client";

import type { Finish } from "@bearer/sdk";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BearerCard } from "@/components/card/bearer-card";
import { cn } from "@/lib/utils";

const USES: { tag: string; name: string; finish: Finish; title: string; body: string }[] = [
  {
    tag: "A gift",
    name: "Theo's birthday",
    finish: "obsidian",
    title: "Like cash in a card, on any chain.",
    body: "Fill it with a little Bitcoin and send it on the day. They open it when they're ready, and withdraw where they like.",
  },
  {
    tag: "An OTC hand-off",
    name: "OTC · Desk 7",
    finish: "champagne",
    title: "Hand over a position without moving it.",
    body: "Your counterparty checks that it's sealed and has never signed anything, then you transfer it. Payment between you is up to you.",
  },
  {
    tag: "An inheritance envelope",
    name: "For Mira",
    finish: "midnight",
    title: "Seal it now. Hand it on later.",
    body: "Until someone breaks the seal, nothing can leave. Whoever holds it then is the only one who can open it.",
  },
  {
    tag: "A prize payout",
    name: "Hackathon prize",
    finish: "sage",
    title: "Give the winner the vault itself.",
    body: "One NEAR transaction hands over Bitcoin, ETH on Base and SOL together. The winner withdraws to whichever chain they use.",
  },
];

function readEdges(el: HTMLElement) {
  return { start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth > el.scrollWidth - 8 };
}

/** Horizontal carousel of uses with arrow controls (brief 10.3). */
export function UseCases() {
  const track = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  useEffect(() => {
    const onResize = () => {
      if (track.current) setEdges(readEdges(track.current));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  function step(dir: 1 | -1) {
    const el = track.current;
    const card = el?.querySelector("li");
    if (!el || !card) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * (card.clientWidth + 20), behavior: smooth ? "smooth" : "auto" });
  }

  const arrow =
    "inline-flex size-11 items-center justify-center rounded-full border border-line-strong bg-surface-2 text-fg transition-[opacity,background-color] hover:bg-raised disabled:opacity-35";

  return (
    <section aria-labelledby="uses-title" className="mx-auto max-w-[1200px] px-5 pt-24 md:px-8 md:pt-32">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div data-reveal>
          <p className="font-mono text-[11.5px] font-medium uppercase tracking-[0.16em] text-accent">Uses</p>
          <h2
            id="uses-title"
            className="text-balance mt-3 max-w-[620px] text-[clamp(32px,3.6vw,46px)] font-semibold leading-[1.06] tracking-[-0.035em]"
          >
            Anything you&apos;d put in an envelope. <span className="text-fg-3">And hand to someone.</span>
          </h2>
        </div>
        <div className="flex gap-2">
          <button type="button" aria-label="Previous use" className={arrow} disabled={edges.start} onClick={() => step(-1)}>
            <ArrowLeft className="size-[18px]" />
          </button>
          <button type="button" aria-label="Next use" className={arrow} disabled={edges.end} onClick={() => step(1)}>
            <ArrowRight className="size-[18px]" />
          </button>
        </div>
      </div>

      <ul
        ref={track}
        onScroll={(e) => setEdges(readEdges(e.currentTarget))}
        aria-label="Uses"
        className="-mx-5 mt-10 flex snap-x snap-mandatory scroll-px-5 gap-5 overflow-x-auto px-5 pb-4 [scrollbar-width:none] md:-mx-8 md:scroll-px-8 md:px-8 [&::-webkit-scrollbar]:hidden"
      >
        {USES.map((u, i) => (
          <li
            key={u.tag}
            data-reveal
            style={{ "--reveal-delay": `${i * 70}ms` } as React.CSSProperties}
            className="w-[min(340px,82vw)] shrink-0 snap-start sm:w-[380px]"
          >
            <article className="flex h-full flex-col overflow-hidden rounded-[22px] border border-line bg-surface">
              <div className={cn("relative flex items-center justify-center overflow-hidden px-10 py-9", i % 2 ? "bg-surface-2" : "bg-raised")}>
                <div aria-hidden className="guilloche absolute inset-0 opacity-60" />
                <div className="relative w-full max-w-[260px] -rotate-2 transition-transform duration-300 hover:rotate-0">
                  <BearerCard name={u.name} finish={u.finish} chains={["btc", "evm", "sol"]} />
                </div>
              </div>
              <div className="flex flex-1 flex-col p-6">
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">{u.tag}</p>
                <h3 className="mt-2.5 text-[19px] font-semibold leading-snug tracking-[-0.02em]">{u.title}</h3>
                <p className="mt-2 text-[14.5px] leading-relaxed text-fg-2">{u.body}</p>
              </div>
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}
