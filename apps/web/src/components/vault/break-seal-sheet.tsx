"use client";

import type { ChainObservation, VaultView, Withdrawal, WithdrawRequest } from "@bearer/sdk";
import { ArrowLeft, Ban, Infinity as InfinityIcon, Inbox, Loader2, Network } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { errorCopy } from "@/lib/vault/errors";
import { useBreakSealAndWithdraw } from "@/lib/vault/hooks";
import { vaultNumber } from "@/lib/vault/format";
import { SealPress } from "./seal-press";
import { WithdrawForm } from "./withdraw-form";
import { WithdrawalTracker } from "./withdrawal-tracker";

type Step = "explain" | "withdraw" | "hold" | "tracking";

/** Brief 3.4 Flow E: consequences, the first withdrawal, press and hold, then live progress. */
export function BreakSealSheet({
  open,
  onOpenChange,
  vault,
  observations,
  signer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vault: VaultView;
  observations: ChainObservation[];
  signer: string;
}) {
  const [step, setStep] = useState<Step>("explain");
  const [request, setRequest] = useState<{ req: WithdrawRequest; summary: string } | null>(null);
  const [withdrawal, setWithdrawal] = useState<Withdrawal | null>(null);
  const mutate = useBreakSealAndWithdraw();

  function close(o: boolean) {
    onOpenChange(o);
    if (!o) {
      setStep("explain");
      setRequest(null);
      setWithdrawal(null);
    }
  }

  function breakIt() {
    if (!request) return;
    mutate.mutate(
      { id: vault.token_id, request: request.req, signer },
      {
        onSuccess: (w) => {
          setWithdrawal(w);
          setStep("tracking");
          toast.success("Seal broken", { description: "The withdrawal is on its way." });
        },
        onError: (e) => {
          toast.error(errorCopy(e));
          setStep("withdraw");
        },
      },
    );
  }

  const titles: Record<Step, string> = {
    explain: "Break the seal?",
    withdraw: "Your first withdrawal",
    hold: "Break the seal",
    tracking: "Seal broken",
  };

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent
        title={titles[step]}
        description={step === "explain" ? "This can't be undone." : step === "hold" ? `Vault ${vaultNumber(vault.token_id)}` : undefined}
      >
        {step === "explain" ? (
          <div className="flex flex-col gap-5">
            <ul className="flex flex-col gap-3.5">
              <Consequence icon={<Ban />} title="It can never be transferred again">
                After you break the seal, no transfer path will accept this vault. That&apos;s what keeps every future
                signature yours.
              </Consequence>
              <Consequence icon={<InfinityIcon />} title="Withdraw now or later, as often as you like">
                Each withdrawal is signed for you alone. Partial withdrawals and retries are fine.
              </Consequence>
              <Consequence icon={<Inbox />} title="Coins sent here afterwards stay yours">
                The addresses keep working. Anything that arrives is still yours to withdraw.
              </Consequence>
              <Consequence icon={<Network />} title="What you're trusting">
                NEAR&apos;s MPC network, the locked Bearer contract, and each chain&apos;s normal conditions.
              </Consequence>
            </ul>
            <Button variant="primary" size="lg" onClick={() => setStep("withdraw")}>
              Continue
            </Button>
            <Button variant="ghost" onClick={() => close(false)}>
              Keep it sealed
            </Button>
          </div>
        ) : null}

        {step === "withdraw" ? (
          <WithdrawForm
            observations={observations}
            submitLabel={(s) => (s ? `Continue with ${s}` : "Continue")}
            onSubmit={(req, summary) => {
              setRequest({ req, summary });
              setStep("hold");
            }}
          />
        ) : null}

        {step === "hold" && request ? (
          <div className="flex flex-col items-center gap-6 pt-2">
            <div className="w-full rounded-[14px] border border-line bg-bg px-4 py-3.5 text-[13.5px]">
              <p className="text-fg-3">One NEAR transaction</p>
              <p className="mt-1 font-medium">Break the seal, then withdraw {request.summary}.</p>
              <p className="mt-1 text-[12.5px] text-fg-3">Either both happen or neither does.</p>
            </div>
            {mutate.isPending ? (
              <div className="flex flex-col items-center gap-3 py-10 text-fg-2" aria-live="polite">
                <Loader2 className="size-6 animate-spin text-accent" />
                Confirm in your wallet…
              </div>
            ) : (
              <SealPress onBreak={breakIt} />
            )}
            <button
              type="button"
              onClick={() => setStep("withdraw")}
              className="inline-flex items-center gap-1.5 text-[13.5px] text-fg-2 hover:text-fg"
              disabled={mutate.isPending}
            >
              <ArrowLeft className="size-3.5" />
              Change the withdrawal
            </button>
          </div>
        ) : null}

        {step === "tracking" && withdrawal ? (
          <div className="flex flex-col gap-6">
            <WithdrawalTracker tokenId={vault.token_id} withdrawal={withdrawal} />
            <Button variant="primary" size="lg" onClick={() => close(false)}>
              Done
            </Button>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Consequence({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3.5">
      <span aria-hidden className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-control border border-line-strong bg-bg text-accent [&_svg]:size-4">
        {icon}
      </span>
      <span>
        <span className="block text-[14.5px] font-semibold">{title}</span>
        <span className="mt-0.5 block text-[13.5px] leading-relaxed text-fg-2">{children}</span>
      </span>
    </li>
  );
}
