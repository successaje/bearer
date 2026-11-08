import { ArrowUpRight } from "lucide-react";
import type { CSSProperties } from "react";
import { BTC_CALLBACK, LATENCY, type Series } from "@/lib/proof/data";
import { cn } from "@/lib/utils";

const MAX_MS = 10_000;
const TICKS = [0, 2_500, 5_000, 7_500, 10_000];

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

function SeriesRows({ series, index }: { series: Series; index: number }) {
  const times = series.runs.map((r) => r.ms);
  const med = median(times);
  const showMedian = series.kind === "repeats" && series.runs.length > 1;
  return (
    <div className={cn("grid gap-x-6 gap-y-3 py-6 lg:grid-cols-[260px_minmax(0,1fr)]", index === 0 ? "pt-0" : "border-t border-line")}>
      <div>
        <h3 className="text-[15.5px] font-semibold">{series.title}</h3>
        <p className="mt-1 text-[13px] leading-snug text-fg-3">{series.detail}</p>
        <p className="mt-3 flex items-baseline gap-2">
          <span className="tabular text-[26px] font-semibold tracking-[-0.03em]">
            {series.kind === "sweep" ? `${secs(Math.min(...times))}–${secs(Math.max(...times))}` : secs(med)}
          </span>
          <span className="text-[12.5px] text-fg-3">
            {series.kind === "sweep" ? "one run each" : series.runs.length > 1 ? "median" : "single run"} · N ={" "}
            {series.runs.length}
          </span>
        </p>
      </div>
      <div className="relative">
        {/* Median marker */}
        {showMedian ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 z-10 border-l border-dashed border-fg-3/60"
            style={{ left: `calc(64px + (100% - 64px - 64px) * ${med / MAX_MS})` }}
          />
        ) : null}
        <ol data-reveal className="flex flex-col gap-1.5" aria-label={`${series.title}: ${series.measures}`}>
          {series.runs.map((r, i) => (
            <li key={i} className="grid grid-cols-[64px_minmax(0,1fr)_64px] items-center gap-0">
              <span className="font-mono text-[11px] text-fg-3">
                {series.id === "btc" ? `${i + 1} input${i ? "s" : ""}` : `run ${i + 1}`}
              </span>
              <div className="relative h-6 overflow-hidden rounded-[6px] bg-raised">
                <div
                  className="bar-fill absolute inset-y-0 left-0 rounded-[6px] bg-gold"
                  style={{ width: `${(r.ms / MAX_MS) * 100}%`, "--bar-delay": `${(index * 5 + i) * 60}ms` } as CSSProperties}
                />
              </div>
              {r.tx ? (
                <a href={r.tx} target="_blank" rel="noreferrer" className="tabular inline-flex items-center justify-end gap-0.5 text-right font-mono text-[11.5px] text-fg-2 hover:text-fg">
                  {secs(r.ms)}
                  <ArrowUpRight className="size-3 opacity-60" />
                </a>
              ) : (
                <span className="tabular text-right font-mono text-[11.5px] text-fg-2">{secs(r.ms)}</span>
              )}
            </li>
          ))}
        </ol>
        <p className="mt-2 pl-[64px] text-[12px] text-fg-3">{series.measures}</p>
      </div>
    </div>
  );
}

/** Per-run latency, one bar per measured run, with the median marked. No smoothing, no extrapolation. */
export function LatencyChart() {
  return (
    <div className="rounded-panel border border-line bg-surface p-5 sm:p-7">
      <div className="mb-6 hidden grid-cols-[260px_minmax(0,1fr)] gap-x-6 lg:grid">
        <span />
        <div className="grid grid-cols-[64px_minmax(0,1fr)_64px]">
          <span />
          <div className="relative h-4">
            {TICKS.map((t) => (
              <span key={t} className="tabular absolute -translate-x-1/2 font-mono text-[10.5px] text-fg-3" style={{ left: `${(t / MAX_MS) * 100}%` }}>
                {t / 1000}s
              </span>
            ))}
          </div>
          <span />
        </div>
      </div>
      {LATENCY.map((s, i) => (
        <SeriesRows key={s.id} series={s} index={i} />
      ))}
    </div>
  );
}

