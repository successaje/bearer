import { ArrowDown, ArrowRight, Check, ChevronDown, FileLock2, Globe, Network, RotateCw, ShieldAlert, Wallet, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ChainIcon } from "@/components/brand/chain-icon";
import { Seal } from "@/components/brand/seal";
import { SectionIndex } from "@/components/how/section-index";
import { buttonVariants } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/primitives";
import { BEARER_CONTRACT, SIGNER_CONTRACT } from "@/lib/config";
import { CHAIN_META } from "@/lib/vault/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "How it works",
  description: "The one rule behind a Bearer vault, how the seal works, why retries are safe, and exactly what you're trusting.",
};

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "seal", label: "The one rule" },
  { id: "transfer", label: "Handing it over" },
  { id: "open", label: "Breaking the seal" },
  { id: "retries", label: "Why retries are safe" },
  { id: "trust", label: "What you're trusting" },
  { id: "limits", label: "Limitations" },
  { id: "faq", label: "FAQ" },
];

const RULE_ROWS: [string, ReactNode, ReactNode][] = [
  ["Can receive deposits", <Yes key="y">Yes</Yes>, <Yes key="y">Yes, still withdrawable by the owner</Yes>],
  ["Can change hands (any path)", <Yes key="y">Yes</Yes>, <No key="n">Never</No>],
  ["Can request a withdrawal signature", <No key="n">Never</No>, <Yes key="y">Yes, by the owner, any number of times</Yes>],
  ["Signatures ever requested", <span key="z" className="tabular font-semibold text-fg">Always 0</span>, "0 or more"],
  ["How it gets here", <code key="c">create_vault</code>, <span key="b"><code>break_seal</code> by the owner</span>],
];

const FAQ: [string, ReactNode][] = [
  [
    "Is this real money?",
    "No. Bearer is a testnet prototype: NEAR testnet, Bitcoin testnet4, Base Sepolia and Solana devnet. Testnet coins have no value. Dollar figures are estimates, labelled est.",
  ],
  [
    "What stops the old owner from keeping a signed withdrawal?",
    "There's nothing to keep. A sealed vault can't request a signature at all, and a vault can only change hands while sealed. So when you receive one, no withdrawal signature has ever existed for it, on any chain.",
  ],
  [
    "Can I seal a vault again after opening it?",
    "No. Breaking the seal is one-way. An opened vault keeps working for its owner, who can withdraw from it as many times as they like, but it can never be handed on.",
  ],
  [
    "Can the Bearer team move my coins?",
    "No. The contract is locked: it has no full-access keys and no upgrade or admin methods, so nobody can change its rules or ask it to sign anything outside its typed withdrawal methods.",
  ],
  [
    "Does Bearer handle payment if I sell a vault?",
    "No. Bearer guarantees that what you receive is sealed and yours. It doesn't escrow payments between people, so agree on payment the way you would for anything else handed over in person.",
  ],
  [
    "Why only Base Sepolia for ETH?",
    "The vault's 0x address exists on every EVM network, but this version only signs withdrawals on Base Sepolia. Funds sent on other networks can't be withdrawn by this version.",
  ],
  [
    "What if I lose the account that holds a vault?",
    "Then the vault is lost, like cash. Bearer can't recover vaults for anyone.",
  ],
];

