"use client";

import type { ChainObservation, VaultView } from "@bearer/sdk";
import { ArrowUpRight, Check, Fingerprint, KeyRound, Lock, Repeat2, ShieldCheck, Signature } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ChainIcon } from "@/components/brand/chain-icon";
import { CopyButton } from "@/components/ui/copy-button";
import { Skeleton } from "@/components/ui/primitives";
import {
  BEARER_CONTRACT,
  BUILD_COMMIT,
  IS_SIMULATED,
  LEND_CONTRACT,
  SWITCH_CONTRACT,
  MARKET_CONTRACT,
  SCHEDULE_CONTRACT,
  explorer,
} from "@/lib/config";
import type { ContractFacts } from "@/lib/vault/contract-facts";
import { CHAIN_META, formatAmount, formatDate, formatUsd, nsToMs, shortAccount, toUsd } from "@/lib/vault/format";
import { cn } from "@/lib/utils";

/**
 * The column beside the Inside, History, Attack lab and Technical tabs: a short, live summary of
 * what that tab is about, so the space next to it says something useful.
 */
function RailCard({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <section className="rounded-panel border-line bg-surface border p-5">
      <p className="text-fg-3 font-mono text-[11px] font-medium tracking-[0.16em] uppercase">{eyebrow}</p>
      <h3 className="mt-1.5 text-[16px] font-semibold tracking-[-0.01em]">{title}</h3>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Inside: what the vault holds, by chain, with each chain's share of the value. */
export function HoldingsRail({ observations }: { observations: ChainObservation[] | undefined }) {
  const rows = (observations ?? []).map((o) => ({ ...o, usd: toUsd(o.chain, o.confirmed) }));
  const total = rows.reduce((s, r) => s + r.usd, 0);
  const pending = rows.filter((r) => r.pending !== "0");
  return (
    <RailCard eyebrow="At a glance" title="What it holds">
      {observations ? (
        <>
          <p className="tabular text-[30px] leading-none font-semibold tracking-[-0.03em]">{formatUsd(total)}</p>
          <p className="text-fg-3 mt-1.5 text-[12.5px]">est. at mainnet prices, confirmed coins only</p>
          <ul className="mt-5 flex flex-col gap-3.5">
            {rows.map((r) => {
              const share = total > 0 ? (r.usd / total) * 100 : 0;
              return (
                <li key={r.chain}>
                  <div className="flex items-center justify-between gap-3 text-[13.5px]">
                    <span className="inline-flex items-center gap-2">
                      <ChainIcon chain={r.chain} className="size-[18px]" />
                      {CHAIN_META[r.chain].name}
                    </span>
                    <span className="tabular text-fg-2">{formatAmount(r.chain, r.confirmed)}</span>
                  </div>
                  <div className="bg-raised mt-1.5 h-1.5 overflow-hidden rounded-full" aria-hidden>
                    <div className="bg-accent h-full rounded-full" style={{ width: `${share}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
          {pending.length ? (
            <p className="text-info mt-4 text-[12.5px]">
              Arriving: {pending.map((p) => formatAmount(p.chain, p.pending)).join(", ")}, not counted until confirmed.
            </p>
          ) : null}
        </>
      ) : (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-32" />
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      )}
      <p className="border-line text-fg-2 mt-5 border-t pt-4 text-[13px] leading-relaxed">
        Anyone can add coins to its addresses, sealed or not, even while a market, a schedule, a loan or a switch holds it. Only
        whoever holds the vault can ever take them out.
      </p>
    </RailCard>
  );
}

function holderName(account: string) {
  if (account === MARKET_CONTRACT) return { name: "The market", detail: account, escrow: true };
  if (account === SCHEDULE_CONTRACT) return { name: "The schedule", detail: account, escrow: true };
  if (account === LEND_CONTRACT) return { name: "The lending contract", detail: account, escrow: true };
  if (account === SWITCH_CONTRACT) return { name: "The switch", detail: account, escrow: true };
  return { name: shortAccount(account), detail: null, escrow: false };
}

/** "the market" mid-sentence, or the account. */
function heldBy(account: string) {
  const h = holderName(account);
  return h.escrow ? h.name.charAt(0).toLowerCase() + h.name.slice(1) : h.name;
}

/** History: every holder in order, from whoever created it to whoever holds it now. */
export function CustodyRail({ vault }: { vault: VaultView }) {
  const people = new Set(vault.custody.map((c) => c.account_id).filter((a) => !holderName(a).escrow)).size;
  return (
    <RailCard eyebrow="Chain of custody" title="Who has held it">
      <ol className="before:bg-line relative flex flex-col gap-4 before:absolute before:top-2 before:bottom-2 before:left-[5px] before:w-px">
        {vault.custody.map((c, i) => {
          const h = holderName(c.account_id);
          const now = i === vault.custody.length - 1;
          return (
            <li key={`${c.account_id}-${c.since_ns}`} className="relative pl-6">
              <span
                aria-hidden
                className={cn(
                  "absolute top-[5px] left-0 size-[11px] rounded-full border-2",
                  now ? "border-accent bg-accent" : h.escrow ? "border-fg-3 bg-surface" : "border-fg-2 bg-surface",
                )}
              />
              <p className={cn("text-[13.5px] leading-snug", now ? "text-fg font-medium" : "text-fg-2")}>
                <span className={h.escrow ? "" : "font-mono"} title={c.account_id}>
                  {h.name}
                </span>
              </p>
              <p className="text-fg-3 mt-0.5 text-[12px]">
                {i === 0 ? "Created it" : now ? "Holds it now" : h.escrow ? "Held it in escrow" : "Held it"} ·{" "}
                {formatDate(nsToMs(c.since_ns))}
              </p>
            </li>
          );
        })}
      </ol>
      <div className="border-line bg-line mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-[12px] border text-center">
        <div className="bg-bg px-3 py-2.5">
          <p className="tabular text-[18px] font-semibold">{people}</p>
          <p className="text-fg-3 text-[11.5px]">{people === 1 ? "holder" : "holders"}</p>
        </div>
        <div className="bg-bg px-3 py-2.5">
          <p className="tabular text-[18px] font-semibold">{vault.signatures_requested}</p>
          <p className="text-fg-3 text-[11.5px]">signatures ever</p>
        </div>
      </div>
    </RailCard>
  );
}

function Rule({
  icon,
  title,
  live,
  children,
}: {
  icon: ReactNode;
  title: string;
  live?: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="bg-raised text-fg-2 mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full [&_svg]:size-3.5">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[13.5px] font-medium">{title}</p>
        <p className="text-fg-3 mt-0.5 text-[12.5px] leading-relaxed">{children}</p>
        {live ? (
          <p className="text-ok mt-1 inline-flex items-center gap-1 text-[12px]">
            <Check aria-hidden className="size-3" strokeWidth={3} />
            {live}
          </p>
        ) : null}
      </div>
    </li>
  );
}

/** Attack lab: the four rules every attempt runs into, with what the chain says right now. */
export function RulesRail({ vault, facts }: { vault: VaultView; facts: ContractFacts | undefined }) {
  const sealed = vault.state.kind === "sealed";
  return (
    <RailCard eyebrow="Why every attempt fails" title="Four rules in the contract">
      <ol className="flex flex-col gap-4">
        <Rule
          icon={<KeyRound />}
          title="Only the holder can break the seal"
          live={`Held now by ${heldBy(vault.owner_id)}`}
        >
          Not a former holder. The market, the schedule, the lending contract and the switch hold vaults with no way to open them.
        </Rule>
        <Rule
          icon={<Signature />}
          title="A sealed vault can't sign"
          live={sealed ? `${vault.signatures_requested} signatures ever requested` : undefined}
        >
          No withdrawal can be signed until the seal is broken, and breaking it is public and final.
        </Rule>
        <Rule icon={<Repeat2 />} title="It changes hands one way">
          A transfer while sealed, through one gate. An opened vault can&apos;t be transferred again.
        </Rule>
        <Rule
          icon={<Lock />}
          title="Nobody can change the rules"
          live={IS_SIMULATED ? "Locked (simulated)" : facts?.locked ? "The contract has no keys" : undefined}
        >
          No admin, no upgrade method, and the contract&apos;s keys are deleted.
        </Rule>
      </ol>
    </RailCard>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="tabular border-line text-fg-2 mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full border text-[12px]">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium">{title}</p>
        <div className="text-fg-3 mt-1 text-[12.5px] leading-relaxed">{children}</div>
      </div>
    </li>
  );
}

function Command({ value, label }: { value: string; label: string }) {
  return (
    <div className="border-line mt-2 flex items-start gap-2 rounded-[10px] border bg-[#0b0b0f] py-2 pr-1.5 pl-3">
      <pre className="min-w-0 flex-1 overflow-x-auto font-mono text-[11.5px] leading-relaxed text-[#d4d4d8]">
        <code>{value}</code>
      </pre>
      <CopyButton value={value} label={label} size="sm" />
    </div>
  );
}

/** Technical: how to check this page without trusting it. */
export function VerifyRail({ vault }: { vault: VaultView }) {
  return (
    <RailCard eyebrow="Don't trust this page" title="Check it yourself">
      <ol className="flex flex-col gap-5">
        <Step n={1} title="Derive its addresses in your browser">
          From NEAR&apos;s MPC root keys and this vault&apos;s paths, with nothing from our server.{" "}
          <Link
            href={IS_SIMULATED ? "/derive" : `/derive?vault=${vault.token_id}`}
            className="text-accent inline-flex items-center gap-0.5 hover:underline"
          >
            Open the deriver
            <ArrowUpRight aria-hidden className="size-3" />
          </Link>
        </Step>
        <Step n={2} title="Rebuild the contract and compare">
          The same bytes as the code on chain, from the commit it names.
          <Command
            label="Copy the rebuild commands"
            value={`git checkout ${BUILD_COMMIT}\ncargo near build reproducible-wasm \\\n  --manifest-path contracts/bearer/Cargo.toml`}
          />
        </Step>
        <Step n={3} title="Check every public claim against the chains">
          The NEAR, Bitcoin and Solana transactions behind this site, read from public endpoints.
          <Command label="Copy the verify command" value="pnpm verify" />
        </Step>
        <Step n={4} title="Read it on an explorer">
          <a
            href={explorer.nearAccount(BEARER_CONTRACT)}
            target="_blank"
            rel="noreferrer"
            className="text-accent inline-flex items-center gap-1 hover:underline"
          >
            <Fingerprint aria-hidden className="size-3.5" />
            {BEARER_CONTRACT} on NearBlocks
          </a>
          <Link href="/proof" className="text-accent mt-1 flex items-center gap-1 hover:underline">
            <ShieldCheck aria-hidden className="size-3.5" />
            The live proof page
          </Link>
        </Step>
      </ol>
    </RailCard>
  );
}
