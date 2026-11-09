import { ArrowRight, ArrowUpRight, CheckCircle2, Clock, PenLine } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ChainIcon } from "@/components/brand/chain-icon";
import { RevealObserver } from "@/components/landing/motion";
import { GasChart, LatencyChart } from "@/components/proof/charts";
import { LiveChecks } from "@/components/proof/live-checks";
import { ThreatTable } from "@/components/proof/threat-table";
import { CopyButton } from "@/components/ui/copy-button";
import { Eyebrow } from "@/components/ui/primitives";
import { HEADLINE_RUN, LANDED, LATENCY, MARKET_SALE, MEASURED_ON, PROOF_SIGNER, RUN_IT, SAME_NONCE, SPIKE_CONTRACT, THREATS, WALLET_WITHDRAWAL } from "@/lib/proof/data";
import { vaultNumber } from "@/lib/vault/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Proof",
  description: "Live checks against NEAR testnet, measured signing times and gas, and every threat with the tests that prove it.",
};

export default function ProofPage() {
  const proven = THREATS.filter((t) => t.status === "proven").length;
  // The handover series is timed too, but it asks for no signature.
  const signatures = LATENCY.filter((s) => s.id !== "handover").reduce((n, s) => n + s.runs.length, 0);
  const landed = LANDED.filter((l) => l.status === "confirmed").length;

  return (
    <div className="mx-auto max-w-[1200px] px-5 pt-14 md:px-8 md:pt-20">
      <RevealObserver />
      <div className="max-w-[800px]">
        <Eyebrow>Proof</Eyebrow>
        <h1 className="text-balance mt-3 text-[clamp(38px,5.4vw,64px)] font-semibold leading-[1.0] tracking-[-0.045em]">
          Don&apos;t trust us. <span className="text-fg-3">Check.</span>
        </h1>
        <p className="text-pretty mt-5 text-[17px] leading-relaxed text-fg-2">
          Every claim on this site, with the evidence behind it: live answers from NEAR testnet that your browser fetches
          itself, numbers we measured against NEAR&apos;s real MPC signer (each with how many runs), and every attack we
          know of with the test that stops it.
        </p>
      </div>

      <dl className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-line bg-line lg:grid-cols-4 [&>div]:bg-surface">
        <Stat label="Chains signed by NEAR's MPC" value="3 of 3" note="Bitcoin, Base and Solana on testnet" />
        <Stat label="Signatures measured" value={String(signatures)} note={`against ${PROOF_SIGNER}, ${MEASURED_ON}`} />
        <Stat label="Landed on another chain" value={String(landed)} note="confirmed on Base Sepolia, Bitcoin testnet4 and Solana devnet" />
        <Stat label="Threats proven by tests" value={`${proven} of ${THREATS.length}`} note="the rest are partly done, by design, or not yet" />
      </dl>

      <Section id="live" n="01" title="Live from NEAR testnet" sub="Run in your browser against a public RPC. Nothing here comes from a Bearer server.">
        <LiveChecks />
      </Section>

      <Section
        id="signing"
        n="02"
        title="Timed on testnet"
        sub={`Every bar is one real transaction on testnet, timed from submitting it. The handover ran on bearer.testnet and needs no signature; the withdrawals were signed by NEAR's MPC network on the spike contract (${SPIKE_CONTRACT}). Click a time to see its transaction.`}
      >
        <LatencyChart />
      </Section>

      <Section id="landed" n="03" title="Where the withdrawals landed" sub={`A signature only matters once the other chain accepts it. The first run used the locked contract and real wallets; the three cards after it used the spike contract (${SPIKE_CONTRACT}), whose vault numbers are its own.`}>
        <HeadlineRun />
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {LANDED.map((l) => (
            <div key={l.chain} className="flex flex-col rounded-panel border border-line bg-surface p-5">
              <div className="flex items-center gap-2.5">
                <ChainIcon chain={l.chain} className="size-7" />
                <p className="text-[15px] font-semibold">{l.title}</p>
              </div>
              <p
                className={cn(
                  "mt-4 inline-flex items-center gap-1.5 text-[13.5px] font-semibold",
                  l.status === "confirmed" ? "text-ok" : l.status === "signed" ? "text-accent" : "text-fg-2",
                )}
              >
                {l.status === "confirmed" ? <CheckCircle2 className="size-4" /> : l.status === "signed" ? <PenLine className="size-4" /> : <Clock className="size-4" />}
                {l.status === "confirmed" ? "Confirmed on-chain" : l.status === "signed" ? "Signed, waiting for funds" : "Funded, waiting to broadcast"}
              </p>
              <p className="mt-2 text-[13.5px] leading-relaxed text-fg-2">{l.detail}</p>
              {l.href ? (
                <a href={l.href} target="_blank" rel="noreferrer" className="mt-auto inline-flex items-center gap-1 pt-4 font-mono text-[12.5px] text-accent hover:underline">
                  {l.linkLabel}
                  <ArrowUpRight className="size-3.5" />
                </a>
              ) : null}
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-col gap-3 rounded-panel border border-line bg-surface p-5 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="text-[15px] font-semibold">The market&apos;s first sale</p>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-fg-2">
              On the locked contract, <span className="font-mono">bearer.testnet</span>: vault {vaultNumber(MARKET_SALE.tokenId)} for{" "}
              {MARKET_SALE.price}. {MARKET_SALE.detail}. {MARKET_SALE.gas}.
            </p>
          </div>
          <div className="flex shrink-0 gap-4 font-mono text-[12.5px]">
            <a href={MARKET_SALE.listTx} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
              listing <ArrowUpRight className="size-3.5" />
            </a>
            <a href={MARKET_SALE.buyTx} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
              purchase <ArrowUpRight className="size-3.5" />
            </a>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-3 rounded-panel border border-line bg-surface p-5 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="text-[15px] font-semibold">Opened and withdrawn through a wallet</p>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-fg-2">
              On the locked contract, <span className="font-mono">bearer.testnet</span>, vault {vaultNumber(WALLET_WITHDRAWAL.tokenId)}:{" "}
              {WALLET_WITHDRAWAL.detail}.
            </p>
          </div>
          <div className="flex shrink-0 gap-4 font-mono text-[12.5px]">
            <a href={WALLET_WITHDRAWAL.nearTx} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
              NEAR <ArrowUpRight className="size-3.5" />
            </a>
            <a href={WALLET_WITHDRAWAL.baseTx} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
              Base <ArrowUpRight className="size-3.5" />
            </a>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-3 rounded-panel border border-line bg-surface p-5 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="text-[15px] font-semibold">Two signatures, one nonce (T10)</p>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-fg-2">
              On the locked contract, <span className="font-mono">bearer.testnet</span>, vault {vaultNumber(SAME_NONCE.tokenId)}:{" "}
              {SAME_NONCE.detail}. Refused: <span className="break-all font-mono text-[12.5px]">{SAME_NONCE.refusedHash}</span>
            </p>
          </div>
          <div className="flex shrink-0 gap-4 font-mono text-[12.5px]">
            <a href={SAME_NONCE.confirmed} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
              confirmed <ArrowUpRight className="size-3.5" />
            </a>
            {SAME_NONCE.signedTxs.map((href, i) => (
              <a key={href} href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                signed {i + 1} <ArrowUpRight className="size-3.5" />
              </a>
            ))}
          </div>
        </div>
      </Section>

      <Section id="gas" n="04" title="Gas, measured" sub="Bitcoin is the heaviest withdrawal: one signature per input, all checked in a single callback.">
        <GasChart />
      </Section>

      <Section id="threats" n="05" title="Every attack we know of" sub="docs/THREAT_MODEL.md. A row is proven only when its test passes.">
        <ThreatTable />
      </Section>

      <Section id="run" n="06" title="Run it yourself" sub="The same checks, on your machine. You need Rust, Node and pnpm.">
        <ul className="flex flex-col gap-3">
          {RUN_IT.map((r) => (
            <li key={r.cmd} className="rounded-panel border border-line bg-surface p-4">
              <p className="text-[13.5px] text-fg-2">{r.label}</p>
              <div className="mt-2.5 flex items-center gap-2 rounded-[10px] border border-line bg-bg px-3 py-2">
                <code className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{r.cmd}</code>
                <CopyButton value={r.cmd} label="Copy command" size="sm" />
              </div>
            </li>
          ))}
        </ul>
        <Link href="/how#trust" className="mt-8 inline-flex items-center gap-2 text-[15px] font-medium text-accent hover:underline">
          What you&apos;re still trusting
          <ArrowRight className="size-4" />
        </Link>
      </Section>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="min-w-0 px-4 py-4 sm:px-6 sm:py-5">
      <dt className="text-[12.5px] text-fg-3">{label}</dt>
      <dd className="m-0">
        <span className="tabular mt-2 block text-[26px] font-semibold tracking-[-0.03em] sm:text-[30px]">{value}</span>
        <span className="mt-1 block text-[12px] leading-snug text-fg-3">{note}</span>
      </dd>
    </div>
  );
}

function Section({ id, n, title, sub, children }: { id: string; n: string; title: string; sub: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mt-20 scroll-mt-24 md:mt-24">
      <div data-reveal className="mb-6 max-w-[760px]">
        <p className="font-mono text-[11.5px] font-medium uppercase tracking-[0.16em] text-accent">{n}</p>
        <h2 id={`${id}-title`} className="text-balance mt-2 text-[clamp(26px,3vw,36px)] font-semibold leading-[1.1] tracking-[-0.03em]">
          {title}
        </h2>
        <p className="mt-2 text-[15px] leading-relaxed text-fg-2">{sub}</p>
      </div>
      {children}
    </section>
  );
}

/** The headline, with real coins: a sealed vault holding Bitcoin changed hands on NEAR, then its new holder withdrew. */
function HeadlineRun() {
  const r = HEADLINE_RUN;
  const steps: { chain: "near" | "btc" | "sol"; text: ReactNode; href: string; label: string }[] = [
    {
      chain: "near",
      text: <>finishr.testnet hands sealed vault {vaultNumber(r.vault)}, holding {r.heldSats} sats of testnet Bitcoin, to takaba.testnet. One NEAR transaction.</>,
      href: r.handoverTx,
      label: "handover",
    },
    {
      chain: "btc",
      text: <>Nothing happens on Bitcoin. The vault&apos;s address shows two transactions ever: the deposit, and the new holder&apos;s withdrawal, which spends that same coin.</>,
      href: r.btcAddress,
      label: "address",
    },
    {
      chain: "near",
      text: <>takaba.testnet breaks the seal and asks for a Bitcoin withdrawal, in one transaction, then for a Solana one.</>,
      href: r.openTx,
      label: "open",
    },
    {
      chain: "btc",
      text: <>300,000 sats reach sealed vault {vaultNumber(r.into)}, with the change back to {vaultNumber(r.vault)}. {r.btcBlock ? `Confirmed in testnet4 block ${r.btcBlock.toLocaleString("en-US")}.` : "Broadcast; waiting for a block."}</>,
      href: r.btc,
      label: "bitcoin",
    },
    {
      chain: "sol",
      text: <>0.5 SOL reaches vault {vaultNumber(r.into)}. Finalized in devnet slot {r.solSlot}.</>,
      href: r.sol,
      label: "solana",
    },
  ];
  return (
    <div className="rounded-panel border border-gold/35 bg-gold/[0.05] p-5 sm:p-6">
      <p className="font-mono text-[11.5px] font-medium uppercase tracking-[0.16em] text-accent">Locked contract · real wallets · real coins</p>
      <p className="mt-2 text-[20px] font-semibold leading-snug tracking-[-0.02em]">Bitcoin that changed hands without a Bitcoin transaction</p>
      <ol className="mt-4 flex flex-col gap-3">
        {steps.map((s, i) => (
          <li key={i} className="grid grid-cols-[28px_minmax(0,1fr)] items-start gap-x-3 gap-y-1 sm:grid-cols-[28px_minmax(0,1fr)_auto]">
            {s.chain === "near" ? (
              <span className="inline-flex size-7 items-center justify-center rounded-full bg-raised font-mono text-[11px] font-semibold text-fg-2">N</span>
            ) : (
              <ChainIcon chain={s.chain} className="size-7" />
            )}
            <p className="pt-1 text-[14px] leading-relaxed text-fg-2">{s.text}</p>
            <a href={s.href} target="_blank" rel="noreferrer" className="col-start-2 inline-flex items-center gap-1 font-mono text-[12.5px] text-accent hover:underline sm:col-start-auto sm:pt-1">
              {s.label} <ArrowUpRight className="size-3.5" />
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}
