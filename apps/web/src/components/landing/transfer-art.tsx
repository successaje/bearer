import { ArrowRight, Check } from "lucide-react";
import { BearerCard } from "@/components/card/bearer-card";
import { cn } from "@/lib/utils";

function Party({ letter, name, role, className }: { letter: string; name: string; role: string; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span className="inline-flex size-9 items-center justify-center rounded-full border border-line-strong bg-raised text-[13px] font-semibold text-fg-2">
        {letter}
      </span>
      <div className="min-w-0">
        <p className="font-mono text-[12.5px] text-fg">{name}</p>
        <p className="text-[11.5px] text-fg-3">{role}</p>
      </div>
    </div>
  );
}

/**
 * Chapter 2: the vault travels from sender to recipient and its back gains an endorsement.
 * Motion is CSS scroll-driven (globals.css `.transfer-*`), resting at the end elsewhere.
 */
export function TransferArt() {
  return (
    <div className="relative w-full max-w-[520px] rounded-[22px] border border-line bg-surface p-5 shadow-lifted sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <Party letter="A" name="alice.testnet" role="Sender" className="transfer-sender" />
        <ArrowRight aria-hidden className="size-4 text-fg-3" />
        <Party letter="B" name="bob.testnet" role="Recipient" className="flex-row-reverse text-right" />
      </div>

      <div className="mt-5 rounded-[14px] border border-dashed border-line-strong bg-surface-2 p-3">
        <div className="@container">
          <div className="transfer-card w-[52%]">
            <BearerCard name="Theo's birthday" id="42" finish="champagne" chains={[]} valueUsd={58.4} />
          </div>
        </div>
      </div>

      <div className="mt-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-3">Back of the vault · custody</p>
        <ol className="mt-2.5 flex flex-col gap-2">
          <li className="flex items-baseline justify-between gap-3 border-b border-dashed border-line-strong pb-2">
            <span className="text-[13px] text-fg-2">
              Pay to <span className="font-mono text-fg">alice.testnet</span>
            </span>
            <span className="text-[11.5px] text-fg-3">created the vault</span>
          </li>
          <li className="transfer-after flex items-baseline justify-between gap-3 border-b border-dashed border-line-strong pb-2">
            <span className="text-[13px] text-fg-2">
              Pay to <span className="font-mono text-fg">bob.testnet</span>
            </span>
            <span className="text-[11.5px] text-fg-3">transferred · still sealed</span>
          </li>
        </ol>
      </div>

      <div className="transfer-after mt-5 flex items-start gap-3 rounded-[12px] border border-ok/30 bg-ok/[0.07] px-3.5 py-3">
        <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-ok text-white">
          <Check className="size-3" strokeWidth={3} />
        </span>
        <p className="text-[13px] leading-snug text-fg">
          Transferred to bob.testnet.{" "}
          <span className="text-fg-2">Nothing moved on Bitcoin, Base or Solana.</span>
        </p>
      </div>
    </div>
  );
}
