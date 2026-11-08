import {
  ArrowLeftRight,
  ArrowRight,
  Ban,
  Coins,
  Eye,
  FileCheck2,
  Fingerprint,
  Globe,
  Hand,
  KeyRound,
  Repeat,
  ScrollText,
  ShieldCheck,
  Undo2,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { VerifyForm } from "./verify-form";
import { ChapterIndex } from "./chapter-index";
import { OpenDemo } from "./open-demo";
import { RejectArt } from "./reject-art";
import { SealArt } from "./seal-art";
import { Guilloche, Halftone, StepEdge } from "./textures";
import { TransferArt } from "./transfer-art";
import { DemoSealPanel } from "./verify-art";
import { WhoCanWithdraw } from "./who-can-withdraw";

type Tone = "ink" | "gold" | "ivory" | "forest";

/** Each chapter is a fixed colour in both themes; `theme` re-themes the real components inside it. */
const TONES: Record<
  Tone,
  { bg: string; theme: "dark" | "light"; text: string; muted: string; body: string; eyebrow: string; icon: string; cta: string }
> = {
  ink: {
    bg: "bg-ink",
    theme: "dark",
    text: "text-[#f4f4f5]",
    muted: "text-white/40",
    body: "text-white/70",
    eyebrow: "text-gold-light",
    icon: "border-white/10 bg-white/[0.05] text-gold-light",
    cta: "bg-gold text-ink hover:bg-[#d6b03a]",
  },
  gold: {
    bg: "bg-gold",
    theme: "light",
    text: "text-ink",
    muted: "text-ink/45",
    body: "text-ink/75",
    eyebrow: "text-ink/60",
    icon: "border-ink/15 bg-ink/[0.06] text-ink",
    cta: "bg-ink text-gold hover:bg-ink/90",
  },
  ivory: {
    bg: "bg-ivory",
    theme: "light",
    text: "text-ink",
    muted: "text-ink/40",
    body: "text-ink/70",
    eyebrow: "text-gold-deep",
    icon: "border-ink/10 bg-white/70 text-gold-deep",
    cta: "bg-ink text-ivory hover:bg-ink/90",
  },
  forest: {
    bg: "bg-forest",
    theme: "dark",
    text: "text-[#eef5f0]",
    muted: "text-mint/55",
    body: "text-white/70",
    eyebrow: "text-mint",
    icon: "border-white/10 bg-white/[0.05] text-mint",
    cta: "bg-mint text-forest hover:bg-[#b5e5c8]",
  },
};

function Chapter({
  id,
  tone,
  className,
  children,
}: {
  id: string;
  tone: Tone;
  className?: string;
  children: ReactNode;
}) {
  const t = TONES[tone];
  return (
    <section
      id={`chapter-${id}`}
      data-chapter={id}
      data-tone={t.theme}
      data-theme={t.theme}
      data-inview="false"
      aria-labelledby={`chapter-${id}-title`}
      className={cn("relative scroll-mt-16 overflow-clip", t.bg, t.text, className)}
    >
      {children}
    </section>
  );
}

/** Text column: mono eyebrow, two-tone headline, copy, icon bullets and a pill CTA. */
function ChapterText({
  id,
  n,
  tone,
  title,
  muted,
  body,
  bullets,
  cta,
}: {
  id: string;
  n: string;
  tone: Tone;
  title: string;
  muted: string;
  body: ReactNode;
  bullets: [ReactNode, string][];
  cta: { href: string; label: string };
}) {
  const t = TONES[tone];
  return (
    <div data-reveal className="min-w-0">
      <p className={cn("font-mono text-[11.5px] font-medium uppercase tracking-[0.18em]", t.eyebrow)}>
        {n} · {id}
      </p>
      <h2
        id={`chapter-${id}-title`}
        className="text-balance mt-4 text-[clamp(34px,4.2vw,54px)] font-semibold leading-[1.02] tracking-[-0.045em]"
      >
        {title} <span className={t.muted}>{muted}</span>
      </h2>
      <p className={cn("text-pretty mt-6 max-w-[480px] text-[17px] leading-relaxed", t.body)}>{body}</p>
      <ul className="mt-8 flex max-w-[480px] flex-col gap-3.5">
        {bullets.map(([icon, text]) => (
          <li key={text} className="flex items-center gap-3.5">
            <span
              aria-hidden
              className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] border [&_svg]:size-4", t.icon)}
            >
              {icon}
            </span>
            <span className={cn("text-[15px] leading-snug", t.body)}>{text}</span>
          </li>
        ))}
      </ul>
      <Link
        href={cta.href}
        className={cn(
          "mt-10 inline-flex h-11 items-center gap-2 rounded-full px-5 text-[14.5px] font-semibold transition-colors",
          t.cta,
        )}
      >
        {cta.label}
        <ArrowRight className="size-4" />
      </Link>
    </div>
  );
}

