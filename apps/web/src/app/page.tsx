import { ArrowRight, FileLock2, Globe, Lock, Network, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { ChainIcon } from "@/components/brand/chain-icon";
import { AttackPreview } from "@/components/landing/attack-preview";
import { Chapters } from "@/components/landing/chapters";
import { HeroArt } from "@/components/landing/hero-art";
import { RevealObserver } from "@/components/landing/motion";
import { UseCases } from "@/components/landing/use-cases";
import { buttonVariants } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/primitives";
import { CHAIN_META } from "@/lib/vault/format";

export default function HomePage() {
  return (
    <>
      <RevealObserver />

      <section className="mx-auto grid max-w-[1200px] items-center gap-14 px-5 pb-20 pt-14 md:px-8 md:pb-24 md:pt-20 lg:grid-cols-[1.05fr_1fr]">
        <div className="min-w-0">
          <div className="inline-flex h-8 items-center gap-2.5 whitespace-nowrap rounded-full border border-line-strong bg-surface-2 pl-1 pr-1 text-[13px] text-fg-2 sm:pr-3.5">
            <span className="inline-flex h-6 items-center rounded-full bg-gold/15 px-2.5 text-[12px] font-medium text-accent">
              NEAR Chain Signatures
            </span>
            <span className="hidden sm:inline">Native BTC, ETH on Base and SOL</span>
          </div>
          <h1 className="text-balance mt-7 max-w-[660px] text-[clamp(42px,5.3vw,68px)] font-semibold leading-[1.02] tracking-[-0.045em]">
            Bitcoin that changes hands <span className="text-fg-3">without a Bitcoin transaction.</span>
          </h1>
          <p className="text-pretty mt-7 max-w-[540px] text-[18px] leading-relaxed text-fg-2 md:text-[19px]">
            A sealed Bearer vault holds native BTC, plus ETH on Base and SOL. It moves to its next owner in one NEAR
            transaction, with no Bitcoin fee, and they can check nothing was ever signed for it. Only whoever holds it
            can break the seal.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link href="/create" className={buttonVariants({ variant: "primary", size: "lg" })}>
              Create a vault
              <ArrowRight className="size-[18px]" />
            </Link>
            <Link href="/verify" className={buttonVariants({ variant: "secondary", size: "lg" })}>
              <ShieldCheck className="size-[18px]" />
              Verify a vault
            </Link>
          </div>
          <div className="mt-11 flex max-w-[540px] items-center gap-3.5 text-[13.5px] leading-relaxed text-fg-3">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-line-strong text-fg-2">
              <Lock className="size-4" />
            </span>
            No bridge, no custodian key. You trust NEAR&apos;s MPC network and a locked, open-source contract.
          </div>
        </div>
        <HeroArt />
      </section>

      <section className="border-y border-line bg-surface">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-x-8 gap-y-4 px-5 py-5 md:px-8">
          <span className="text-[13.5px] text-fg-3">One vault, three native addresses, derived by NEAR Chain Signatures.</span>
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

      <Chapters />

      <UseCases />

      <AttackPreview />

      <section className="mx-auto max-w-[1200px] px-5 pt-24 md:px-8 md:pt-32">
        <div data-reveal>
          <Eyebrow>What you&apos;re trusting</Eyebrow>
          <h2 className="text-balance mt-3 max-w-[680px] text-[clamp(30px,3.3vw,42px)] font-semibold leading-[1.1] tracking-[-0.035em]">
            No bridge. No custodian key. <span className="text-fg-3">Here&apos;s what&apos;s left.</span>
          </h2>
        </div>
        <div className="mt-12 grid gap-x-8 gap-y-10 border-t border-line pt-9 md:grid-cols-3">
          <Trust icon={<Network />} title="NEAR's MPC network">
            A threshold of independent operators must agree before any signature exists. Only the Bearer contract can ask
            for one, and only for a vault&apos;s current owner after the seal is broken.
          </Trust>
          <Trust icon={<FileLock2 />} title="The Bearer contract">
            Open source and locked: no full-access keys and no upgrade method, so nobody can change its rules. Its code
            hash matches a build you can reproduce.
          </Trust>
          <Trust icon={<Globe />} title="Public chain data">
            Balances come from public explorers and RPCs, labelled with source and time. The contract never relies on
            them.
          </Trust>
        </div>
        <p className="mt-10 max-w-[720px] text-[14px] leading-relaxed text-fg-3">
          Testnet prototype, not audited. Once opened, a vault can&apos;t change hands, and Bearer doesn&apos;t escrow
          payments between people.
        </p>
        <Link href="/how#trust" className="mt-6 inline-flex items-center gap-2 text-[15px] font-medium text-accent hover:underline">
          Read the full trust model
          <ArrowRight className="size-4" />
        </Link>
      </section>
    </>
  );
}

function Trust({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div data-reveal>
      <span className="inline-flex size-10 items-center justify-center rounded-control border border-line-strong bg-surface text-accent [&_svg]:size-[18px]">
        {icon}
      </span>
      <h3 className="mt-5 text-[17px] font-semibold tracking-[-0.015em]">{title}</h3>
      <p className="mt-2 text-[15px] leading-relaxed text-fg-2">{children}</p>
    </div>
  );
}
