import { ArrowRight, Check, Clock, HandCoins, Pause, Repeat } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/primitives";
import { IS_SIMULATED } from "@/lib/config";
import { cn } from "@/lib/utils";

/** A vault with a plan on it: the demo's weekly one, or the testnet vault that paid twice on Base Sepolia. */
const EXAMPLE_VAULT = IS_SIMULATED ? "38" : "37";

/** How a plan runs, period by period. An illustration: no amounts, no dates. */
const STEPS: { icon: typeof Check; label: string; detail: string; tone: string }[] = [
  {
    icon: Check,
    label: "Period 1",
    detail: "Collected by the payee. The seal broke with it.",
    tone: "bg-ok/15 text-ok",
  },
  { icon: Check, label: "Period 2", detail: "Collected: exact amount, exact address.", tone: "bg-ok/15 text-ok" },
  {
    icon: HandCoins,
    label: "Period 3",
    detail: "Due now. Only the payee can collect it.",
    tone: "bg-gold/15 text-accent",
  },
  { icon: Clock, label: "Period 4", detail: "Not yet. Asking early is refused.", tone: "bg-raised text-fg-2" },
];

/** The home page's case for a vault that does something on its own. */
export function StandingBand() {
  return (
    <section className="mx-auto max-w-[1200px] px-5 pt-24 md:px-8 md:pt-32">
      <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
        <div data-reveal className="min-w-0">
          <Eyebrow>Standing payments</Eyebrow>
          <h2 className="mt-3 max-w-[620px] text-[clamp(30px,3.3vw,42px)] leading-[1.1] font-semibold tracking-[-0.035em] text-balance">
            A vault that pays on its own. <span className="text-fg-3">Every week, from its own Bitcoin.</span>
          </h2>
          <p className="text-fg-2 mt-5 max-w-[560px] text-[17px] leading-relaxed text-pretty">
            Set a vault to pay someone a fixed amount every period: an allowance, a salary, rent, a subscription. The
            payee collects each payment as it falls due, and the contract asks NEAR&apos;s MPC network to sign exactly
            that amount to exactly that address. Nobody can send more, sooner, or anywhere else.
          </p>
          <ul className="text-fg-2 mt-7 flex max-w-[560px] flex-col gap-3 text-[15px] leading-relaxed">
            <li className="flex gap-3">
              <Repeat aria-hidden className="text-accent mt-1 size-4 shrink-0" />
              Bitcoin, ETH on Base or SOL, with a cap on each payment&apos;s network fee.
            </li>
            <li className="flex gap-3">
              <Pause aria-hidden className="text-accent mt-1 size-4 shrink-0" />
              Keep the right to stop it, or give it up: then nobody can, you included, until the last payment.
            </li>
            <li className="flex gap-3">
              <Check aria-hidden className="text-accent mt-1 size-4 shrink-0" />
              Running on testnet, against the same locked Bearer contract, with real payments on Base Sepolia.
            </li>
          </ul>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href={`/v/${EXAMPLE_VAULT}`} className={buttonVariants({ variant: "primary", size: "lg" })}>
              See a vault that pays
              <ArrowRight className="size-[18px]" />
            </Link>
            <Link href="/vaults" className={buttonVariants({ variant: "secondary", size: "lg" })}>
              Set one up
            </Link>
          </div>
        </div>

        <div data-reveal className="rounded-panel border-gold/35 bg-gold/[0.05] border p-6">
          <p className="text-accent font-mono text-[11.5px] font-medium tracking-[0.16em] uppercase">How a plan runs</p>
          <ol className="mt-5 flex flex-col">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              return (
                <li key={s.label} className={cn("flex items-start gap-3.5 py-3.5", i > 0 && "border-gold/20 border-t")}>
                  <span
                    aria-hidden
                    className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-full", s.tone)}
                  >
                    <Icon className="size-[15px]" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[14.5px] font-medium">{s.label}</p>
                    <p className="text-fg-3 mt-0.5 text-[13.5px] leading-relaxed">{s.detail}</p>
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="border-gold/20 text-fg-3 mt-3 border-t pt-4 text-[13px] leading-relaxed">
            Paying from a vault breaks its seal, so a vault that pays stays with the standing-payments contract for
            good. Its giver acts through the contract: stop the payments, or withdraw what&apos;s left.
          </p>
        </div>
      </div>
    </section>
  );
}
