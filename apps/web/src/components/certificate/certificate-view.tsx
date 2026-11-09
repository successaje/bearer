"use client";

import type { ChainTag, VaultView } from "@bearer/sdk";
import { CHAIN_TAGS } from "@bearer/sdk";
import { ArrowLeft, Printer } from "lucide-react";
import { Instrument_Serif } from "next/font/google";
import Link from "next/link";
import { useParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import type { CSSProperties } from "react";
import { ChainIcon } from "@/components/brand/chain-icon";
import { Seal } from "@/components/brand/seal";
import { EmptyState, ErrorState } from "@/components/layout/page-states";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { BEARER_CONTRACT, IS_SIMULATED, SIGNER_CONTRACT } from "@/lib/config";
import { CHAIN_META, formatAmount, formatDate, formatUsd, nsToMs, vaultNumber } from "@/lib/vault/format";
import { useNow, useObservation, useVault } from "@/lib/vault/hooks";
import { isSealed, observedUsd } from "@/lib/vault/report";
import { cn } from "@/lib/utils";
import { CertificateFrame, Watermark } from "./guilloche";

const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], display: "swap" });

/** Paper and inks are fixed in both themes: it's a printed object. */
const PAPER: CSSProperties & Record<`--${string}`, string> = {
  "--paper": "#f6efdc",
  "--ink": "#221c10",
  "--ink-2": "rgb(34 28 16 / 0.68)",
  "--engrave": "#9a7514",
  background:
    "radial-gradient(120% 90% at 50% 40%, #fbf6e8 0%, #f6efdc 55%, #ecdfbf 100%)",
  color: "var(--ink)",
};

function address(vault: VaultView, chain: ChainTag) {
  return chain === "btc" ? vault.btc_address : chain === "evm" ? vault.evm_address : vault.sol_address;
}

/** Groups an address in fours, like the vault page, so it can be read aloud and checked. */
function grouped(a: string) {
  return a.replace(/(.{4})/g, "$1 ").trim();
}

