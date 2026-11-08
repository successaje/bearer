import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Seal } from "@/components/brand/seal";
import { VerifyForm } from "@/components/landing/verify-form";
import { Eyebrow, SimulatedTag } from "@/components/ui/primitives";
import { IS_SIMULATED } from "@/lib/config";

export const metadata: Metadata = {
  title: "Verify a vault",
  description: "Check any Bearer vault: whether it's sealed, who can withdraw, what's inside and the evidence. No wallet needed.",
};

const EXAMPLES = [
  { id: "42", name: "Theo's birthday", verdict: "Sealed · 0 signatures", seal: "monogram" as const },
  { id: "17", name: "OTC · Desk 7", verdict: "Sealed · changed hands once", seal: "monogram" as const },
  { id: "29", name: "Savings jar", verdict: "Opened · can't change hands", seal: "opened" as const },
];

const CHECKS = [
  ["Seal", "Whether anyone has ever broken it. A sealed vault has never had a withdrawal signature requested, on any chain."],
  ["Signatures ever requested", "Always 0 while sealed. The contract can't ask for one until the owner breaks the seal."],
  ["Transfers possible", "Yes while sealed, never once opened. Every transfer path goes through one gate."],
  ["Contract locked", "No full-access keys and no upgrade method, so nobody can change the rules."],
  ["Code identity", "The deployed code hash matches the build anyone can reproduce."],
  ["Addresses", "Derived from this contract and the vault's paths. Derive them yourself to check."],
  ["Balances", "Observed from public sources, each with its source and time."],
] as const;

export default function VerifyPage() {
  return (
    <div className="mx-auto max-w-[1200px] px-5 pt-14 md:px-8 md:pt-20">
      <div className="grid gap-14 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-20">
        <div className="min-w-0">
          <Eyebrow>Verify</Eyebrow>
          <h1 className="text-balance mt-3 text-[clamp(36px,5vw,58px)] font-semibold leading-[1.02] tracking-[-0.045em]">
            Check any vault before you take it.
          </h1>
          <p className="text-pretty mt-5 max-w-[540px] text-[17px] leading-relaxed text-fg-2">
            Paste a vault number or link. You&apos;ll see whether it&apos;s sealed, who can withdraw, what&apos;s
            inside, and the evidence behind each answer. No wallet needed.
          </p>
          <VerifyForm className="mt-10 max-w-[560px]" size="lg" label="Vault number or link" />

          {IS_SIMULATED ? (
            <div className="mt-14 max-w-[560px]">
              <div className="flex items-center gap-2.5">
                <p className="text-[13.5px] font-medium text-fg-2">Try one</p>
                <SimulatedTag />
              </div>
              <ul className="mt-3 flex flex-col gap-2">
                {EXAMPLES.map((ex) => (
                  <li key={ex.id}>
                    <Link
                      href={`/v/${ex.id}`}
                      className="group flex items-center gap-3.5 rounded-[14px] border border-line bg-surface px-4 py-3 transition-colors hover:border-line-strong hover:bg-surface-2"
                    >
                      <Seal variant={ex.seal} className="size-9 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14.5px] font-medium">{ex.name}</span>
                        <span className="block text-[12.5px] text-fg-3">
                          No. {ex.id.padStart(4, "0")} · {ex.verdict}
                        </span>
                      </span>
                      <ArrowRight className="size-4 text-fg-3 transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <aside className="rounded-[20px] border border-line bg-surface p-6 sm:p-7">
          <h2 className="text-[17px] font-semibold tracking-[-0.015em]">What a vault page shows</h2>
          <ol className="mt-5 flex flex-col gap-5">
            {CHECKS.map(([title, body], i) => (
              <li key={title} className="flex gap-3.5">
                <span className="font-mono text-[12px] leading-[22px] text-fg-3">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <p className="text-[14.5px] font-medium">{title}</p>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-fg-2">{body}</p>
                </div>
              </li>
            ))}
          </ol>
          <Link href="/how#seal" className="mt-6 inline-flex items-center gap-1.5 text-[14px] font-medium text-accent hover:underline">
            How the seal works
            <ArrowRight className="size-4" />
          </Link>
        </aside>
      </div>
    </div>
  );
}
