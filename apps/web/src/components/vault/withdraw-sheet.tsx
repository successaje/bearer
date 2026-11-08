"use client";

import type { ChainObservation, VaultView, Withdrawal } from "@bearer/sdk";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { errorCopy } from "@/lib/vault/errors";
import { useWithdraw } from "@/lib/vault/hooks";
import { WithdrawForm } from "./withdraw-form";
import { WithdrawalTracker } from "./withdrawal-tracker";

export function WithdrawSheet({
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
  const [withdrawal, setWithdrawal] = useState<Withdrawal | null>(null);
  const withdraw = useWithdraw();

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setWithdrawal(null);
      }}
    >
      <SheetContent
        title={withdrawal ? "Withdrawing" : "Withdraw"}
        description={withdrawal ? undefined : "The contract builds the transaction; NEAR's MPC network signs it for you alone."}
      >
        {withdrawal ? (
          <div className="flex flex-col gap-6">
            <WithdrawalTracker tokenId={vault.token_id} withdrawal={withdrawal} />
            <Button variant="primary" size="lg" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </div>
        ) : (
          <WithdrawForm
            observations={observations}
            busy={withdraw.isPending}
            submitLabel={(s) =>
              withdraw.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Confirm in your wallet…
                </>
              ) : (
                <>
                  <ArrowUpRight className="size-4" />
                  {s ? `Withdraw ${s}` : "Withdraw"}
                </>
              )
            }
            onSubmit={(request) =>
              withdraw.mutate(
                { id: vault.token_id, request, signer },
                { onSuccess: setWithdrawal, onError: (e) => toast.error(errorCopy(e)) },
              )
            }
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
