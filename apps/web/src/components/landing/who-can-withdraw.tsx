import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

interface Row {
  who: string;
  role: string;
  can: boolean;
  note: string;
}

const GROUPS: { title: string; rows: Row[] }[] = [
  {
    title: "Before the transfer",
    rows: [
      { who: "alice.testnet", role: "owner", can: true, note: "breaks the seal first" },
      { who: "bob.testnet", role: "not yet", can: false, note: "doesn't hold it" },
    ],
  },
  {
    title: "After the transfer",
    rows: [
      { who: "alice.testnet", role: "former owner", can: false, note: "ERR_NOT_OWNER" },
      { who: "bob.testnet", role: "owner", can: true, note: "breaks the seal first" },
      { who: "a kept signature", role: "alice's", can: false, note: "none exists · 0 ever requested" },
    ],
  },
];

/**
 * "Who can withdraw?", drawn like braintrust.dev's benchmark bars: solid gold for can,
 * hatched for can't. Every bar is a rule the contract enforces, not a measurement.
 */
export function WhoCanWithdraw() {
  return (
    <section
      data-reveal
      aria-labelledby="who-can-withdraw"
      className="rounded-panel border border-line-strong bg-surface p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 id="who-can-withdraw" className="text-[17px] font-semibold tracking-[-0.015em] text-fg">
          Who can withdraw?
        </h3>
        <div className="flex items-center gap-4 text-[12px] text-fg-3">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-4 rounded-[3px] bg-gold" /> Can
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="hatch h-2.5 w-4 rounded-[3px] text-fg-3/60 ring-1 ring-inset ring-line-strong" /> Can&apos;t
          </span>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-6">
        {GROUPS.map((g, gi) => (
          <div key={g.title}>
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-3">{g.title}</p>
            <ul className="mt-3 flex flex-col gap-2.5">
              {g.rows.map((r, ri) => {
                const before = GROUPS.slice(0, gi).reduce((n, x) => n + x.rows.length, 0);
                const delay = { "--bar-delay": `${120 * (before + ri)}ms` } as CSSProperties;
                return (
                  <li key={r.who + g.title} className="grid grid-cols-[minmax(0,112px)_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[136px_minmax(0,1fr)]">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[12.5px] text-fg">{r.who}</p>
                      <p className="text-[11px] text-fg-3">{r.role}</p>
                    </div>
                    <div className="relative h-9 overflow-hidden rounded-[8px] bg-raised">
                      <div
                        style={delay}
                        className={cn(
                          "bar-fill absolute inset-0 rounded-[8px]",
                          r.can ? "bg-gold" : "hatch text-fg-3/35 ring-1 ring-inset ring-line-strong",
                        )}
                      />
                      <p
                        className={cn(
                          "relative flex h-full items-center justify-between gap-2 px-3 text-[12px]",
                          r.can ? "font-semibold text-ink" : "text-fg-2",
                        )}
                      >
                        <span className="whitespace-nowrap">{r.can ? "Can" : "Can't"}</span>
                        <span className={cn("truncate font-mono text-[11px]", r.can ? "text-ink/70" : "text-fg-3")}>{r.note}</span>
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-6 border-t border-line pt-4 text-[12.5px] leading-relaxed text-fg-3">
        Each bar is a rule the contract enforces, with a sandbox test. No numbers here are measured.
      </p>
    </section>
  );
}
