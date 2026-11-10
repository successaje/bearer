import type { Metadata } from "next";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "Try it in 60 seconds",
  description: "Six steps through a real Bearer vault on testnet: what's inside, receiving it as a link, securing it, and why the previous owner can't take it.",
};

const nb = (tx: string) => `https://testnet.nearblocks.io/txns/${tx}`;
const btc = (tx: string) => `https://blockstream.info/testnet4/tx/${tx}`;

/**
 * The judge's path: one story (a parent's vault for a child, vault No. 0009 on bearer.testnet),
 * six steps, each pointing at something real. "Live" steps read the chain as you look; "recorded"
 * ones are transactions already on testnet that anyone can open.
 */
const STEPS: { title: string; body: React.ReactNode; kind: "live" | "recorded" | "yours"; links: { label: string; href: string; external?: boolean }[] }[] = [
  {
    title: "See a sealed vault with Bitcoin inside",
    body: (
      <>
        A parent filled vault No. 0009, &ldquo;1st Son College Fund&rdquo;, with 300,000 testnet sats and 0.5 SOL. Its page reads the
        chain as you look: sealed, 0 withdrawal signatures ever requested, and the coins at its own Bitcoin and Solana addresses.
      </>
    ),
    kind: "live",
    links: [{ label: "Open vault No. 0009", href: "/v/9" }],
  },
  {
    title: "Receive one as a link",
    body: (
      <>
        A Bearer link holds its own small vault with real testnet coins. Open it and you hold the vault, with no wallet. Each link
        is a key, so they go out one per person and are never posted publicly. Got one? Open it from the message it came in.
      </>
    ),
    kind: "yours",
    links: [{ label: "Open a link", href: "/claim" }],
  },
  {
    title: "Secure it first",
    body: (
      <>
        Whoever sent the link still has a copy. The link page&apos;s first step moves the vault to a new private link or your NEAR
        account, and every copy of the old link is left empty. Vault No. 0010 went through three links like this; each earlier one
        then read &ldquo;This link is empty&rdquo;.
      </>
    ),
    kind: "recorded",
    links: [{ label: "Vault No. 0010's custody", href: "/v/10" }],
  },
  {
    title: "Same coins, new holder",
    body: (
      <>
        Handing a vault over moves nothing on Bitcoin. Vault No. 0006 held 684,666 sats when it changed hands in one NEAR transaction;
        that coin stayed at its address until the new holder withdrew it.
      </>
    ),
    kind: "recorded",
    links: [
      { label: "The handover", href: nb("H3XPWh2n5cvDKaqKS8pY4kSCjXDCaPgG3fp6E8beJJYj"), external: true },
      { label: "The withdrawal, on Bitcoin", href: btc("6002c967889d8185b4457837db9c44369b06af0208998cb445a64cea2b5e1e23"), external: true },
    ],
  },
  {
    title: "The previous owner is locked out",
    body: (
      <>
        A former owner asking for a withdrawal, or trying to break the seal, is refused by the contract (
        <span className="font-mono">ERR_NOT_OWNER</span>), and nothing reaches the signer. These were sent to the locked contract as
        real transactions; the attack lab re-reads each one from NEAR when you press Check.
      </>
    ),
    kind: "recorded",
    links: [{ label: "The attack lab", href: "/v/1#attack-lab" }],
  },
  {
    title: "Open it, and see the withdrawal",
    body: (
      <>
        Breaking the seal is permanent: an opened vault can never change hands again. Vault No. 0012 was opened from its link, with no
        wallet, and its Bitcoin withdrawal is byte for byte the transaction the contract signed.
      </>
    ),
    kind: "recorded",
    links: [
      { label: "Vault No. 0012", href: "/v/12" },
      { label: "Its Bitcoin withdrawal", href: btc("4c3191e9c2c9177654dab2a7b43459ed5800040e41fa0279eae0e81f6a3d3519"), external: true },
    ],
  },
];

const KIND = {
  live: { label: "Live", className: "border-ok/40 bg-ok/10 text-ok" },
  recorded: { label: "On testnet", className: "border-line-strong text-fg-2" },
  yours: { label: "Hands-on", className: "border-gold/40 bg-gold/10 text-accent" },
} as const;

export default function TryPage() {
  return (
    <div className="mx-auto max-w-[920px] px-5 pb-20 pt-12 md:px-8 md:pt-16">
      <Eyebrow>Try Bearer in 60 seconds</Eyebrow>
      <h1 className="text-balance mt-3 text-[clamp(34px,4.4vw,52px)] font-semibold leading-[1.05] tracking-[-0.04em]">
        A parent sends their child Bitcoin, <span className="text-fg-3">sealed.</span>
      </h1>
      <p className="mt-5 max-w-[640px] text-[17px] leading-relaxed text-fg-2">
        The child can check it&apos;s untouched, make it theirs alone, and open it when they&apos;re ready. Nobody who held it before
        can take it back. Six steps, each on NEAR testnet.
      </p>

      <ol className="mt-12 flex flex-col gap-4">
        {STEPS.map((s, i) => (
          <li key={s.title} className="grid grid-cols-[36px_minmax(0,1fr)] gap-4 rounded-panel border border-line bg-surface p-5 sm:p-6">
            <span className="tabular inline-flex size-9 items-center justify-center rounded-full border border-line-strong text-[14px] font-semibold text-fg-2">
              {i + 1}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <h2 className="text-[18px] font-semibold tracking-[-0.015em]">{s.title}</h2>
                <span className={`rounded-full border px-2 py-0.5 text-[11.5px] font-medium ${KIND[s.kind].className}`}>{KIND[s.kind].label}</span>
              </div>
              <p className="mt-2 text-[15px] leading-relaxed text-fg-2">{s.body}</p>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
                {s.links.map((l) =>
                  l.external ? (
                    <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[14px] font-medium text-accent hover:underline">
                      {l.label}
                      <ArrowUpRight className="size-3.5" />
                    </a>
                  ) : (
                    <Link key={l.href} href={l.href} className="inline-flex items-center gap-1 text-[14px] font-medium text-accent hover:underline">
                      {l.label}
                      <ArrowRight className="size-3.5" />
                    </Link>
                  ),
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-10 rounded-panel border border-line bg-surface p-6">
        <h2 className="text-[18px] font-semibold tracking-[-0.015em]">Check it all without trusting this page</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-fg-2">
          <span className="font-mono">pnpm verify</span> in the repository checks every claim here, and the README&apos;s, against the public
          chains: read-only, no keys. The proof page checks the contract&apos;s lock and code from your browser.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/proof" className={buttonVariants({ variant: "secondary" })}>
            The proof page
          </Link>
        </div>
        <p className="mt-4 text-[12.5px] text-fg-3">Testnet coins have no value. Not audited.</p>
      </div>
    </div>
  );
}
