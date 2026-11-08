import { Check, Send } from "lucide-react";
import { Seal } from "@/components/brand/seal";
import { BearerCard } from "@/components/card/bearer-card";

/** Decorative hero composition: two vaults, a transfer toast and a seal summary. */
export function HeroArt() {
  return (
    <div aria-hidden className="relative h-[440px] min-w-0 sm:h-[520px]">
      <div className="absolute left-1/2 top-1/2 size-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(201_162_39/0.18),rgb(201_162_39/0.05)_55%,transparent)]" />

      <div className="absolute left-1/2 top-[14%] w-[min(372px,74%)] -translate-x-[58%] -rotate-[10deg] sm:-translate-x-[70%]">
        <div className="animate-float-slow motion-reduce:animate-none">
          <BearerCard name="OTC · Desk 7" id="17" finish="champagne" valueUsd={412} />
        </div>
      </div>

      <div className="absolute left-1/2 top-[30%] w-[min(400px,80%)] -translate-x-[36%] rotate-[4deg]">
        <div className="animate-float [animation-delay:-2s] motion-reduce:animate-none">
          <BearerCard name="Theo's birthday" id="42" finish="obsidian" valueUsd={58.4} />
        </div>
      </div>

      <div className="absolute -top-2 right-0 z-10 hidden items-center gap-3 rounded-[14px] border border-line-strong bg-surface-2/95 py-3 pl-3 pr-4 shadow-lifted backdrop-blur sm:flex">
        <span className="inline-flex size-9 items-center justify-center rounded-[10px] bg-raised text-accent">
          <Send className="size-4" />
        </span>
        <div>
          <div className="text-[13.5px] font-medium">Transferred to theo.testnet</div>
          <div className="mt-0.5 text-[12px] text-fg-3">Nothing moved on Bitcoin, Base or Solana.</div>
        </div>
      </div>

      <div className="absolute bottom-2 left-0 w-[272px] rounded-[16px] border border-line-strong bg-surface-2/95 p-4 shadow-lifted backdrop-blur">
        <div className="flex items-center gap-2.5">
          <Seal className="size-9" />
          <div>
            <div className="text-[14px] font-semibold">Unopened</div>
            <div className="text-[12px] text-fg-3">Vault No. 0042</div>
          </div>
        </div>
        <ul className="mt-3.5 flex flex-col gap-2 border-t border-line pt-3 text-[12.5px] text-fg-2">
          {["0 signatures ever requested", "Can change hands", "Contract locked"].map((t) => (
            <li key={t} className="flex items-center gap-2">
              <Check className="size-3.5 text-ok" strokeWidth={3} />
              {t}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
