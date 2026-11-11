"use client";

import type { VaultLoan } from "@bearer/sdk";
import Link from "next/link";
import type { ReactNode } from "react";
import { ChainStack } from "@/components/brand/chain-icon";
import { BearerCard } from "@/components/card/bearer-card";
import { EmptyState, ErrorState } from "@/components/layout/page-states";
import { formatWhen, untilText } from "@/components/schedule/when";
import { buttonVariants } from "@/components/ui/button";
import { Eyebrow, SimulatedTag, Skeleton } from "@/components/ui/primitives";
import { IS_SIMULATED, LEND_CONTRACT } from "@/lib/config";
import { formatNear, formatUsd, nsToMs, relativeTime, vaultNumber } from "@/lib/vault/format";
import { useLoans, useNow, useObservation, useVault } from "@/lib/vault/hooks";
import { observedUsd } from "@/lib/vault/report";
import { dueMs, interestPercent, LendLock, termMs, termText } from "./lend-bits";

const STEPS = [
  ["Pledge", "The borrower sends a sealed vault to the lending contract, with how much they want, how much they'll repay and by when."],
  ["Lend", "A lender checks what's inside and pays exactly that amount. It goes straight to the borrower; the term starts."],
  ["Settle", "Repaid in time, the vault goes back to the borrower before the lender is paid. If not, the lender takes it."],
] as const;

