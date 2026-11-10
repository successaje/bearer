import type { VaultView } from "@bearer/sdk";
import { Check, X } from "lucide-react";
import type { ReactNode } from "react";
import { isSealed } from "@/lib/vault/report";
import { cn } from "@/lib/utils";
import { shortAccount } from "@/lib/vault/format";

/**
 * Shown when someone scans a hand-over QR (`?handover=1`): the three things to check before
 * accepting a vault in person, answered from the chain, not from the person holding it.
 */
export function RecipientChecklist({ vault, viewer }: { vault: VaultView; viewer: string | null }) {
  const sealed = isSealed(vault);
  const zero = vault.signatures_requested === 0;
  const safe = sealed && zero;
  return (
    <section
      aria-labelledby="recipient-check"
      className={cn("mt-8 rounded-panel border p-5 sm:p-6", safe ? "border-ok/30 bg-ok/[0.05]" : "border-danger/35 bg-danger/[0.06]")}
    >
      <h2 id="recipient-check" className="text-[17px] font-semibold tracking-[-0.015em]">
        {safe ? "Someone is handing you this vault. Here's what to check." : "Don't accept this vault."}
      </h2>
      <ul className="mt-4 grid gap-3 md:grid-cols-3">
        <Item ok={sealed} title={sealed ? "It's sealed" : "It's been opened"}>
          {sealed
            ? "Nobody has broken the seal, so nobody can have a withdrawal signed for it."
            : "Opened vaults can't change hands. Any transfer will fail."}
        </Item>
        <Item ok={zero} title={`${vault.signatures_requested} signatures ever requested`}>
          {zero ? "There's no signed transaction anywhere that could empty it later." : "Signatures exist for this vault."}
        </Item>
        <Item ok title={`Held by ${shortAccount(vault.owner_id)}`}>
          Make sure that&apos;s the person in front of you. Once it&apos;s yours, this page says &ldquo;You hold this
          vault&rdquo;{viewer ? "" : " when you connect your wallet"}.
        </Item>
      </ul>
    </section>
  );
}

function Item({ ok, title, children }: { ok: boolean; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className={cn("mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full", ok ? "bg-ok/15 text-ok" : "bg-danger/15 text-danger")}
      >
        {ok ? <Check className="size-3.5" strokeWidth={3} /> : <X className="size-3.5" strokeWidth={3} />}
      </span>
      <div>
        <p className="text-[14.5px] font-semibold">{title}</p>
        <p className="mt-1 text-[13.5px] leading-relaxed text-fg-2">{children}</p>
      </div>
    </li>
  );
}
