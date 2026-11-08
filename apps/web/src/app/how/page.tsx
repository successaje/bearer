import { ArrowDown, ChevronDown, FileLock2, Globe, Network, ShieldAlert, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ChainIcon } from "@/components/brand/chain-icon";
import { Seal } from "@/components/brand/seal";
import { SectionIndex } from "@/components/how/section-index";
import { buttonVariants } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/primitives";
import { BEARER_CONTRACT, EVM_FINALITY, SIGNER_CONTRACT } from "@/lib/config";
import { CHAIN_META } from "@/lib/format";

export const metadata: Metadata = {
  title: "How it works",
  description: "How a Bearer card holds native coins, how the seal works, and exactly what you're trusting.",
};

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "seal", label: "The seal" },
  { id: "hand-over", label: "Handing over" },
  { id: "claim-links", label: "Claim links" },
  { id: "market", label: "Buying and selling" },
  { id: "trust", label: "What you're trusting" },
  { id: "faq", label: "FAQ" },
];

const FAQ: [string, ReactNode][] = [
  ["Is this real money?", "No. Bearer is a testnet prototype: NEAR testnet, Bitcoin testnet4, Base Sepolia and Solana devnet. Testnet coins have no value. Dollar figures are estimates, labelled est."],
  ["Can the Bearer team move my coins?", "No. The contract is locked: it has no full-access keys, so nobody can change its code or move a card. Only a card's owner can ask NEAR's MPC network to sign for its addresses."],
  ["Why can't I hand over right after opening SOL?", "A Solana signature stays valid until its blockhash expires. The card waits 300 seconds after its last Solana signature, so no previous owner can land one after you hand it over."],
  ["What does “excluded” mean?", "A previous owner signed a Bitcoin withdrawal that spends that coin. It may never be broadcast, but it could be, so the coin doesn't count toward the sealed value. It's shown openly on the Seal report."],
  ["Why only Base Sepolia for ETH?", "The card's 0x address exists on every EVM network, but this version only builds and proves transactions on Base Sepolia. Funds sent on other networks can't be opened by this version."],
  ["Do I need a wallet to receive a card?", "No. With a claim link you can create a free NEAR testnet account right on the claim page, then import it into a wallet later."],
  ["What if I lose the account that holds a card?", "Then the card is lost, like cash. Save your recovery phrase. Bearer can't recover cards for anyone."],
];