/** Loan requests to fund, and loans running, each backed by a sealed vault in escrow. */
export function LendView() {
  const loans = useLoans();
  const now = useNow(10_000);
  const all = loans.data ?? [];
  const open = all.filter((l) => l.state.kind === "requested");
  const running = all.filter((l) => l.state.kind !== "requested");

  return (
    <div className="mx-auto max-w-[1200px] px-5 pb-20 pt-14 md:px-8 md:pt-20">
      <div className="max-w-[760px]">
        <div className="flex items-center gap-2.5">
          <Eyebrow>Lend</Eyebrow>
          {IS_SIMULATED ? <SimulatedTag /> : null}
        </div>
        <h1 className="text-balance mt-3 text-[clamp(38px,5.4vw,60px)] font-semibold leading-[1.02] tracking-[-0.045em]">
          Borrow against Bitcoin, <span className="text-fg-3">without wrapping it.</span>
        </h1>
        <p className="text-pretty mt-5 text-[17px] leading-relaxed text-fg-2">
          A sealed vault is the collateral. While it&apos;s pledged nobody can withdraw from it, the borrower included, so the
          lender knows what backs the loan is still there.
        </p>
        {LEND_CONTRACT ? (
          <div className="mt-5 text-[13px]">
            <LendLock compact />
          </div>
        ) : null}
      </div>

      <ol className="mt-10 grid gap-px overflow-hidden rounded-panel border border-line bg-line sm:grid-cols-3">
        {STEPS.map(([title, body], i) => (
          <li key={title} className="bg-surface px-5 py-4">
            <p className="font-mono text-[11.5px] uppercase tracking-[0.16em] text-fg-3">
              {i + 1} · <span className="text-accent">{title}</span>
            </p>
            <p className="mt-2 text-[14px] leading-relaxed text-fg-2">{body}</p>
          </li>
        ))}
      </ol>

      {!LEND_CONTRACT ? (
        <div className="mt-10">
          <EmptyState title="No lending contract on this deployment">
            Lending works with vaults of <span className="font-mono">bearer.testnet</span>. This site points at another contract.
          </EmptyState>
        </div>
      ) : loans.isError ? (
        <div className="mt-10">
          <ErrorState error={loans.error} onRetry={() => void loans.refetch()} />
        </div>
      ) : (
        <>
          <section aria-labelledby="open-loans" className="mt-12">
            <h2 id="open-loans" className="text-[22px] font-semibold tracking-[-0.02em]">
              Asking for a loan
            </h2>
            <p className="mt-1 text-[14px] text-fg-3">Fund one and the NEAR goes straight to the borrower.</p>
            <div className="mt-5">
              {loans.isPending ? (
                <Grid>
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-[380px] rounded-[20px]" />
                  ))}
                </Grid>
              ) : open.length === 0 ? (
                <EmptyState
                  title="Nobody is asking right now"
                  action={
                    <Link href="/vaults" className={buttonVariants({ variant: "primary", size: "lg" })}>
                      Borrow against one of your vaults
                    </Link>
                  }
                >
                  Open a sealed vault you hold and choose Borrow against it.
                </EmptyState>
              ) : (
                <Grid>
                  {open.map((l) => (
                    <LoanCard key={l.token_id} loan={l} now={now} />
                  ))}
                </Grid>
              )}
            </div>
          </section>

          {running.length ? (
            <section aria-labelledby="running-loans" className="mt-14">
              <h2 id="running-loans" className="text-[22px] font-semibold tracking-[-0.02em]">
                Running
              </h2>
              <p className="mt-1 text-[14px] text-fg-3">Funded, waiting to be repaid. Each vault stays sealed until then.</p>
              <div className="mt-5">
                <Grid>
                  {running.map((l) => (
                    <LoanCard key={l.token_id} loan={l} now={now} />
                  ))}
                </Grid>
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}

export function LoanCard({ loan, now }: { loan: VaultLoan; now: number }) {
  const vault = useVault(loan.token_id).data;
  const obs = useObservation(vault).data;
  const name = vault?.name ?? `Vault ${loan.token_id}`;
  const held = (obs ?? []).filter((o) => o.confirmed !== "0" || o.pending !== "0");
  const due = dueMs(loan);
  const overdue = due !== null && now >= due;

  return (
    <Link
      href={`/v/${loan.token_id}`}
      className="group block rounded-[20px] border border-line bg-surface p-3.5 transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lifted focus-visible:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      {vault ? (
        <BearerCard name={name} id={vault.token_id} finish={vault.finish} seal="monogram" chains={[]} shadow={false} />
      ) : (
        <Skeleton className="aspect-[1.586] w-full rounded-[14px]" />
      )}
      <div className="px-1.5 pb-1 pt-4">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="truncate text-[16px] font-semibold tracking-[-0.01em]">{name}</h3>
          <p className="tabular shrink-0 text-[18px] font-semibold">{formatNear(loan.principal)}</p>
        </div>
        <p className="tabular mt-1 text-[13px] text-fg-2">
          Repays {formatNear(loan.repayment)} ({interestPercent(loan)}) within {termText(termMs(loan))}
        </p>
        <p className="mt-1 text-[12.5px] text-fg-3">
          <span className="font-mono">{vaultNumber(loan.token_id)}</span> · {loan.borrower}
          {due === null && now ? ` · asked ${relativeTime(nsToMs(loan.requested_at_ns), now)}` : null}
        </p>
        <div className="mt-3.5 flex items-center justify-between gap-3">
          <span
            className={
              overdue
                ? "inline-flex h-6 items-center rounded-full border border-warn/30 bg-warn/10 px-2.5 text-[12px] font-medium text-warn"
                : "inline-flex h-6 items-center rounded-full border border-ok/30 bg-ok/10 px-2.5 text-[12px] font-medium text-ok"
            }
          >
            {due === null
              ? `Sealed · ${vault?.signatures_requested ?? 0} signatures`
              : overdue
                ? "Overdue: the lender can take it"
                : `Due ${untilText(due, now)}`}
          </span>
          {held.length ? <ChainStack chains={held.map((o) => o.chain)} ring="var(--surface)" iconClassName="size-[18px]" /> : null}
        </div>
        <p className="mt-2.5 text-[13px] leading-snug text-fg-3">
          {obs ? (
            held.length ? (
              <>
                Backed by {formatUsd(observedUsd(obs))} est. observed, confirmed only.
                {held.some((o) => o.pending !== "0") ? <span className="text-info"> A deposit is still pending.</span> : null}
              </>
            ) : (
              "Nothing at its addresses yet."
            )
          ) : (
            "Checking its addresses…"
          )}
          {due !== null && !overdue ? <span className="block">Due {formatWhen(due)}.</span> : null}
        </p>
      </div>
    </Link>
  );
}
