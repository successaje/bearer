import { ArrowRight, Check, FileLock2, Globe, Link2, Lock, Network, Plus, ShieldCheck, Tag } from "lucide-react";
import Link from "next/link";
import { ChainIcon } from "@/components/brand/chain-icon";
import { Seal } from "@/components/brand/seal";
import { BearerCard } from "@/components/card/bearer-card";
import { HeroArt } from "@/components/landing/hero-art";
import { VerifyForm } from "@/components/landing/verify-form";
import { buttonVariants } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/primitives";
import { CHAIN_META } from "@/lib/vault/format";
import { cn } from "@/lib/utils";

const SEAL_CHECKS = [
  ["No signature in flight", "0 pending requests"],
  ["Base slot settled", "Every signed nonce proven via MPC Read RPC"],
  ["Solana slot settled", "No Solana signatures issued"],
  ["Bitcoin slot accounted", "0 coins encumbered"],
  ["Contract locked", "No full-access keys"],
  ["Code identity", "Hash matches the reproducible build"],
] as const;

export default function HomePage() {
  return (
    <>
      <section className="mx-auto grid max-w-[1200px] items-center gap-14 px-5 pb-20 pt-14 md:px-8 md:pb-24 md:pt-20 lg:grid-cols-[1.05fr_1fr]">
        <div className="min-w-0">
          <div className="inline-flex h-8 items-center gap-2.5 whitespace-nowrap rounded-full border border-line-strong bg-surface-2 pl-1 pr-1 text-[13px] text-fg-2 sm:pr-3.5">
            <span className="inline-flex h-6 items-center rounded-full bg-gold/15 px-2.5 text-[12px] font-medium text-accent">
              NEAR Chain Signatures
            </span>
            <span className="hidden sm:inline">Native BTC, ETH on Base and SOL</span>
          </div>
          <h1 className="text-balance mt-7 max-w-[640px] text-[clamp(42px,5.3vw,68px)] font-semibold leading-[1.02] tracking-[-0.045em]">
            Hand someone Bitcoin <span className="text-fg-3">like you&apos;d hand them a card.</span>
          </h1>
          <p className="text-pretty mt-7 max-w-[520px] text-[18px] leading-relaxed text-fg-2 md:text-[19px]">
            Bearer cards hold native BTC, ETH on Base, and SOL. Give one to anyone, even without a wallet, and
            prove it&apos;s sealed.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link href="/create" className={buttonVariants({ variant: "primary", size: "lg" })}>
              Create a card
              <ArrowRight className="size-[18px]" />
            </Link>
            <Link href="/verify" className={buttonVariants({ variant: "secondary", size: "lg" })}>
              <ShieldCheck className="size-[18px]" />
              Verify a card
            </Link>
          </div>
          <div className="mt-11 flex max-w-[520px] items-center gap-3.5 text-[13.5px] leading-relaxed text-fg-3">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-line-strong text-fg-2">
              <Lock className="size-4" />
            </span>
            No bridge, no custodian key. You trust NEAR&apos;s MPC network and an open-source contract that nobody
            can change.
          </div>
        </div>
        <HeroArt />
      </section>

      <section className="border-y border-line bg-surface">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-x-8 gap-y-4 px-5 py-5 md:px-8">
          <span className="text-[13.5px] text-fg-3">One card, three native addresses, derived by NEAR Chain Signatures.</span>
          <ul className="flex flex-wrap items-center gap-x-8 gap-y-3 text-[14px]">
            {(["btc", "evm", "sol"] as const).map((chain) => (
              <li key={chain} className="inline-flex items-center gap-2.5">
                <ChainIcon chain={chain} className="size-[22px]" />
                {CHAIN_META[chain].name} <span className="text-fg-3">{CHAIN_META[chain].network}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="how" className="mx-auto max-w-[1200px] scroll-mt-24 px-5 pt-24 md:px-8 md:pt-28">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <Eyebrow>How it works</Eyebrow>
            <h2 className="text-balance mt-3 max-w-[640px] text-[clamp(32px,3.6vw,46px)] font-semibold leading-[1.08] tracking-[-0.035em]">
              Three steps. Nothing moves until someone opens it.
            </h2>
          </div>
          <p className="max-w-[380px] text-[16px] leading-relaxed text-fg-2">
            Ownership changes on NEAR. The coins stay at the same addresses on their own chains the whole time.
          </p>
        </div>
        <ol className="mt-12 grid gap-5 md:grid-cols-3">
          <Step n="01" title="Create a card" body="Mint it on NEAR in one confirmation. It comes with its own Bitcoin, Base and Solana addresses.">
            <div className="relative w-[190px]">
              <div className="absolute inset-0 translate-x-6 -translate-y-3 rotate-6 rounded-[12px] border-[1.5px] border-dashed border-line-strong" />
              <BearerCard name="New card" finish="obsidian" chains={[]} />
              <span className="absolute -right-4 -top-3 inline-flex size-8 items-center justify-center rounded-full bg-gold text-ink shadow-[0_6px_16px_-4px_rgb(201_162_39/0.6)]">
                <Plus className="size-4" strokeWidth={2.5} />
              </span>
            </div>
          </Step>
          <Step n="02" title="Fill it" body="Send Bitcoin, ETH on Base or SOL to the card's addresses from any wallet. Deposits show up on their own.">
            <div className="flex w-[240px] flex-col gap-2">
              {(
                [
                  ["btc", "tb1q 8v4z … 9pdl", "+0.00041"],
                  ["evm", "0x71C7 … 9A2f", "+0.0050"],
                  ["sol", "7xKX … gAsU", "+0.032"],
                ] as const
              ).map(([chain, addr, amt]) => (
                <div key={chain} className="flex h-10 items-center gap-2.5 rounded-control border border-line-strong bg-bg px-3">
                  <ChainIcon chain={chain} className="size-[18px]" />
                  <span className="flex-1 font-mono text-[11.5px] text-fg-2">{addr}</span>
                  <span className="text-[11.5px] text-ok">{amt}</span>
                </div>
              ))}
            </div>
          </Step>
          <Step n="03" title="Hand it over" body="Send it to a NEAR account, or share a claim link with someone who has no wallet. Nothing moves on those chains until someone opens it.">
            <div className="flex items-center gap-3.5">
              <Avatar letter="A" name="ada.testnet" />
              <ArrowRight className="size-5 text-fg-3" />
              <div className="w-[92px] -rotate-3">
                <BearerCard name="" finish="obsidian" chains={[]} shadow={false} />
              </div>
              <ArrowRight className="size-5 text-fg-3" />
              <Avatar letter="T" name="theo.testnet" highlight />
            </div>
          </Step>
        </ol>
      </section>

      <section className="mx-auto max-w-[1200px] px-5 pt-24 md:px-8 md:pt-28">
        <Eyebrow>Built for handing over</Eyebrow>
        <h2 className="text-balance mt-3 max-w-[700px] text-[clamp(32px,3.6vw,46px)] font-semibold leading-[1.08] tracking-[-0.035em]">
          A wallet you can give away, sell, or send by link.
        </h2>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          <Bento
            className="md:col-span-2"
            icon={<Globe />}
            title="Native, not wrapped"
            body="Real BTC on Bitcoin, ETH on Base and SOL on Solana, at addresses only the card's owner can open through NEAR."
          >
            <div className="grid gap-2 sm:grid-cols-3">
              {(["btc", "evm", "sol"] as const).map((chain) => (
                <div key={chain} className="rounded-[12px] border border-line bg-bg p-3.5">
                  <ChainIcon chain={chain} className="size-7" />
                  <div className="mt-3 text-[14px] font-medium">{CHAIN_META[chain].name}</div>
                  <div className="text-[12.5px] text-fg-3">{CHAIN_META[chain].network}</div>
                </div>
              ))}
            </div>
          </Bento>
          <Bento icon={<Link2 />} title="Claim links" body="Send a link to someone with no wallet. They pick a name and the card is theirs.">
            <div className="flex h-11 items-center gap-2 overflow-hidden rounded-control border border-line bg-bg px-3 font-mono text-[12px] text-fg-2">
              <Link2 className="size-3.5 shrink-0 text-accent" />
              <span className="truncate">bearer.app/claim#4vJ9JU1bJJE96F…</span>
            </div>
          </Bento>
          <Bento icon={<Tag />} title="Sell in one transaction" body="List a card for NEAR. The buyer pays, the seller gets paid and the card moves, all at once.">
            <div className="flex items-baseline gap-2">
              <span className="tabular text-[34px] font-semibold tracking-[-0.03em]">120</span>
              <span className="text-[15px] text-fg-2">NEAR</span>
              <span className="ml-auto text-[12.5px] text-fg-3">reverts if the seal changes</span>
            </div>
          </Bento>
          <Bento icon={<ShieldCheck />} title="A seal you can check" body="Every card carries a live report: what's sealed, what's excluded, and the evidence.">
            <ul className="flex flex-col gap-1.5 text-[12.5px] text-fg-2">
              {SEAL_CHECKS.slice(0, 3).map(([t]) => (
                <li key={t} className="flex items-center gap-2">
                  <Check className="size-3.5 text-ok" strokeWidth={3} />
                  {t}
                </li>
              ))}
            </ul>
          </Bento>
          <Bento icon={<FileLock2 />} title="Locked and reproducible" body="The contract has no full-access keys. Its code hash matches a build anyone can reproduce.">
            <div className="rounded-control border border-line bg-bg px-3 py-2.5 font-mono text-[12px] text-fg-2">
              code_hash 8f3c 1d0a 77be … a91e
            </div>
          </Bento>
        </div>
      </section>

      <section id="seal" className="mx-auto max-w-[1200px] scroll-mt-24 px-5 pt-24 md:px-8 md:pt-28">
        <div className="grid items-center gap-12 rounded-[24px] border border-line bg-surface p-6 sm:p-10 md:p-14 lg:grid-cols-2">
          <div className="min-w-0">
            <Eyebrow>The seal</Eyebrow>
            <h2 className="text-balance mt-3 text-[clamp(30px,3.3vw,42px)] font-semibold leading-[1.1] tracking-[-0.035em]">
              Know it&apos;s sealed before you accept it.
            </h2>
            <p className="text-pretty mt-5 max-w-[480px] text-[16px] leading-relaxed text-fg-2">
              A previous owner could keep a signed transaction and empty the card later. Every card&apos;s Seal report
              checks for exactly that, chain by chain, and links the evidence.
            </p>
            <VerifyForm className="mt-9 max-w-[520px]" />
          </div>
          <div className="min-w-0 overflow-hidden rounded-panel border border-line-strong bg-bg shadow-lifted">
            <div className="flex items-center gap-4 border-b border-line bg-ok/[0.06] p-5 sm:p-6">
              <Seal variant="check" className="size-[52px] shrink-0" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <span className="text-[19px] font-semibold tracking-[-0.01em]">Sealed</span>
                  <span className="inline-flex h-[22px] items-center rounded-full border border-ok/30 bg-ok/10 px-2 text-[12px] font-medium text-ok">
                    6 of 6 checks passed
                  </span>
                </div>
                <p className="mt-1 text-[14px] text-fg-2">No previous owner can move what&apos;s inside.</p>
              </div>
            </div>
            <ul className="py-1.5">
              {SEAL_CHECKS.map(([title, sub]) => (
                <li key={title} className="flex items-center gap-3 px-5 py-2.5 sm:px-6">
                  <span className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-full bg-ok/15 text-ok">
                    <Check className="size-3" strokeWidth={3} />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[14px] font-medium">{title}</div>
                    <div className="text-[12.5px] text-fg-3">{sub}</div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="border-t border-line px-5 py-3.5 text-[12.5px] leading-relaxed text-fg-3 sm:px-6">
              You&apos;re trusting NEAR&apos;s MPC network and the Bearer contract code (open source, locked).
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-5 pt-24 md:px-8 md:pt-28">
        <Eyebrow>What you&apos;re trusting</Eyebrow>
        <h2 className="text-balance mt-3 max-w-[680px] text-[clamp(30px,3.3vw,42px)] font-semibold leading-[1.1] tracking-[-0.035em]">
          No bridge. No custodian. Here&apos;s what&apos;s left.
        </h2>
        <div className="mt-12 grid gap-x-8 gap-y-10 border-t border-line pt-9 md:grid-cols-3">
          <Trust icon={<Network />} title="NEAR's MPC network">
            A threshold of independent operators must agree before any signature exists. Only the Bearer contract can ask
            for one, and only for the card&apos;s owner.
          </Trust>
          <Trust icon={<FileLock2 />} title="The Bearer contract">
            Open source and locked: no full-access keys, so nobody can change it. Its code hash matches a build you can
            reproduce.
          </Trust>
          <Trust icon={<Globe />} title="Public chain data">
            Balances come from public explorers and RPCs, for display. The seal checks themselves run on NEAR.
          </Trust>
        </div>
        <Link href="/how#trust" className="mt-9 inline-flex items-center gap-2 text-[15px] font-medium text-accent hover:underline">
          Read the full trust model
          <ArrowRight className="size-4" />
        </Link>
      </section>
    </>
  );
}

function Step({ n, title, body, children }: { n: string; title: string; body: string; children: React.ReactNode }) {
  return (
    <li className="overflow-hidden rounded-panel border border-line bg-surface">
      <div aria-hidden className="flex h-[210px] items-center justify-center border-b border-line bg-surface-2">
        {children}
      </div>
      <div className="px-6 pb-7 pt-6">
        <div className="font-mono text-[12px] text-fg-3">{n}</div>
        <h3 className="mt-2.5 text-[19px] font-semibold tracking-[-0.02em]">{title}</h3>
        <p className="mt-2 text-[15px] leading-relaxed text-fg-2">{body}</p>
      </div>
    </li>
  );
}

function Avatar({ letter, name, highlight }: { letter: string; name: string; highlight?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <span
        className={cn(
          "inline-flex size-10 items-center justify-center rounded-full border text-[14px] font-semibold",
          highlight ? "border-gold/40 bg-gold/15 text-accent" : "border-line-strong bg-raised text-fg-2",
        )}
      >
        {letter}
      </span>
      <span className="text-[11px] text-fg-3">{name}</span>
    </div>
  );
}

function Bento({
  icon,
  title,
  body,
  children,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col justify-between gap-8 rounded-panel border border-line bg-surface p-6", className)}>
      <div>
        <span className="inline-flex size-10 items-center justify-center rounded-control border border-line-strong bg-surface-2 text-accent [&_svg]:size-[18px]">
          {icon}
        </span>
        <h3 className="mt-5 text-[18px] font-semibold tracking-[-0.015em]">{title}</h3>
        <p className="mt-2 max-w-[460px] text-[15px] leading-relaxed text-fg-2">{body}</p>
      </div>
      <div aria-hidden>{children}</div>
    </div>
  );
}

function Trust({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="inline-flex size-10 items-center justify-center rounded-control border border-line-strong bg-surface text-accent [&_svg]:size-[18px]">
        {icon}
      </span>
      <h3 className="mt-5 text-[17px] font-semibold tracking-[-0.015em]">{title}</h3>
      <p className="mt-2 text-[15px] leading-relaxed text-fg-2">{children}</p>
    </div>
  );
}
