import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Seal } from "@/components/brand/seal";
import { ThemeSwitch } from "@/components/theme/theme-controls";
import { BEARER_CONTRACT, REPO_URL, SIGNER_CONTRACT, explorer } from "@/lib/config";

type FooterLink = { label: string; href: string; external?: boolean };

const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Create a vault", href: "/create" },
      { label: "My vaults", href: "/vaults" },
      { label: "Market", href: "/market" },
      { label: "Lend", href: "/lend" },
      { label: "Verify a vault", href: "/verify" },
      { label: "How it works", href: "/how" },
      { label: "Proof", href: "/proof" },
    ],
  },
  {
    title: "Learn",
    links: [
      { label: "The seal", href: "/how#seal" },
      { label: "Breaking the seal", href: "/how#open" },
      { label: "What you're trusting", href: "/how#trust" },
      { label: "FAQ", href: "/how#faq" },
    ],
  },
  {
    title: "Build",
    links: [
      ...(REPO_URL
        ? [
            { label: "GitHub", href: REPO_URL, external: true },
            { label: "Threat model", href: `${REPO_URL}/blob/main/docs/THREAT_MODEL.md`, external: true },
          ]
        : [{ label: "Threat model", href: "/how#trust" }]),
      { label: "Derive it yourself", href: "/derive" },
      { label: "Bearer contract", href: explorer.nearAccount(BEARER_CONTRACT), external: true },
      { label: "MPC signer", href: explorer.nearAccount(SIGNER_CONTRACT), external: true },
    ],
  },
];

const NETWORKS = ["NEAR testnet", "Bitcoin testnet4", "Base Sepolia", "Solana devnet"];

/** Tear-off edge: scalloped top and a perforation line, like a bearer bond's coupon. */
function Perforation() {
  return (
    <div aria-hidden>
      <div
        className="h-3 bg-gold"
        style={{
          WebkitMask: "radial-gradient(circle at 9px 0, transparent 6px, #000 6.5px) 0 0 / 18px 100% repeat-x",
          mask: "radial-gradient(circle at 9px 0, transparent 6px, #000 6.5px) 0 0 / 18px 100% repeat-x",
        }}
      />
      <div className="bg-gold py-3">
        <div
          className="h-1.5"
          style={{
            backgroundImage: "radial-gradient(circle, var(--bg) 2.6px, transparent 3px)",
            backgroundSize: "14px 6px",
            backgroundRepeat: "repeat-x",
            backgroundPosition: "center",
          }}
        />
      </div>
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-24 md:mt-32 print:hidden">
      <Perforation />
      <div className="overflow-hidden bg-gold text-ink">
        <div className="mx-auto max-w-[1200px] px-5 pt-12 md:px-8 md:pt-16">
          <div className="grid grid-cols-2 gap-x-6 gap-y-11 sm:gap-x-8 lg:grid-cols-[1.5fr_1fr_1fr_1fr_1fr]">
            <div className="col-span-2 max-w-sm lg:col-span-1">
              <p className="text-[26px] font-semibold leading-tight tracking-[-0.03em]">Sealed until opened.</p>
              <p className="mt-3 text-[15px] leading-relaxed text-ink/75">
                A sealed vault of native Bitcoin, Base and Solana you can hand to anyone. Whoever holds it can
                break the seal. Nobody before them can.
              </p>
              <Link
                href="/create"
                className="mt-6 inline-flex h-11 items-center gap-2 rounded-control bg-ink px-4 text-[15px] font-semibold text-gold transition-opacity hover:opacity-90"
              >
                Create a vault
                <ArrowUpRight className="size-4" />
              </Link>
            </div>

            {COLUMNS.map((col) => (
              <nav key={col.title} aria-label={col.title}>
                <p className="font-mono text-[11.5px] font-medium uppercase tracking-[0.16em] text-ink/60">
                  {col.title}
                </p>
                <ul className="mt-4 flex flex-col gap-2.5">
                  {col.links.map((link) => (
                    <li key={link.label}>
                      {link.external ? (
                        <a
                          href={link.href}
                          target="_blank"
                          rel="noreferrer"
                          className="group inline-flex items-center gap-1 text-[15px] text-ink transition-opacity hover:opacity-70"
                        >
                          {link.label}
                          <ArrowUpRight className="size-3.5 opacity-50 transition-opacity group-hover:opacity-100" />
                        </a>
                      ) : (
                        <Link href={link.href} className="text-[15px] text-ink transition-opacity hover:opacity-70">
                          {link.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </nav>
            ))}

            <div>
              <p className="font-mono text-[11.5px] font-medium uppercase tracking-[0.16em] text-ink/60">Networks</p>
              <ul className="mt-4 flex flex-col gap-2.5">
                {NETWORKS.map((n) => (
                  <li key={n} className="flex items-center gap-2 text-[15px]">
                    <span aria-hidden className="size-1.5 rounded-full bg-ink/70" />
                    {n}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t border-ink/15 pt-6">
            <p className="max-w-xl font-mono text-[11.5px] uppercase leading-relaxed tracking-[0.12em] text-ink/70">
              © 2026 Bearer · Testnet prototype built for the NEAR Hackathon (Nov 2026) · Not financial advice
            </p>
            <ThemeSwitch />
          </div>

          <div className="@container mt-10 select-none" aria-hidden>
            <div className="flex translate-y-[9%] items-end gap-[2.4cqw]">
              <Seal tone="dark" className="mb-[1.6cqw] size-[19cqw] shrink-0" />
              <span className="text-[26cqw] font-semibold leading-[0.74] tracking-[-0.065em]">Bearer</span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
