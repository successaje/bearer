"use client";

import { ArrowDownLeft, Info, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ChainIcon } from "@/components/brand/chain-icon";
import { QrCodeBlock } from "@/components/card/qr-dialog";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Callout, SimulatedTag } from "@/components/ui/primitives";
import { SegmentedList, SegmentedRoot, SegmentedTrigger } from "@/components/ui/segmented";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useSimulateDeposit } from "@/lib/bearer/hooks";
import type { Card, ChainTag } from "@/lib/bearer/types";
import { IS_SIMULATED } from "@/lib/config";
import { CHAIN_META, chunkAddress } from "@/lib/format";

export function FundSheet({
  open,
  onOpenChange,
  card,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  card: Card;
}) {
  const [chain, setChain] = useState<ChainTag>("btc");
  const deposit = useSimulateDeposit();
  const meta = CHAIN_META[chain];
  const address = card.slots[chain].address;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title="Add funds" description="Send native coins to the card's address from any wallet. Deposits show up on their own.">
        <div className="flex flex-col gap-5">
          <SegmentedRoot value={chain} onValueChange={(v) => setChain(v as ChainTag)}>
            <SegmentedList aria-label="Chain" className="grid grid-cols-3">
              {(["btc", "evm", "sol"] as const).map((c) => (
                <SegmentedTrigger key={c} value={c}>
                  <ChainIcon chain={c} className="size-[18px]" />
                  {CHAIN_META[c].name}
                </SegmentedTrigger>
              ))}
            </SegmentedList>
          </SegmentedRoot>

          <div className="flex flex-col items-center gap-4">
            <QrCodeBlock value={address} label={`QR code for ${meta.name} ${meta.network} address ${address}`} size={176} />
            <div className="flex w-full items-center gap-2 rounded-control border border-line bg-bg py-1 pl-3 pr-1">
              <span className="min-w-0 flex-1 break-all font-mono text-[12.5px] leading-relaxed">{chunkAddress(address)}</span>
              <CopyButton value={address} label={`Copy ${meta.name} address`} size="sm" />
            </div>
          </div>

          {chain === "evm" ? (
            <Callout tone="info" icon={<Info />}>
              <strong className="font-semibold">Send only on Base Sepolia.</strong> Funds sent to this address on other
              networks can&apos;t be opened by this version.
            </Callout>
          ) : (
            <Callout tone="neutral" icon={<Info />}>
              Send only {meta.unit} on {meta.name} {meta.network}. Mainnet coins sent here are lost to this card.
            </Callout>
          )}

          {IS_SIMULATED ? (
            <div className="rounded-[14px] border border-dashed border-line-strong p-4">
              <div className="flex items-center justify-between">
                <p className="text-[13.5px] font-medium">Demo deposit</p>
                <SimulatedTag />
              </div>
              <p className="mt-1 text-[13px] leading-relaxed text-fg-3">
                Testnet faucets aren&apos;t wired up in this demo. Add simulated {meta.unit} to try the rest of the flow.
              </p>
              <Button
                size="sm"
                className="mt-3"
                disabled={deposit.isPending}
                onClick={() =>
                  deposit.mutate(
                    { id: card.id, chain },
                    {
                      onSuccess: () => toast.success(`Simulated ${meta.unit} deposit confirmed`),
                      onError: (e) => toast.error(e.message),
                    },
                  )
                }
              >
                {deposit.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowDownLeft className="size-3.5" />}
                Simulate a deposit
              </Button>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