/** Bitcoin: gas the callback reserves vs what it used, and the whole transaction vs NEAR's limit. */
export function GasChart() {
  const { used, reservedTgas, txLimitTgas } = BTC_CALLBACK;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-panel border border-line bg-surface p-5 sm:p-6">
        <h3 className="text-[15px] font-semibold">Callback gas: reserved vs used</h3>
        <p className="mt-1 text-[13px] text-fg-3">
          The callback checks every signature, then builds the transaction. It reserves {reservedTgas} Tgas so it can
          never run out.
        </p>
        <ul data-reveal className="mt-5 flex flex-col gap-2">
          {used.map((u, i) => (
            <li key={u.inputs} className="grid grid-cols-[64px_minmax(0,1fr)_72px] items-center">
              <span className="font-mono text-[11px] text-fg-3">
                {u.inputs} input{u.inputs > 1 ? "s" : ""}
              </span>
              <div className="relative h-6 overflow-hidden rounded-[6px]">
                <div className="hatch absolute inset-0 rounded-[6px] text-fg-3/35 ring-1 ring-inset ring-line-strong" />
                <div
                  className="bar-fill absolute inset-y-0 left-0 rounded-[6px] bg-gold"
                  style={{ width: `${(u.tgas / reservedTgas) * 100}%`, "--bar-delay": `${i * 80}ms` } as CSSProperties}
                />
              </div>
              <span className="tabular text-right font-mono text-[11.5px] text-fg-2">{u.tgas.toFixed(1)} Tgas</span>
            </li>
          ))}
        </ul>
        <Legend items={[["solid", "used"], ["hatch", `reserved (${reservedTgas} Tgas)`]]} />
      </div>
      <div className="rounded-panel border border-line bg-surface p-5 sm:p-6">
        <h3 className="text-[15px] font-semibold">Whole withdrawal vs NEAR&apos;s limit</h3>
        <p className="mt-1 text-[13px] text-fg-3">
          Every receipt in the transaction, signer included, against the {txLimitTgas} Tgas a NEAR transaction may carry.
        </p>
        <ul data-reveal className="mt-5 flex flex-col gap-2">
          {used.map((u, i) => (
            <li key={u.inputs} className="grid grid-cols-[64px_minmax(0,1fr)_72px] items-center">
              <span className="font-mono text-[11px] text-fg-3">
                {u.inputs} input{u.inputs > 1 ? "s" : ""}
              </span>
              <div className="relative h-6 overflow-hidden rounded-[6px] bg-raised">
                <div
                  className="bar-fill absolute inset-y-0 left-0 rounded-[6px] bg-gold"
                  style={{ width: `${(u.total / txLimitTgas) * 100}%`, "--bar-delay": `${i * 80}ms` } as CSSProperties}
                />
              </div>
              <span className="tabular text-right font-mono text-[11.5px] text-fg-2">{u.total.toFixed(1)} Tgas</span>
            </li>
          ))}
        </ul>
        <Legend items={[["solid", "measured"], ["track", `${txLimitTgas} Tgas limit`]]} />
      </div>
    </div>
  );
}

function Legend({ items }: { items: ["solid" | "hatch" | "track", string][] }) {
  return (
    <div className="mt-4 flex flex-wrap gap-4 text-[12px] text-fg-3">
      {items.map(([kind, label]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn(
              "h-2.5 w-4 rounded-[3px]",
              kind === "solid" && "bg-gold",
              kind === "hatch" && "hatch text-fg-3/60 ring-1 ring-inset ring-line-strong",
              kind === "track" && "bg-raised ring-1 ring-inset ring-line-strong",
            )}
          />
          {label}
        </span>
      ))}
    </div>
  );
}
