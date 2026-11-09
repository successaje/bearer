"use client";

import { AlertTriangle, ArrowLeft, ArrowUpRight, Check, History, Loader2, Repeat, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Eyebrow, SimulatedTag } from "@/components/ui/primitives";
import { IS_SIMULATED, MARKET_CODE_HASH, MARKET_CONTRACT, explorer } from "@/lib/config";
import { MARKET_SALE } from "@/lib/proof/data";
import { vaultNumber } from "@/lib/vault/format";
import { useMarketFacts } from "@/lib/vault/hooks";

const STEPS: [string, ReactNode][] = [
  [
    "List",
    "The seller pays a 0.01 NEAR listing deposit, then sends the vault to the market with a price. Only sealed vaults get through; the market holds the vault until it sells or is delisted.",
  ],
  [
    "Buy",
    "The buyer pays exactly the price. The vault moves to them first, and Bearer checks again in that same step that it's still sealed. Only then is the seller paid the price and their deposit.",
  ],
  [
    "If something fails",
    "A vault that can't move refunds the buyer and the listing stands. A payout that bounces is kept for the seller to claim. Nothing assumes an earlier step will roll back.",
  ],
  ["Delist", "Only the seller can take a vault back, with the deposit, and not while a sale is settling."],
];

/** The market's explanations, kept off the listings page: how a sale works, why buy, the risks, the evidence. */
export function MarketHow() {
  return (
    <div className="mx-auto max-w-[1200px] px-5 pb-20 pt-14 md:px-8 md:pt-20">
      <Link href="/market" className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-fg-2 hover:text-fg">
        <ArrowLeft className="size-4" />
        Back to the market
      </Link>
      <div className="mt-8 max-w-[760px]">
        <div className="flex items-center gap-2.5">
          <Eyebrow>Market</Eyebrow>
          {IS_SIMULATED ? <SimulatedTag /> : null}
        </div>
        <h1 className="text-balance mt-3 text-[clamp(34px,4.6vw,52px)] font-semibold leading-[1.04] tracking-[-0.04em]">
          How the market works
        </h1>
        <p className="text-pretty mt-5 text-[17px] leading-relaxed text-fg-2">
          The Bearer contract is locked and has no approvals, so a market can&apos;t be allowed to move someone&apos;s vault
          later. Instead the seller hands the vault to the market contract, which holds it in escrow and settles each
          sale itself.
        </p>
      </div>

      <ol className="mt-10 grid gap-4 md:grid-cols-2">
        {STEPS.map(([title, body], i) => (
          <li key={title} className="rounded-panel border border-line bg-surface p-5">
            <p className="font-mono text-[11.5px] text-fg-3">0{i + 1}</p>
            <p className="mt-2 text-[15.5px] font-semibold">{title}</p>
            <p className="mt-1.5 text-[14px] leading-relaxed text-fg-2">{body}</p>
          </li>
        ))}
      </ol>

      <section aria-labelledby="why" className="mt-20">
        <h2 id="why" className="text-[clamp(24px,2.8vw,32px)] font-semibold tracking-[-0.03em]">
          Why buy the vault, not just the coins
        </h2>
        <p className="mt-3 max-w-[680px] text-[15.5px] leading-relaxed text-fg-2">
          Anyone can already send Bitcoin directly. A vault is worth buying when the package matters:
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <Reason icon={<ShieldCheck />} title="A history you can check">
            No withdrawal has ever been signed for a sealed vault, on any chain, and its custody log names every holder.
            Coins sent directly carry neither.
          </Reason>
          <Reason icon={<Repeat />} title="Made to change hands">
            A prize, a gift or a collectible can be handed on again, still sealed, without anyone moving the coins.
          </Reason>
          <Reason icon={<History />} title="No trust in the seller">
            The contract moves the vault before the seller is paid, at exactly the listed price, and refunds you if it
            can&apos;t.
          </Reason>
        </div>
      </section>

      <section aria-labelledby="before" className="mt-16 rounded-panel border border-line bg-surface p-6 md:p-8">
        <h2 id="before" className="text-[20px] font-semibold tracking-[-0.02em]">
          Before you buy
        </h2>
        <ul className="mt-4 grid gap-x-10 gap-y-3 text-[14.5px] leading-relaxed text-fg-2 md:grid-cols-2">
          <li>Balances are observations from public data, with their source and time. Pending deposits can still fail.</li>
          <li>A dollar figure is an estimate, not a value anyone guarantees.</li>
          <li>Sealed means no withdrawal was ever signed. It doesn&apos;t make the vault risk-free.</li>
          <li>This is a testnet prototype. Neither the Bearer contract nor the market has been audited.</li>
        </ul>
      </section>

      {MARKET_CONTRACT && !IS_SIMULATED ? (
        <section aria-labelledby="evidence" className="mt-16 grid gap-4 md:grid-cols-2">
          <h2 id="evidence" className="sr-only">
            Evidence
          </h2>
          <ContractCard />
          <div className="rounded-panel border border-line bg-surface p-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-3">First sale on testnet</p>
            <p className="mt-2.5 text-[14px] leading-relaxed text-fg-2">
              <Link href={`/v/${MARKET_SALE.tokenId}`} className="font-medium text-fg hover:underline">
                Vault {vaultNumber(MARKET_SALE.tokenId)}
              </Link>{" "}
              for {MARKET_SALE.price}. {MARKET_SALE.detail}.
            </p>
            <div className="mt-4 flex gap-4 text-[13px] font-medium">
              <External href={MARKET_SALE.listTx}>Listing</External>
              <External href={MARKET_SALE.buyTx}>Purchase</External>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** The market contract as the chain reports it now: keys and code, compared with the reproducible build. */
function ContractCard() {
  const facts = useMarketFacts().data;
  const market = MARKET_CONTRACT as string;
  const rows: [string, boolean | null, string][] = [
    [
      "Locked",
      facts ? facts.locked : null,
      facts ? (facts.locked ? "no access keys, so nobody can change it" : `${facts.fullAccessKeys} full-access key(s) remain`) : "",
    ],
    [
      "Code",
      facts?.codeHash ? facts.codeHash === MARKET_CODE_HASH : null,
      facts?.codeHash
        ? facts.codeHash === MARKET_CODE_HASH
          ? "matches the reproducible build in the repository"
          : `${facts.codeHash.slice(0, 12)}… isn't the published build`
        : "",
    ],
  ];
  return (
    <div className="rounded-panel border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-3">The contract, read now</p>
        <External href={explorer.nearAccount(market)}>{market}</External>
      </div>
      <ul className="mt-3 flex flex-col gap-2.5 text-[14px]">
        {rows.map(([label, ok, detail]) => (
          <li key={label} className="flex items-start gap-2.5">
            {ok === null ? (
              <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-fg-3" aria-label="Checking" />
            ) : ok ? (
              <Check className="mt-0.5 size-4 shrink-0 text-ok" strokeWidth={3} aria-label="Passes" />
            ) : (
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-label="Needs attention" />
            )}
            <span>
              <span className="font-medium">{label}</span>
              {detail ? <span className="text-fg-2">: {detail}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Reason({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="rounded-panel border border-line bg-surface p-5">
      <span className="inline-flex size-9 items-center justify-center rounded-[10px] bg-gold/12 text-accent [&_svg]:size-[18px]">{icon}</span>
      <p className="mt-4 text-[15.5px] font-semibold">{title}</p>
      <p className="mt-1.5 text-[14px] leading-relaxed text-fg-2">{children}</p>
    </div>
  );
}

function External({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
      {children}
      <ArrowUpRight className="size-3.5" />
    </a>
  );
}
