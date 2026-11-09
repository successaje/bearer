"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/primitives";
import { AttackLab } from "@/components/vault/attack-lab";
import { IS_SIMULATED } from "@/lib/config";
import { useVault } from "@/lib/vault/hooks";

/** Vault 17 changed hands once, so the lab has a real former owner to play. */
const DEMO_VAULT = "17";

export function AttackPreview() {
  return (
    <section id="attack-lab" aria-labelledby="attack-title" className="mx-auto max-w-[1200px] scroll-mt-24 px-5 pt-24 md:px-8 md:pt-32">
      <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
        <div data-reveal className="lg:sticky lg:top-28">
          <p className="font-mono text-[11.5px] font-medium uppercase tracking-[0.16em] text-accent">Attack lab</p>
          <h2
            id="attack-title"
            className="text-balance mt-3 text-[clamp(32px,3.6vw,46px)] font-semibold leading-[1.06] tracking-[-0.035em]"
          >
            Try to cheat. <span className="text-fg-3">The contract refuses.</span>
          </h2>
          {IS_SIMULATED ? (
            <>
              <p className="text-pretty mt-5 max-w-[460px] text-[16px] leading-relaxed text-fg-2">
                Play the former owner of vault No. 0017, or anyone else. Each attack from the threat model runs against
                the same rules as the sandbox tests, and the log names the test that proves it.
              </p>
              <Link
                href={`/v/${DEMO_VAULT}#attack-lab`}
                className="mt-7 inline-flex items-center gap-2 text-[15px] font-medium text-accent hover:underline"
              >
                Open vault No. 0017
                <ArrowRight className="size-4" />
              </Link>
            </>
          ) : (
            <>
              <p className="text-pretty mt-5 max-w-[460px] text-[16px] leading-relaxed text-fg-2">
                A former owner withdrawing, an opened vault changing hands, a withdrawal from a sealed vault, a raw
                signature request: each was sent to the locked contract as a real transaction, and each was refused.
                Check them yourself; your browser reads the answers from NEAR.
              </p>
              <Link
                href="/proof#threats"
                className="mt-7 inline-flex items-center gap-2 text-[15px] font-medium text-accent hover:underline"
              >
                See every attack and its test
                <ArrowRight className="size-4" />
              </Link>
            </>
          )}
        </div>
        <div data-reveal style={{ "--reveal-delay": "80ms" } as React.CSSProperties}>
          {IS_SIMULATED ? <LiveLab /> : <AttackLab />}
        </div>
      </div>
    </section>
  );
}

function LiveLab() {
  const vault = useVault(DEMO_VAULT);
  if (!vault.data) return <Skeleton className="h-[460px] rounded-panel" />;
  return <AttackLab vault={vault.data} />;
}