export function CertificateView() {
  const { id } = useParams<{ id: string }>();
  const query = useVault(id);
  const vault = query.data;
  const obs = useObservation(vault);
  const now = useNow(30_000);

  if (query.isPending || !now) return <Frame><Skeleton className="aspect-[297/210] w-full rounded-[6px]" /></Frame>;
  if (query.isError) return <Frame><ErrorState error={query.error} onRetry={() => void query.refetch()} /></Frame>;
  if (!vault) {
    return (
      <Frame>
        <EmptyState seal="opened" title={`There's no vault ${vaultNumber(id)}`}>
          Check the number and try again.
        </EmptyState>
      </Frame>
    );
  }

  const sealed = isSealed(vault);
  const url = `${window.location.origin}/v/${vault.token_id}`;
  const printedAt = new Date(now);
  const stamp = `${printedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}, ${printedAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZoneName: "short" })}`;
  const value = obs.data ? observedUsd(obs.data) : null;
  const holders = vault.custody.slice(-4);
  const earlier = vault.custody.length - holders.length;

  return (
    <Frame
      toolbar={
        <>
          <Link href={`/v/${vault.token_id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
            <ArrowLeft className="size-4" />
            Back to the vault
          </Link>
          <Button variant="primary" size="sm" onClick={() => window.print()}>
            <Printer className="size-4" />
            Print or save as PDF
          </Button>
        </>
      }
      note={
        <>
          A snapshot of {vaultNumber(vault.token_id)} as of {stamp}. The paper points to the vault; it doesn&apos;t hold
          it. Whoever holds the NEAR token controls the vault, so always scan to check the live seal.
        </>
      }
    >
      <article
        aria-label={`Bearer certificate for vault ${vaultNumber(vault.token_id)}`}
        className="certificate @container relative aspect-[297/210] w-full overflow-hidden rounded-[4px] shadow-[0_1px_0_rgb(255_255_255/0.6)_inset,0_30px_80px_-30px_rgb(0_0_0/0.55)] print:rounded-none print:shadow-none"
        style={PAPER}
      >
        <div className="absolute inset-0 text-[var(--engrave)]">
          <CertificateFrame />
        </div>
        <div className="absolute inset-0 text-[var(--engrave)] opacity-[0.11]">
          <Watermark />
        </div>

        <div className="absolute inset-[9.4%_7.6%] flex flex-col">
          {/* Masthead */}
          <header className="flex items-start justify-between gap-[2cqw]">
            <div className="flex items-center gap-[1.4cqw]">
              <Seal tone="dark" className="size-[5.2cqw]" />
              <div>
                <p className="text-[1.9cqw] font-semibold tracking-[0.42em]">BEARER</p>
                <p className="mt-[0.3cqw] text-[1.05cqw] uppercase tracking-[0.28em] text-[var(--ink-2)]">
                  Certificate of a sealed vault
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[0.95cqw] uppercase tracking-[0.3em] text-[var(--ink-2)]">Serial</p>
              <p className={cn(serif.className, "text-[4.4cqw] leading-[0.95] tabular-nums")}>
                {vaultNumber(vault.token_id)}
              </p>
              <p className="mt-[0.3cqw] text-[1.05cqw] text-[var(--ink-2)]">
                Issued {formatDate(nsToMs(vault.created_at_ns))} on NEAR {IS_SIMULATED ? "(simulated)" : "testnet"}
              </p>
            </div>
          </header>

          <div className="mt-[2.4cqw] grid flex-1 grid-cols-[1.35fr_1fr] gap-[3cqw]">
            {/* Body */}
            <div className="flex min-w-0 flex-col">
              <h1 className={cn(serif.className, "text-[5.2cqw] leading-[0.98] tracking-[-0.01em]")}>
                {vault.name ?? `Vault ${vault.token_id}`}
              </h1>
              <p className={cn(serif.className, "mt-[1.4cqw] max-w-[44cqw] text-[1.7cqw] italic leading-[1.35] text-[var(--ink-2)]")}>
                This certifies that vault {vaultNumber(vault.token_id)} is a token on NEAR controlling the three native
                addresses below. Whoever holds the token can break its seal and withdraw what is inside. Nobody before
                them can.
              </p>

              {/* Coupons, as on a bearer bond: what each chain held when this was printed. */}
              <div className="mt-[2.2cqw]">
                <p className="text-[0.95cqw] uppercase tracking-[0.3em] text-[var(--ink-2)]">Contents when printed · observed</p>
                <ul className="mt-[0.7cqw] grid grid-cols-3 gap-[1cqw]">
                  {CHAIN_TAGS.map((chain) => {
                    const o = obs.data?.find((x) => x.chain === chain);
                    return (
                      <li
                        key={chain}
                        className="relative rounded-[0.5cqw] border border-dashed border-[color:rgb(154_117_20/0.7)] px-[1.1cqw] py-[0.8cqw]"
                      >
                        <span aria-hidden className="absolute -left-[0.55cqw] top-1/2 size-[1.1cqw] -translate-y-1/2 rounded-full bg-[var(--paper)] shadow-[inset_-1px_0_0_rgb(154_117_20/0.7)]" />
                        <span aria-hidden className="absolute -right-[0.55cqw] top-1/2 size-[1.1cqw] -translate-y-1/2 rounded-full bg-[var(--paper)] shadow-[inset_1px_0_0_rgb(154_117_20/0.7)]" />
                        <span className="block text-[0.9cqw] uppercase tracking-[0.2em] text-[var(--ink-2)]">{CHAIN_META[chain].name}</span>
                        <span className={cn(serif.className, "mt-[0.2cqw] block truncate text-[2.1cqw] leading-tight tabular-nums")}>
                          {o ? formatAmount(chain, o.confirmed) : "—"}{" "}
                          <span className="text-[1.15cqw]">{CHAIN_META[chain].unit}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <dl className="mt-auto flex flex-col gap-[0.9cqw] border-t border-[color:rgb(154_117_20/0.45)] pt-[1.2cqw]">
                {CHAIN_TAGS.map((chain) => {
                  const a = address(vault, chain);
                  return (
                    <div key={chain} className="grid grid-cols-[2.4cqw_11cqw_1fr] items-center gap-[1cqw]">
                      <ChainIcon chain={chain} className="size-[2.2cqw]" />
                      <dt className="text-[1.1cqw] leading-tight">
                        <span className="font-semibold">{CHAIN_META[chain].name}</span>
                        <span className="block text-[0.9cqw] text-[var(--ink-2)]">{CHAIN_META[chain].network}</span>
                      </dt>
                      <dd className="m-0 min-w-0 break-all font-mono text-[1.05cqw] leading-snug">
                        {a ? grouped(a) : "Waiting for the signer's keys"}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </div>

            {/* Seal and verification */}
            <div className="flex flex-col items-center text-center">
              <div className="relative">
                <svg viewBox="0 0 200 200" aria-hidden className="size-[19cqw] text-[var(--engrave)]">
                  <defs>
                    <path id="cert-ring" d="M100,100 m-82,0 a82,82 0 1,1 164,0 a82,82 0 1,1 -164,0" />
                  </defs>
                  <circle cx="100" cy="100" r="94" fill="none" stroke="currentColor" strokeWidth="0.6" />
                  <circle cx="100" cy="100" r="70" fill="none" stroke="currentColor" strokeWidth="0.4" />
                  {/* textLength spreads the text exactly once around the ring (2π × 82). */}
                  <text fill="currentColor" fontSize="10.5" fontWeight="600">
                    <textPath href="#cert-ring" textLength={512} lengthAdjust="spacing">
                      SEALED UNTIL OPENED · BEARER · {vaultNumber(vault.token_id).toUpperCase()} ·
                    </textPath>
                  </text>
                </svg>
                <Seal
                  variant={sealed ? "monogram" : "opened"}
                  className="absolute left-1/2 top-1/2 size-[11.5cqw] -translate-x-1/2 -translate-y-1/2"
                />
              </div>
              <p className={cn(serif.className, "mt-[0.6cqw] text-[2.6cqw] leading-none")}>
                {sealed ? "Unopened" : "Opened"}
              </p>
              <p className="mt-[0.6cqw] text-[1.05cqw] text-[var(--ink-2)]">
                {sealed
                  ? "No signature has ever been requested for this vault."
                  : `Opened ${vault.state.kind === "opened" ? formatDate(nsToMs(vault.state.at_ns)) : ""}. It can't change hands.`}
              </p>
              <p className="mt-[0.3cqw] text-[0.95cqw] text-[var(--ink-2)]">
                State as of {stamp}
                {value !== null ? ` · observed value ${formatUsd(value)} est.` : ""}
              </p>

              <div className="mt-auto flex items-center gap-[1.4cqw] text-left">
                <div className="rounded-[0.6cqw] bg-white p-[0.7cqw] shadow-[0_0_0_1px_rgb(154_117_20/0.35)]">
                  <QRCodeSVG value={url} size={256} level="M" marginSize={0} className="block size-[9cqw]" role="img" aria-label={`QR code for ${url}`} />
                </div>
                <div className="max-w-[15cqw]">
                  <p className="text-[1.15cqw] font-semibold leading-tight">Scan to check the live seal</p>
                  <p className="mt-[0.4cqw] break-all font-mono text-[0.9cqw] leading-snug text-[var(--ink-2)]">{url}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Endorsements and small print */}
          <footer className="mt-[2cqw] grid grid-cols-[1.35fr_1fr] items-end gap-[3cqw]">
            <div>
              <p className="text-[0.95cqw] uppercase tracking-[0.3em] text-[var(--ink-2)]">Endorsements</p>
              <ol className="mt-[0.6cqw] flex flex-col gap-[0.35cqw]">
                {earlier > 0 ? (
                  <li className="text-[1cqw] text-[var(--ink-2)]">
                    + {earlier} earlier holder{earlier > 1 ? "s" : ""}
                  </li>
                ) : null}
                {holders.map((c, i) => (
                  <li
                    key={`${c.account_id}-${c.since_ns}`}
                    className="flex items-baseline justify-between gap-[1cqw] border-b border-dotted border-[color:rgb(34_28_16/0.35)] pb-[0.2cqw]"
                  >
                    <span className={cn(serif.className, "text-[1.55cqw] italic")}>
                      {i === holders.length - 1 ? "Held by" : "Pay to"}{" "}
                      <span className="font-mono text-[1.1cqw] not-italic">{c.account_id}</span>
                    </span>
                    <span className="text-[0.95cqw] text-[var(--ink-2)]">{formatDate(nsToMs(c.since_ns))}</span>
                  </li>
                ))}
              </ol>
            </div>
            <p className="text-[0.82cqw] leading-[1.45] text-[var(--ink-2)]">
              This paper does not hold the vault: the NEAR token does. Contract {BEARER_CONTRACT} · MPC signer{" "}
              {SIGNER_CONTRACT}. Testnet prototype, not audited. Not a security and not financial advice.
            </p>
          </footer>

          {/* Microprint, as on banknotes */}
          <p aria-hidden className="mt-[0.8cqw] overflow-hidden whitespace-nowrap text-[0.55cqw] tracking-[0.18em] text-[var(--engrave)]">
            {"BEARER · SEALED UNTIL OPENED · ".repeat(24)}
          </p>
        </div>
      </article>
    </Frame>
  );
}

function Frame({ toolbar, note, children }: { toolbar?: React.ReactNode; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="certificate-page mx-auto max-w-[1200px] px-5 pb-8 pt-8 md:px-8 md:pt-10 print:m-0 print:max-w-none print:p-0">
      {toolbar ? <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">{toolbar}</div> : null}
      {children}
      <p className="mt-3 text-center text-[12.5px] text-fg-3 sm:hidden print:hidden">Print it, or turn your phone sideways to read it.</p>
      {note ? <p className="mx-auto mt-5 max-w-[720px] text-center text-[13px] leading-relaxed text-fg-3 print:hidden">{note}</p> : null}
    </div>
  );
}
