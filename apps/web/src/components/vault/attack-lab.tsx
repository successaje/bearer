"use client";

import type { AttackKind, VaultView } from "@bearer/sdk";
import { FlaskConical, Play, ShieldCheck } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { SimulatedTag } from "@/components/ui/primitives";
import { useRunAttack } from "@/lib/vault/hooks";
import { attackScenarios } from "@/lib/vault/report";
import { IS_SIMULATED } from "@/lib/config";
import { cn } from "@/lib/utils";

interface LogLine {
  id: number;
  kind: AttackKind;
  text: string;
  tone: "cmd" | "ok" | "fail" | "dim";
}

/**
 * Runs the threat model's attacks against this vault and shows each refusal
 * (brief 3.4 Flow F, 10.2). Every line names the test that proves it.
 */
export function AttackLab({ vault, compact = false }: { vault: VaultView; compact?: boolean }) {
  const headingId = useId();
  const scenarios = attackScenarios(vault);
  const run = useRunAttack();
  const [log, setLog] = useState<LogLine[]>([]);
  const [running, setRunning] = useState<AttackKind | null>(null);

  async function execute(kind: AttackKind) {
    const s = scenarios.find((x) => x.kind === kind);
    if (!s) return;
    setRunning(kind);
    const id = Date.now();
    setLog((l) => [...l, { id, kind, text: `$ ${s.actor} → ${s.call}`, tone: "cmd" }]);
    try {
      const r = await run.mutateAsync({ id: vault.token_id, kind });
      setLog((l) => [
        ...l,
        r.rejected
          ? { id: id + 1, kind, text: `✓ rejected: ${r.errorCode}`, tone: "ok" }
          : { id: id + 1, kind, text: "✗ accepted (this should never happen)", tone: "fail" },
        { id: id + 2, kind, text: `  test: ${r.testName}`, tone: "dim" },
      ]);
    } catch (e) {
      setLog((l) => [...l, { id: id + 1, kind, text: `! ${String(e)}`, tone: "fail" }]);
    } finally {
      setRunning(null);
    }
  }

  async function runAll() {
    for (const s of scenarios) await execute(s.kind);
  }

  const shown = compact ? scenarios.slice(0, 3) : scenarios;

  return (
    <section aria-labelledby={headingId} className="overflow-hidden rounded-panel border border-line bg-surface">
      <div className="flex items-start justify-between gap-3 border-b border-line p-5">
        <div>
          <h2 id={headingId} className="flex items-center gap-2 text-[15px] font-semibold">
            <FlaskConical className="size-4 text-accent" aria-hidden />
            Attack lab
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-fg-3">Try to cheat. The contract refuses each one.</p>
        </div>
        {IS_SIMULATED ? <SimulatedTag className="mt-0.5" /> : null}
      </div>
      <ul className="divide-y divide-line">
        {shown.map((s) => (
          <li key={s.kind} className="flex items-center gap-3 px-5 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-medium">{s.title}</p>
              <p className="mt-0.5 truncate font-mono text-[11.5px] text-fg-3">expects {s.expected}</p>
            </div>
            <Button size="sm" onClick={() => void execute(s.kind)} disabled={running !== null} aria-label={`Run: ${s.title}`}>
              <Play className="size-3" />
              Run
            </Button>
          </li>
        ))}
      </ul>
      <div className="border-t border-line bg-[#0b0b0f] p-4 text-[#d4d4d8]">
        <div aria-live="polite" className="min-h-[96px] max-h-56 overflow-y-auto font-mono text-[11.5px] leading-relaxed">
          {log.length === 0 ? (
            <p className="text-[#8b8b94]">Results appear here.</p>
          ) : (
            log.map((l) => (
              <p
                key={l.id}
                className={cn(
                  "whitespace-pre-wrap break-words",
                  l.tone === "cmd" && "text-[#e8cd7a]",
                  l.tone === "ok" && "text-[#4acb85]",
                  l.tone === "fail" && "text-[#f26b6b]",
                  l.tone === "dim" && "text-[#8b8b94]",
                )}
              >
                {l.text}
              </p>
            ))
          )}
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-[11.5px] text-[#8b8b94]">
            <ShieldCheck className="size-3.5" aria-hidden />
            Same checks as the sandbox tests
          </span>
          <button
            type="button"
            onClick={() => void runAll()}
            disabled={running !== null}
            className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#2a2a31] px-2.5 text-[12px] font-medium text-[#f4f4f5] transition-colors hover:bg-[#17171c] disabled:opacity-50"
          >
            <Play className="size-3" />
            Run all
          </button>
        </div>
      </div>
    </section>
  );
}