export default function HowPage() {
  return (
    <div className="mx-auto max-w-[1200px] px-5 pt-14 md:px-8 md:pt-20">
      <div className="max-w-[760px]">
        <Eyebrow>How it works</Eyebrow>
        <h1 className="text-balance mt-3 text-[clamp(36px,5vw,58px)] font-semibold leading-[1.02] tracking-[-0.045em]">
          A wallet that changes hands without moving the money.
        </h1>
        <p className="text-pretty mt-5 text-[17px] leading-relaxed text-fg-2">
          On every chain, coins are bound to keys, so changing who owns them means moving them. On NEAR, a contract can
          control native addresses on other chains. Bearer turns that into a card you can hand to someone, and proves
          nobody else can still spend what&apos;s inside.
        </p>
      </div>

      <div className="mt-16 grid gap-12 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-16">
        <aside>
          <SectionIndex sections={SECTIONS} />
        </aside>

        <div className="flex min-w-0 flex-col gap-24">
          <Section id="overview" eyebrow="01 · Overview" title="A card is an NFT that controls three addresses.">
            <p>
              Each card is a token on NEAR. The Bearer contract derives a Bitcoin, a Base and a Solana address for it
              through NEAR Chain Signatures. Whoever holds the token is the only one who can ask NEAR&apos;s MPC network
              to sign for those addresses.
            </p>
            <Diagram />
          </Section>

          <Section id="seal" eyebrow="02 · The seal" title="Proof that no previous owner can still spend it.">
            <p>
              The risk with handing over a wallet is a signed transaction kept in a drawer: a previous owner could
              broadcast it later and empty the card. The Seal report checks for that on every chain, using rules the
              contract enforces before any transfer.
            </p>
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              <Rule chain="evm" title="Base: every nonce proven">
                Each Base transaction the card signs uses a nonce. The card can change hands only after NEAR proves,
                through MPC Read RPC at {EVM_FINALITY} finality, that every signed nonce is already used on Base Sepolia.
              </Rule>
              <Rule chain="sol" title="Solana: wait out the window">
                Solana signatures expire with their blockhash. The card waits 300 seconds after its last Solana
                signature. Durable nonces can&apos;t be signed by construction.
              </Rule>
              <Rule chain="btc" title="Bitcoin: exclude, don't block">
                Every coin referenced by an issued signature is recorded as encumbered and excluded from the sealed
                value. The rest of the card stays transferable.
              </Rule>
              <div className="rounded-panel border border-line bg-surface p-5">
                <div className="flex items-center gap-2.5">
                  <span className="inline-flex size-7 items-center justify-center rounded-full bg-raised text-fg-2">
                    <ShieldAlert className="size-4" />
                  </span>
                  <h3 className="text-[15.5px] font-semibold">Nothing in flight</h3>
                </div>
                <p className="mt-2.5 text-[14px] leading-relaxed text-fg-2">
                  A card can&apos;t move while a signing request is running. Stuck requests can be cleared by anyone
                  after they expire.
                </p>
              </div>
            </div>
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              <Verdict seal="check" title="Sealed">No previous owner can move what&apos;s inside.</Verdict>
              <Verdict seal="check" mark title="Sealed, with exclusions">
                Some Bitcoin is excluded because an earlier signature could spend it.
              </Verdict>
              <Verdict seal="cracked" title="Not transferable yet">Something must be proven, waited out or cleared first.</Verdict>
            </div>
          </Section>

          <Section id="hand-over" eyebrow="03 · Handing over" title="One NEAR transaction. Nothing moves on the other chains.">
            <p>
              Send a card to any NEAR account, or create a claim link. Either way, the contract checks the seal, clears
              any listing or claim link, and changes the owner in a single NEAR transaction. The coins stay exactly where
              they are.
            </p>
            <ul className="mt-6 flex flex-col gap-3">
              <Bullet>A card must be Active to hand over: not listed and without an open claim link.</Bullet>
              <Bullet>A pre-flight seal check runs before you confirm, and again inside the contract.</Bullet>
              <Bullet>After a hand-over, any listing or claim link from the previous owner stops working.</Bullet>
            </ul>
          </Section>

          <Section id="claim-links" eyebrow="04 · Claim links" title="Give a card to someone who has no wallet.">
            <p>
              A claim link carries a key made in your browser. It sits after the # in the link, so it&apos;s never sent
              to a server, and the claim page removes it from the address bar as soon as it&apos;s read.
            </p>
            <ul className="mt-6 flex flex-col gap-3">
              <Bullet>The key can only claim this card, or create an account and claim it. Nothing else.</Bullet>
              <Bullet>The recipient can sign in with a wallet, or create a free testnet account on the spot.</Bullet>
              <Bullet>You can cancel the link until someone uses it. Anyone with the link can claim, so send it privately.</Bullet>
            </ul>
          </Section>

          <Section id="market" eyebrow="05 · Buying and selling" title="Sell a funded wallet in one transaction.">
            <p>
              List a card for a fixed price in NEAR. While it&apos;s listed, it can&apos;t sign withdrawals. A buyer
              reviews the live Seal report and buys against the version they reviewed: if anything changed since, the
              purchase reverts and they keep their NEAR. On success, the seller is paid in the same transaction.
            </p>
          </Section>

          <Section id="trust" eyebrow="06 · What you're trusting" title="No bridge, no custodian. Here's what's left.">
            <div className="grid gap-3 sm:grid-cols-2">
              <TrustItem icon={<Network />} title="NEAR's MPC network">
                A threshold of independent operators must agree to sign. Bearer uses <code className="font-mono text-[13px]">{SIGNER_CONTRACT}</code>.
              </TrustItem>
              <TrustItem icon={<FileLock2 />} title="The Bearer contract">
                Open source and locked at <code className="font-mono text-[13px]">{BEARER_CONTRACT}</code>. Its code hash
                matches a reproducible build.
              </TrustItem>
              <TrustItem icon={<ShieldAlert />} title="Base proofs at Safe finality">
                Base withdrawals count as proven once their batch is posted to Sepolia ({EVM_FINALITY}), not after full
                L1 finality.
              </TrustItem>
              <TrustItem icon={<Globe />} title="Display data">
                Balances and coin lists come from public explorers and RPCs. They&apos;re shown for display; the seal
                checks run on NEAR.
              </TrustItem>
            </div>
            <div className="mt-6 rounded-panel border border-warn/30 bg-warn/[0.06] p-5 text-[14.5px] leading-relaxed text-fg-2">
              <strong className="font-semibold text-fg">This is a testnet prototype.</strong> It hasn&apos;t been
              audited. Don&apos;t use it with real funds.
            </div>
          </Section>

          <Section id="faq" eyebrow="07 · FAQ" title="Questions people ask.">
            <div className="divide-y divide-line overflow-hidden rounded-panel border border-line bg-surface">
              {FAQ.map(([q, a]) => (
                <details key={q} className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-[15.5px] font-medium">
                    {q}
                    <ChevronDown aria-hidden className="size-4 shrink-0 text-fg-3 transition-transform group-open:rotate-180" />
                  </summary>
                  <p className="px-5 pb-5 text-[14.5px] leading-relaxed text-fg-2">{a}</p>
                </details>
              ))}
            </div>
            <div className="mt-10 flex flex-wrap gap-3">
              <Link href="/create" className={buttonVariants({ variant: "primary", size: "lg" })}>
                Create a card
              </Link>
              <Link href="/verify" className={buttonVariants({ size: "lg" })}>
                Verify a card
              </Link>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-28">
      <p className="font-mono text-[11.5px] font-medium uppercase tracking-[0.16em] text-accent">{eyebrow}</p>
      <h2 id={`${id}-title`} className="text-balance mt-3 text-[clamp(26px,3vw,36px)] font-semibold leading-[1.12] tracking-[-0.03em]">
        {title}
      </h2>
      <div className="mt-5 max-w-[720px] text-[16px] leading-relaxed text-fg-2 [&>p+p]:mt-4">{children}</div>
    </section>
  );
}

