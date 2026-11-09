"use client";

import type { AttackKind, VaultView } from "@bearer/sdk";
import { FlaskConical, Play, Search, ShieldCheck } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { SimulatedTag } from "@/components/ui/primitives";
import { useRunAttack } from "@/lib/vault/hooks";
import { attackScenarios, recordedScenarios } from "@/lib/vault/report";
import { BEARER_CONTRACT, IS_SIMULATED, explorer } from "@/lib/config";
import { RECORDED_ATTACKS } from "@/lib/vault/recorded-attacks";
import { cn } from "@/lib/utils";

interface LogLine {
  id: number;
  kind: AttackKind;
  text: string;
  tone: "cmd" | "ok" | "fail" | "dim";
  href?: string;
}

/**
 * The threat model's attacks and each refusal (brief 3.4 Flow F, 10.2). In the simulated demo they
 * run against this vault. Against the real contract they were sent as real transactions by test
 * accounts, and "Check" re-reads each one's outcome from NEAR. Every line names the test that proves it.
 */
export function AttackLab({ vault, compact = false }: { vault?: VaultView; compact?: boolean }) {
  const headingId = useId();
  const recorded = !IS_SIMULATED;
  const scenarios = vault && !recorded ? attackScenarios(vault) : recordedScenarios(RECORDED_ATTACKS);
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
      const r = await run.mutateAsync({ id: vault?.token_id ?? "", kind });
      setLog((l) => [
        ...l,
        r.rejected
          ? { id: id + 1, kind, text: `✓ ${recorded ? "refused on chain" : "rejected"}: ${r.errorCode}`, tone: "ok" }
          : { id: id + 1, kind, text: "✗ accepted (this should never happen)", tone: "fail" },
        r.txHash
          ? { id: id + 2, kind, text: `  tx ${r.txHash.slice(0, 10)}… · test: ${r.testName}`, tone: "dim", href: explorer.nearTx(r.txHash) }
          : { id: id + 2, kind, text: `  test: ${r.testName}`, tone: "dim" },
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

  if (!scenarios.length) {
    return (
      <section aria-labelledby={headingId} className="rounded-panel border border-line bg-surface p-5">
        <h2 id={headingId} className="flex items-center gap-2 text-[15px] font-semibold">
          <FlaskConical className="size-4 text-accent" aria-hidden />
          Attack lab
        </h2>
        <p className="mt-1 text-[13px] leading-relaxed text-fg-3">
          No attacks were recorded against <span className="font-mono">{BEARER_CONTRACT}</span>. Each one is a sandbox test
          (<span className="font-mono">pnpm test:contracts</span>).
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby={headingId} className="overflow-hidden rounded-panel border border-line bg-surface">
      <div className="flex items-start justify-between gap-3 border-b border-line p-5">
        <div>
          <h2 id={headingId} className="flex items-center gap-2 text-[15px] font-semibold">
            <FlaskConical className="size-4 text-accent" aria-hidden />
            Attack lab
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-fg-3">
            {recorded
              ? `Sent to ${BEARER_CONTRACT} as real transactions on 9 Nov. Check one: your browser reads the contract's answer from NEAR.`
              : "Try to cheat. The contract refuses each one."}
          </p>
        </div>
        {IS_SIMULATED ? <SimulatedTag className="mt-0.5" /> : null}
      </div>
      <ul className="divide-y divide-line">
        {shown.map((s) => (
          <li key={s.kind} className="flex items-center gap-3 px-5 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-medium">{s.title}</p>
              {/* Recorded rows also name the call, so they wrap rather than widen the column on phones. */}
              <p className={cn("mt-0.5 font-mono text-[11.5px] text-fg-3", recorded ? "break-words" : "truncate")}>
                {recorded ? `${s.call} · ` : null}expects {s.expected}
              </p>
            </div>
            <Button size="sm" onClick={() => void execute(s.kind)} disabled={running !== null} aria-label={`${recorded ? "Check" : "Run"}: ${s.title}`}>
              {recorded ? <Search className="size-3" /> : <Play className="size-3" />}
              {recorded ? "Check" : "Run"}
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
                {l.href ? (
                  <a href={l.href} target="_blank" rel="noreferrer" className="underline decoration-[#3a3a42] underline-offset-2 hover:text-[#d4d4d8]">
                    {l.text}
                  </a>
                ) : (
                  l.text
                )}
              </p>
            ))
          )}
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-[11.5px] text-[#8b8b94]">
            <ShieldCheck className="size-3.5" aria-hidden />
            {recorded ? "Real transactions, read from an archival node" : "Same checks as the sandbox tests"}
          </span>
          <button
            type="button"
            onClick={() => void runAll()}
            disabled={running !== null}
            className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#2a2a31] px-2.5 text-[12px] font-medium text-[#f4f4f5] transition-colors hover:bg-[#17171c] disabled:opacity-50"
          >
            {recorded ? <Search className="size-3" /> : <Play className="size-3" />}
            {recorded ? "Check all" : "Run all"}
          </button>
        </div>
      </div>
    </section>
  );
}
