import { CheckCircle2, CircleDashed, FileText, Hourglass } from "lucide-react";
import type { ReactNode } from "react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { THREATS, type ThreatStatus } from "@/lib/proof/data";

const STATUS: Record<ThreatStatus, { tone: BadgeTone; icon: ReactNode; label: string }> = {
  proven: { tone: "ok", icon: <CheckCircle2 aria-hidden />, label: "Proven" },
  partly: { tone: "warn", icon: <Hourglass aria-hidden />, label: "Partly" },
  open: { tone: "neutral", icon: <CircleDashed aria-hidden />, label: "Not yet" },
  policy: { tone: "info", icon: <FileText aria-hidden />, label: "By design" },
};

/** docs/THREAT_MODEL.md as a table: every attack, the defence, and the tests that prove it. */
export function ThreatTable() {
  return (
    <div className="overflow-hidden rounded-panel border border-line bg-surface">
      <div className="hidden grid-cols-[56px_minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(0,1fr)_120px] gap-5 border-b border-line px-5 py-3 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-3 md:grid">
        <span>#</span>
        <span>Attack</span>
        <span>Defence</span>
        <span>Proved by</span>
        <span>Status</span>
      </div>
      <ul className="divide-y divide-line">
        {THREATS.map((t) => {
          const s = STATUS[t.status];
          return (
            <li key={t.id} className="grid gap-x-5 gap-y-2 px-5 py-4 md:grid-cols-[56px_minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(0,1fr)_120px]">
              <span className="font-mono text-[13px] font-semibold text-accent">{t.id}</span>
              <p className="text-[14px] font-medium leading-snug">{t.attack}</p>
              <p className="text-[13.5px] leading-relaxed text-fg-2">{t.defence}</p>
              <div className="flex flex-wrap content-start gap-1.5">
                {t.tests.length ? (
                  t.tests.map((name) => (
                    <code key={name} className="max-w-full break-all rounded-[6px] border border-line bg-bg px-1.5 py-0.5 font-mono text-[11px] leading-snug text-fg-2">
                      {name}
                    </code>
                  ))
                ) : (
                  <span className="text-[12.5px] text-fg-3">Copy and review, no code path</span>
                )}
              </div>
              <div className="flex flex-col items-start gap-1">
                <Badge tone={s.tone} icon={s.icon}>
                  {s.label}
                </Badge>
                {t.chains ? <span className="text-[11.5px] text-fg-3">{t.chains}</span> : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