const INNER = "mx-auto max-w-[1200px] px-5 md:px-8 lg:pl-[200px]";

/**
 * The landing page's middle (brief 10.3): five full-bleed chapters with stepped edges,
 * a sticky mono index, slow textures and one live visual each.
 */
export function Chapters() {
  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-0 z-20 hidden lg:block">
        <div className="mx-auto h-full max-w-[1200px] px-8 pb-40 pt-32">
          <ChapterIndex />
        </div>
      </div>

      <StepEdge from="bg-bg" to="fill-ink" />

      <Chapter id="seal" tone="ink">
        <div className={cn(INNER, "grid items-center gap-14 py-24 md:py-32 lg:grid-cols-2 lg:gap-12")}>
          <ChapterText
            id="seal"
            n="01"
            tone="ink"
            title="Fill it from any wallet."
            muted="It stays sealed."
            body="Every vault comes with its own Bitcoin, Base and Solana addresses. Send coins from anywhere. While the seal is intact, nobody can even ask for a withdrawal signature."
            bullets={[
              [<Coins key="i" />, "Native BTC, ETH on Base and SOL. Nothing wrapped."],
              [<Eye key="i" />, "Balances observed, each with its source and time."],
              [<ShieldCheck key="i" />, "0 signatures ever requested, enforced by the contract."],
            ]}
            cta={{ href: "/create", label: "Create a vault" }}
          />
          <div className="relative" data-reveal style={{ "--reveal-delay": "80ms" } as React.CSSProperties}>
            <Halftone className="-inset-16 text-gold/25" />
            <SealArt />
          </div>
        </div>
      </Chapter>

      <StepEdge from="bg-ink" to="fill-gold" flip />

      <Chapter
        id="transfer"
        tone="gold"
        className="transfer-scope lg:supports-[animation-timeline:view()]:h-[190vh] motion-reduce:h-auto!"
      >
        <div className="lg:sticky lg:top-0 lg:flex lg:min-h-screen lg:items-center">
          <div className={cn(INNER, "grid w-full items-center gap-14 py-24 md:py-32 lg:grid-cols-2 lg:gap-12 lg:py-16")}>
            <ChapterText
              id="transfer"
              n="02"
              tone="gold"
              title="Hand it over in one NEAR transaction."
              muted="Nothing moves on Bitcoin, Base or Solana."
              body="Send a sealed vault to any NEAR account. The new holder gets control of all three addresses and everything at them. The coins stay exactly where they are."
              bullets={[
                [<ArrowLeftRight key="i" />, "Ownership changes on NEAR. The addresses stay the same."],
                [<ScrollText key="i" />, "The custody log on the back gains a line for every holder."],
                [<Undo2 key="i" />, "The sender can't withdraw or take it back."],
              ]}
              cta={{ href: "/v/17", label: "See a vault that changed hands" }}
            />
            <div className="relative flex justify-center" data-reveal style={{ "--reveal-delay": "80ms" } as React.CSSProperties}>
              <Guilloche className="-right-24 top-1/2 size-[640px] -translate-y-1/2 text-ink/[0.12]" />
              <TransferArt />
            </div>
          </div>
        </div>
      </Chapter>

      <StepEdge from="bg-gold" to="fill-ivory" />

      <Chapter id="reject" tone="ivory">
        <div className={cn(INNER, "grid items-center gap-14 py-24 md:py-32 lg:grid-cols-2 lg:gap-12")}>
          <ChapterText
            id="reject"
            n="03"
            tone="ivory"
            title="The old owner can't get back in."
            muted="The contract says no."
            body={
              <>
                Once alice.testnet hands the vault to bob.testnet, every attempt from alice.testnet is refused, on every
                chain. There&apos;s no signature to have kept: none was ever requested.
              </>
            }
            bullets={[
              [<Ban key="i" />, "ERR_NOT_OWNER for withdrawing and for breaking the seal."],
              [<FileCheck2 key="i" />, "Each refusal is a sandbox test in the repository."],
              [<KeyRound key="i" />, "No admin key, no upgrade path, no override."],
            ]}
            cta={{ href: "#attack-lab", label: "Run the attack lab" }}
          />
          <div className="relative flex justify-center" data-reveal style={{ "--reveal-delay": "80ms" } as React.CSSProperties}>
            <Halftone className="-inset-16 text-ink/15" />
            <RejectArt />
          </div>
        </div>
      </Chapter>

      <StepEdge from="bg-ivory" to="fill-forest" flip />

      <Chapter id="open" tone="forest">
        <div className={cn(INNER, "grid items-center gap-14 py-24 md:py-32 lg:grid-cols-2 lg:gap-12")}>
          <ChapterText
            id="open"
            n="04"
            tone="forest"
            title="Break the seal to withdraw."
            muted="It can't be undone."
            body="Only the current holder can break the seal. It goes in the same NEAR transaction as their first withdrawal, then NEAR's MPC network signs a transaction the contract built itself."
            bullets={[
              [<Hand key="i" />, "Press and hold. Letting go early does nothing."],
              [<Repeat key="i" />, "Withdraw now or later, as often as you like."],
              [<Ban key="i" />, "An opened vault can never change hands again."],
            ]}
            cta={{ href: "/how#open", label: "How opening works" }}
          />
          <div className="relative flex justify-center" data-reveal style={{ "--reveal-delay": "80ms" } as React.CSSProperties}>
            <Guilloche className="left-1/2 top-1/2 size-[600px] -translate-x-1/2 -translate-y-1/2 text-mint/[0.1]" />
            <OpenDemo />
          </div>
        </div>
      </Chapter>

      <StepEdge from="bg-forest" to="fill-ink" />

      <Chapter id="verify" tone="ink">
        <div className={cn(INNER, "py-24 md:py-32")}>
          <div className="grid items-end gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <ChapterText
              id="verify"
              n="05"
              tone="ink"
              title="Check before you accept."
              muted="Anyone can. No wallet needed."
              body="Every vault has a public page that answers who can withdraw, what's inside and what you're trusting, with evidence you can check yourself."
              bullets={[
                [<ShieldCheck key="i" />, "Seal state and signatures ever requested, from the contract."],
                [<Fingerprint key="i" />, "Code hash matches a build anyone can reproduce."],
                [<Globe key="i" />, "Balances observed, each with its source and time."],
              ]}
              cta={{ href: "/verify", label: "Verify a vault" }}
            />
          </div>
          <div className="relative mt-14 grid items-start gap-5 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
            <Halftone className="-right-24 -top-24 size-[520px] text-gold/20" />
            <div data-reveal className="relative">
              <DemoSealPanel />
            </div>
            <div className="relative flex flex-col gap-5" style={{ "--reveal-delay": "100ms" } as React.CSSProperties}>
              <WhoCanWithdraw />
              <div data-reveal className="rounded-panel border border-line-strong bg-surface p-5 sm:p-6">
                <VerifyForm label="Check any vault" />
              </div>
            </div>
          </div>
        </div>
      </Chapter>

      <StepEdge from="bg-ink" to="fill-bg" flip />
    </div>
  );
}
