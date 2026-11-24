"use client";

import { AlertTriangle, ArrowUpRight, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { explorer } from "@/lib/config";
import { LOCKED_CONTRACTS, PROOF_RPC, TLA_FLEET } from "@/lib/proof/data";
import { type ContractLive, useLockedContracts } from "@/lib/proof/live";
import { useNow } from "@/lib/vault/hooks";
import { formatDate, nsToMs, relativeTime, truncateMiddle } from "@/lib/vault/format";
import { cn } from "@/lib/utils";

const COLS = "md:grid-cols-[minmax(0,1.5fr)_92px_minmax(0,1fr)_minmax(0,1fr)_64px]";

/** A small label shown above each value when the row stacks on a phone. */
function Cell({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-3 md:hidden">{label}</p>
      <div className="mt-1 md:mt-0">{children}</div>
    </div>
  );
}

function Pass({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1 break-all text-[12px]", ok ? "text-ok" : "text-warn")}>
      {ok ? <CheckCircle2 aria-hidden className="size-3.5 shrink-0" /> : <AlertTriangle aria-hidden className="size-3.5 shrink-0" />}
      {children}
    </span>
  );
}

function Keys({ count }: { count: number }) {
  return count === 0 ? (
    <Badge tone="ok" icon={<CheckCircle2 aria-hidden />}>
      None
    </Badge>
  ) : (
    <Badge tone="warn" icon={<AlertTriangle aria-hidden />}>
      {count} key{count > 1 ? "s" : ""}
    </Badge>
  );
}

function TxLink({ hash }: { hash: string }) {
  return (
    <a href={explorer.nearTx(hash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-mono text-[12.5px] text-accent hover:underline">
      tx <ArrowUpRight className="size-3.5" />
    </a>
  );
}

function ContractRow({ c, live }: { c: (typeof LOCKED_CONTRACTS)[number]; live: ContractLive | undefined }) {
  const codeOk = live?.codeHash === c.codeHash;
  const revOk = live?.rev === c.commit;
  return (
    <li className={cn("grid gap-x-5 gap-y-3 px-5 py-4 md:items-start", COLS)}>
      <div className="min-w-0">
        <p className="text-[14px] font-semibold leading-snug">{c.name}</p>
        <a href={explorer.nearAccount(c.account)} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex max-w-full items-center gap-0.5 font-mono text-[12.5px] text-accent hover:underline">
          <span className="truncate">{c.account}</span>
          <ArrowUpRight className="size-3 shrink-0" />
        </a>
        <p className="mt-1 text-[12.5px] leading-snug text-fg-3">{c.role}</p>
      </div>
      <div className="grid grid-cols-2 gap-x-5 gap-y-3 md:contents">
        <Cell label="Keys" className="order-1 md:order-none">
          {live ? <Keys count={live.keys} /> : <Skeleton className="h-6 w-16 rounded-full" />}
        </Cell>
        <Cell label="Code" className="order-3 col-span-2 md:order-none md:col-span-1">
          {live ? (
            <>
              <p className="font-mono text-[12.5px] text-fg-2" title={live.codeHash}>
                {truncateMiddle(live.codeHash, 8, 4)}
              </p>
              <Pass ok={codeOk}>{codeOk ? `= contracts/res/${c.wasm}` : `not ${c.wasm}`}</Pass>
            </>
          ) : (
            <Skeleton className="h-9 w-32" />
          )}
        </Cell>
        <Cell label="Built from" className="order-4 col-span-2 md:order-none md:col-span-1">
          {live ? (
            <>
              {live.link ? (
                <a href={live.link} target="_blank" rel="noreferrer" className="flex w-fit items-center gap-0.5 font-mono text-[12.5px] text-accent hover:underline">
                  {(live.rev ?? c.commit).slice(0, 7)} <ArrowUpRight className="size-3" />
                </a>
              ) : (
                <p className="font-mono text-[12.5px] text-fg-2">{c.commit.slice(0, 7)}</p>
              )}
              <Pass ok={revOk}>{revOk ? (live.image?.replace("sourcescan/", "").replace(/-rust-.*/, "").replace(":", " ") ?? "reproducible") : "names another commit"}</Pass>
            </>
          ) : (
            <Skeleton className="h-9 w-24" />
          )}
        </Cell>
        <Cell label="Locked" className="order-2 md:order-none">
          <TxLink hash={c.lockTx} />
        </Cell>
      </div>
    </li>
  );
}

/** Every Bearer contract on testnet, and the TLA fleet vault names rent from, read live. */
export function LockedContracts() {
  const q = useLockedContracts();
  const now = useNow(5000);
  const d = q.data;
  const byAccount = new Map(d?.contracts.map((c) => [c.account, c]));
  const locked = d?.contracts.filter((c, i) => c.keys === 0 && c.codeHash === LOCKED_CONTRACTS[i].codeHash).length ?? 0;
  const fleet = d?.fleet;
  const fleetLocked = fleet?.accounts.every((a) => a.keys === 0) ?? false;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13.5px] text-fg-3" aria-live="polite">
          {q.isFetching ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="size-3.5 animate-spin" /> Asking NEAR testnet about {LOCKED_CONTRACTS.length + TLA_FLEET.accounts.length + 1} accounts…
            </span>
          ) : d && now ? (
            <>
              <span className={cn("font-medium", locked === LOCKED_CONTRACTS.length ? "text-ok" : "text-warn")}>
                {locked} of {LOCKED_CONTRACTS.length} locked on their reproducible build
              </span>{" "}
              · checked {relativeTime(d.checkedAt, now)} at block {d.blockHeight.toLocaleString("en-US")} via <span className="font-mono">{new URL(PROOF_RPC).host}</span>
            </>
          ) : q.isError ? (
            <span className="text-danger">Couldn&apos;t reach the RPC: {String(q.error).slice(0, 120)}</span>
          ) : null}
        </p>
        <Button size="sm" onClick={() => void q.refetch()} disabled={q.isFetching}>
          <RefreshCw className={cn("size-3.5", q.isFetching && "animate-spin")} />
          Check again
        </Button>
      </div>

      <div className="mt-5 overflow-hidden rounded-panel border border-line bg-surface">
        <div className={cn("hidden gap-5 border-b border-line px-5 py-3 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-3 md:grid", COLS)}>
          <span>Contract</span>
          <span>Keys</span>
          <span>Code on chain</span>
          <span>Built from</span>
          <span>Locked</span>
        </div>
        <ul className="divide-y divide-line">
          {LOCKED_CONTRACTS.map((c) => (
            <ContractRow key={c.account} c={c} live={byAccount.get(c.account)} />
          ))}
        </ul>
      </div>

      <div className="mt-4 rounded-panel border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 max-w-[640px]">
            <p className="text-[15px] font-semibold">The TLA fleet vault names rent from</p>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-fg-2">
              House of Stake&apos;s own contracts, the exact bytes on their testnet accounts, deployed by Bearer under{" "}
              <span className="font-mono">{TLA_FLEET.root}</span>. The council renewed the TLA, then every key was deleted, the
              council&apos;s last, so nobody can change fees, move a name or renew the TLA again.
            </p>
          </div>
          {fleet ? (
            <Badge tone={fleetLocked ? "ok" : "warn"} icon={fleetLocked ? <CheckCircle2 aria-hidden /> : <AlertTriangle aria-hidden />}>
              {fleetLocked ? "No keys on any of the five" : "Keys left"}
            </Badge>
          ) : null}
        </div>

        <ul className="mt-4 divide-y divide-line border-y border-line">
          {TLA_FLEET.accounts.map((a) => {
            const live = fleet?.accounts.find((x) => x.account === a.account);
            const codeOk = a.codeHash === null ? /^1+$/.test(live?.codeHash ?? "") : live?.codeHash === a.codeHash;
            return (
              <li key={a.account} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 py-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto_auto]">
                <div className="min-w-0">
                  <a href={explorer.nearAccount(a.account)} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-0.5 font-mono text-[12.5px] text-accent hover:underline">
                    <span className="truncate">{a.account}</span>
                    <ArrowUpRight className="size-3 shrink-0" />
                  </a>
                  <p className="text-[12.5px] leading-snug text-fg-3">{a.role}</p>
                </div>
                <div className="order-last col-span-2 sm:order-none sm:col-span-1">
                  {live ? <Pass ok={codeOk}>{a.codeHash === null ? (codeOk ? "no code: a plain account" : "runs code") : codeOk ? "House of Stake's code, pinned" : "different code"}</Pass> : <Skeleton className="h-4 w-40" />}
                </div>
                {live ? <Keys count={live.keys} /> : <Skeleton className="h-6 w-16 rounded-full" />}
                <span className="hidden sm:inline">
                  <TxLink hash={a.lockTx} />
                </span>
              </li>
            );
          })}
        </ul>

        {fleet ? (
          <dl className="mt-4 grid gap-4 text-[13.5px] sm:grid-cols-3">
            <div>
              <dt className="text-[12px] text-fg-3">The TLA&apos;s lease</dt>
              <dd className="mt-0.5 font-medium">
                {fleet.tlaLifecycle} until {formatDate(nsToMs(fleet.tlaExpiresAtNs))}
              </dd>
            </div>
            <div>
              <dt className="text-[12px] text-fg-3">Last possible renewal of anything</dt>
              <dd className="mt-0.5 font-medium">{formatDate(nsToMs(fleet.rateStaleAtNs))}, when its frozen price goes stale</dd>
            </div>
            <div>
              <dt className="text-[12px] text-fg-3">
                The shared wallet every name runs, <span className="font-mono">{TLA_FLEET.walletImpl}</span>
              </dt>
              <dd className="mt-0.5 font-medium">
                {fleet.walletImplKeys} key{fleet.walletImplKeys === 1 ? "" : "s"}, House of Stake&apos;s: they can change it
              </dd>
            </div>
          </dl>
        ) : (
          <Skeleton className="mt-4 h-12" />
        )}
      </div>
    </div>
  );
}