export default function HowPage() {
  return (
    <div className="mx-auto max-w-[1200px] px-5 pt-14 md:px-8 md:pt-20">
      <div className="max-w-[780px]">
        <Eyebrow>How it works</Eyebrow>
        <h1 className="text-balance mt-3 text-[clamp(36px,5vw,58px)] font-semibold leading-[1.02] tracking-[-0.045em]">
          A sealed vault you can hand to anyone.
        </h1>
        <p className="text-pretty mt-5 text-[17px] leading-relaxed text-fg-2">
          On every chain, coins are bound to keys, so changing who owns them means moving them. On NEAR, a contract can
          control native addresses on other chains. Bearer turns that into a vault you can hand over in one NEAR
          transaction, with a seal that stops anyone before you from keeping a way back in.
        </p>
      </div>

      <div className="mt-16 grid gap-12 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-16">
        <aside>
          <SectionIndex sections={SECTIONS} />
        </aside>

        <div className="flex min-w-0 flex-col gap-24">
          <Section id="overview" eyebrow="01 · Overview" title="A vault is an NFT that controls three addresses.">
            <p>
              Each vault is a token on NEAR. The Bearer contract derives a Bitcoin, a Base and a Solana address for it
              through NEAR Chain Signatures. Only the contract can ask NEAR&apos;s MPC network to sign for those
              addresses, and it only does so for the vault&apos;s current owner.
            </p>
            <Diagram />
          </Section>

          <Section id="seal" eyebrow="02 · The one rule" title="It can change hands only while it's sealed.">
            <blockquote className="rounded-panel border border-gold/35 bg-gold/[0.07] px-5 py-4 text-[17px] font-medium leading-relaxed text-fg">
              A vault can change hands only while it is sealed. Breaking the seal is the only way to get a signature,
              and it can never be undone.
            </blockquote>
            <p className="mt-6">
              The risk with handing over a wallet is a signed transaction kept in a drawer: a previous owner could
              broadcast it later and empty it. Bearer removes the drawer. While a vault is sealed, the contract
              can&apos;t request a signature for it. Once its owner breaks the seal, no transfer path will accept it.
            </p>
            <RuleTable />
            <Lifecycle />
          </Section>

          <Section id="transfer" eyebrow="03 · Handing it over" title="One NEAR transaction. Nothing moves on the other chains.">
            <p>
              Send a sealed vault to any NEAR account. The contract checks the seal and changes the owner in one
              transaction. The coins stay exactly where they are, at the same addresses.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <Card title="Changing hands">Control of the three addresses and everything at them, and the right to break the seal.</Card>
              <Card title="Not changing">No coins move. The addresses and the public history stay the same.</Card>
              <Card title="After this, you can't">Break the seal, withdraw, or take it back.</Card>
            </div>
            <ul className="mt-6 flex flex-col gap-3">
              <Bullet>Every transfer path goes through one gate in the contract, and that gate refuses opened vaults.</Bullet>
              <Bullet>The custody log on the back of the vault gains a line with the new holder and the date.</Bullet>
              <Bullet>The former owner sees that they no longer hold it, and the contract rejects anything they try.</Bullet>
            </ul>
          </Section>

          <Section id="open" eyebrow="04 · Breaking the seal" title="Open it to withdraw. After that, it stays yours.">
            <p>
              To take coins out, the owner breaks the seal. The app sends it in the same NEAR transaction as the first
              withdrawal, so if the withdrawal is invalid, the seal stays intact. NEAR&apos;s MPC network then signs a
              transaction the contract built itself, paying the address the owner chose.
            </p>
            <ul className="mt-6 flex flex-col gap-3">
              <Bullet>This can&apos;t be undone. An opened vault can never be transferred again.</Bullet>
              <Bullet>You can withdraw what&apos;s inside now or later, as many times as you like.</Bullet>
              <Bullet>Coins sent to an opened vault stay withdrawable by its owner.</Bullet>
            </ul>
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              <Verdict seal="monogram" title="Sealed">Unopened. No signature has ever been requested for this vault.</Verdict>
              <Verdict seal="opened" title="Opened">Its owner broke the seal. It can&apos;t change hands.</Verdict>
              <Verdict seal="check" title="Signed and sent">Each withdrawal shows its status and explorer link until confirmed.</Verdict>
            </div>
          </Section>

          <Section id="retries" eyebrow="05 · Why retries are safe" title="Every signature pays the same owner.">
            <p>
              Once a vault is opened, its owner is fixed forever. Every signature the contract requests for it is for a
              withdrawal that owner asked for, paying where they chose. That makes the awkward cases simple.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <Card icon={<RotateCw />} title="A request times out">
                Try again. If both signatures turn up, they spend the same coins or the same nonce, so the chain accepts
                at most one.
              </Card>
              <Card icon={<ArrowRight />} title="Fees need a bump">
                That&apos;s just another withdrawal at a higher fee, from the same owner.
              </Card>
              <Card icon={<Check />} title="Partial withdrawals">
                Fine. A vault that can never move has no &ldquo;what&apos;s left inside&rdquo; question to answer.
              </Card>
            </div>
          </Section>

          <Section id="trust" eyebrow="06 · What you're trusting" title="No bridge, no custodian key. Here's what's left.">
            <div className="grid gap-3 sm:grid-cols-2">
              <TrustItem icon={<Network />} title="NEAR's MPC network">
                A threshold of independent operators must agree to sign. Bearer uses{" "}
                <code className="font-mono text-[13px]">{SIGNER_CONTRACT}</code>.
              </TrustItem>
              <TrustItem icon={<FileLock2 />} title="The Bearer contract">
                Open source and locked at <code className="font-mono text-[13px]">{BEARER_CONTRACT}</code>. Its code hash
                matches a reproducible build.
              </TrustItem>
              <TrustItem icon={<ShieldAlert />} title="Each chain's own rules">
                A withdrawal confirms when Bitcoin, Base or Solana accepts it, with that chain&apos;s fees and finality.
              </TrustItem>
              <TrustItem icon={<Globe />} title="Display data">
                Balances come from public explorers and RPCs, each named with the time it was checked. The contract
                never relies on them.
              </TrustItem>
            </div>
          </Section>

          <Section id="limits" eyebrow="07 · Limitations" title="What this version doesn't do.">
            <ul className="flex flex-col gap-3">
              <Bullet>Once opened, a vault is spent as a hand-over: it can&apos;t be sealed again or transferred.</Bullet>
              <Bullet>Bearer doesn&apos;t escrow payments between people. It guarantees what you receive, not that someone pays you.</Bullet>
              <Bullet>Native coins only: BTC, ETH on Base Sepolia and SOL. No tokens, no other EVM networks.</Bullet>
              <Bullet>Balances are observed data and can lag an explorer by a few seconds.</Bullet>
            </ul>
            <div className="mt-6 rounded-panel border border-warn/30 bg-warn/[0.06] p-5 text-[14.5px] leading-relaxed text-fg-2">
              <strong className="font-semibold text-fg">This is a testnet prototype.</strong> It hasn&apos;t been
              audited. Don&apos;t use it with real funds.
            </div>
          </Section>

          <Section id="faq" eyebrow="08 · FAQ" title="Questions people ask.">
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
                Create a vault
              </Link>
              <Link href="/verify" className={buttonVariants({ size: "lg" })}>
                Verify a vault
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
      <div className="mt-5 max-w-[760px] text-[16px] leading-relaxed text-fg-2 [&>p+p]:mt-4">{children}</div>
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

function Yes({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-start gap-1.5 text-fg">
      <Check aria-hidden className="mt-[3px] size-3.5 shrink-0 text-ok" strokeWidth={2.5} />
      {children}
    </span>
  );
}

function No({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-start gap-1.5 text-fg">
      <X aria-hidden className="mt-[3px] size-3.5 shrink-0 text-danger" strokeWidth={2.5} />
      {children}
    </span>
  );
}

function RuleTable() {
  return (
    <div className="mt-8 overflow-hidden rounded-panel border border-line bg-surface">
      <table className="w-full border-collapse text-left text-[14px] [&_code]:font-mono [&_code]:text-[12.5px]">
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="w-[38%] px-4 py-3 font-medium text-fg-3 sm:px-5">
              <span className="sr-only">Property</span>
            </th>
            <th scope="col" className="px-4 py-3 sm:px-5">
              <span className="inline-flex items-center gap-2 font-semibold text-fg">
                <Seal className="size-6" /> Sealed
              </span>
            </th>
            <th scope="col" className="px-4 py-3 sm:px-5">
              <span className="inline-flex items-center gap-2 font-semibold text-fg">
                <Seal variant="opened" className="size-6" /> Opened
              </span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {RULE_ROWS.map(([label, sealed, opened]) => (
            <tr key={label} className="align-top">
              <th scope="row" className="px-4 py-3.5 font-normal text-fg-2 sm:px-5">
                {label}
              </th>
              <td className="px-4 py-3.5 sm:px-5">{sealed}</td>
              <td className="px-4 py-3.5 text-fg-2 sm:px-5">{opened}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The vault lifecycle from brief 4.3, drawn with the product's own seals. */
function Lifecycle() {
  return (
    <figure className="mt-8 rounded-[20px] border border-line bg-surface p-5 sm:p-7">
      <div className="grid items-stretch gap-3 md:grid-cols-[0.85fr_auto_1.15fr_auto_1.15fr]">
        <Stage label="Start" title="create_vault" note="Three addresses, derived by the contract" />
        <Arrow label="mint" />
        <Stage
          label="Sealed"
          title="Can change hands"
          note="0 signatures ever requested"
          seal="monogram"
          loop="Transfer: new owner, still sealed"
          tone="ok"
        />
        <Arrow label="break_seal" strong />
        <Stage
          label="Opened"
          title="Withdrawals only"
          note="Owner fixed forever"
          seal="opened"
          loop="Withdraw, as often as you like"
          tone="gold"
        />
      </div>
      <figcaption className="mt-6 text-center text-[13px] text-fg-3">
        No arrow leaves Opened. No arrow returns to Sealed.
      </figcaption>
    </figure>
  );
}

function Stage({
  label,
  title,
  note,
  seal,
  loop,
  tone,
}: {
  label: string;
  title: string;
  note: string;
  seal?: "monogram" | "opened";
  loop?: string;
  tone?: "ok" | "gold";
}) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-[14px] border bg-surface-2 p-4",
        tone === "ok" && "border-ok/30",
        tone === "gold" && "border-gold/40",
        !tone && "border-line-strong",
      )}
    >
      <div className="flex items-center gap-3">
        {seal ? (
          <Seal variant={seal} className="size-10 shrink-0" />
        ) : (
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-dashed border-line-strong text-fg-3">
            <Wallet className="size-4" />
          </span>
        )}
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-3">{label}</p>
          <p className={cn("text-[15px] font-semibold text-fg", !seal && "font-mono text-[13.5px]")}>{title}</p>
        </div>
      </div>
      <p className="mb-3 mt-3 text-[13px] leading-snug text-fg-2">{note}</p>
      {loop ? (
        <p className="mt-auto flex items-start gap-1.5 rounded-[10px] border border-line-strong px-2.5 py-1.5 text-[12px] leading-snug text-fg-2">
          <RotateCw aria-hidden className="mt-[2px] size-3 shrink-0 text-fg-3" />
          {loop}
        </p>
      ) : null}
    </div>
  );
}

function Arrow({ label, strong }: { label: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-center gap-2 py-1 md:flex-col md:py-0">
      <span className={cn("font-mono text-[11px] uppercase tracking-[0.12em]", strong ? "text-accent" : "text-fg-3")}>{label}</span>
      <ArrowRight aria-hidden className={cn("hidden size-4 md:block", strong ? "text-accent" : "text-fg-3")} />
      <ArrowDown aria-hidden className={cn("size-4 md:hidden", strong ? "text-accent" : "text-fg-3")} />
      {strong ? <span className="font-mono text-[10.5px] text-fg-3 md:text-center">one-way</span> : null}
    </div>
  );
}

function Card({ icon, title, children }: { icon?: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="rounded-panel border border-line bg-surface p-5">
      {icon ? (
        <span className="mb-3 inline-flex size-8 items-center justify-center rounded-control border border-line-strong bg-surface-2 text-accent [&_svg]:size-4">
          {icon}
        </span>
      ) : null}
      <h3 className="text-[15px] font-semibold text-fg">{title}</h3>
      <p className="mt-1.5 text-[14px] leading-relaxed text-fg-2">{children}</p>
    </div>
  );
}

function Verdict({ seal, title, children }: { seal: "monogram" | "opened" | "check"; title: string; children: ReactNode }) {
  return (
    <div className="rounded-panel border border-line bg-surface p-5">
      <Seal variant={seal} className="size-11" />
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
        <Node icon={<Wallet />} title="You" sub="the vault's owner, on NEAR" />
        <Connector label="transfer · break the seal · withdraw" />
        <Node icon={<FileLock2 />} title="Bearer contract" sub={BEARER_CONTRACT} />
        <Connector label="sign request, transaction built on-chain" />
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
        The contract builds every transaction itself, so nobody can ask it to sign arbitrary bytes.
      </figcaption>
    </figure>
  );
}