function Bullet({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className="mt-[10px] size-1.5 shrink-0 rounded-full bg-gold" />
      <span>{children}</span>
    </li>
  );
}

function Rule({ chain, title, children }: { chain: "btc" | "evm" | "sol"; title: string; children: ReactNode }) {
  return (
    <div className="rounded-panel border border-line bg-surface p-5">
      <div className="flex items-center gap-2.5">
        <ChainIcon chain={chain} className="size-7" />
        <h3 className="text-[15.5px] font-semibold text-fg">{title}</h3>
      </div>
      <p className="mt-2.5 text-[14px] leading-relaxed text-fg-2">{children}</p>
    </div>
  );
}

function Verdict({ seal, mark, title, children }: { seal: "check" | "cracked"; mark?: boolean; title: string; children: ReactNode }) {
  return (
    <div className="rounded-panel border border-line bg-surface p-5">
      <div className="relative inline-flex">
        <Seal variant={seal} className="size-11" />
        {mark ? (
          <span aria-hidden className="absolute -bottom-0.5 -right-0.5 inline-flex size-5 items-center justify-center rounded-full border-2 border-surface bg-[#D97706] text-[11px] font-bold text-ink">
            !
          </span>
        ) : null}
      </div>
      <h3 className="mt-3 text-[15px] font-semibold text-fg">{title}</h3>
      <p className="mt-1 text-[13.5px] leading-relaxed text-fg-2">{children}</p>
    </div>
  );
}

function TrustItem({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="rounded-panel border border-line bg-surface p-5">
      <span className="inline-flex size-9 items-center justify-center rounded-control border border-line-strong bg-surface-2 text-accent [&_svg]:size-4">
        {icon}
      </span>
      <h3 className="mt-4 text-[15.5px] font-semibold text-fg">{title}</h3>
      <p className="mt-1.5 text-[14px] leading-relaxed text-fg-2">{children}</p>
    </div>
  );
}

function Node({ icon, title, sub }: { icon: ReactNode; title: string; sub: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[14px] border border-line-strong bg-surface-2 px-4 py-3.5">
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-control bg-raised text-accent [&_svg]:size-[18px]">{icon}</span>
      <div className="min-w-0">
        <p className="text-[14.5px] font-semibold text-fg">{title}</p>
        <p className="truncate font-mono text-[12px] text-fg-3">{sub}</p>
      </div>
    </div>
  );
}

function Connector({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-2 pl-[30px]">
      <div className="flex flex-col items-center text-fg-3">
        <span className="h-4 w-px bg-line-strong" />
        <ArrowDown className="size-3.5" />
      </div>
      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-3">{label}</span>
    </div>
  );
}

function Diagram() {
  return (
    <figure className="mt-8 rounded-[20px] border border-line bg-surface p-5 sm:p-7">
      <div className="mx-auto max-w-[460px]">
        <Node icon={<Wallet />} title="You" sub="the card's owner, on NEAR" />
        <Connector label="hand over · open · list" />
        <Node icon={<FileLock2 />} title="Bearer contract" sub={BEARER_CONTRACT} />
        <Connector label="sign request, payload built on-chain" />
        <Node icon={<Network />} title="NEAR MPC network" sub={SIGNER_CONTRACT} />
        <Connector label="signs for derived addresses" />
        <div className="grid grid-cols-3 gap-2">
          {(["btc", "evm", "sol"] as const).map((c) => (
            <div key={c} className="flex flex-col items-center gap-2 rounded-[14px] border border-line-strong bg-surface-2 px-2 py-3.5 text-center">
              <ChainIcon chain={c} className="size-7" />
              <span className="text-[13px] font-medium text-fg">{CHAIN_META[c].name}</span>
              <span className="text-[11.5px] text-fg-3">{CHAIN_META[c].network}</span>
            </div>
          ))}
        </div>
      </div>
      <figcaption className="mt-6 text-center text-[13px] text-fg-3">
        The contract builds every transaction itself, so the app can never ask for arbitrary signatures.
      </figcaption>
    </figure>
  );
}
