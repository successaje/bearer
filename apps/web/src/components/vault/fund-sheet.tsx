"use client";

import type { ChainObservation, ChainTag } from "@bearer/sdk";
import { ArrowDownLeft, Info, Loader2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ChainIcon } from "@/components/brand/chain-icon";
import { QrCodeBlock } from "@/components/card/qr-dialog";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Callout, SimulatedTag, Skeleton } from "@/components/ui/primitives";
import { SegmentedList, SegmentedRoot, SegmentedTrigger } from "@/components/ui/segmented";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { IS_SIMULATED } from "@/lib/config";
import { useSimulateDeposit } from "@/lib/vault/hooks";
import { CHAIN_META, chunkAddress } from "@/lib/vault/format";

export function FundSheet({
  open,
  onOpenChange,
  tokenId,
  observations,
  opened,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tokenId: string;
  observations: ChainObservation[] | undefined;
  opened: boolean;
}) {
  const [chain, setChain] = useState<ChainTag>("btc");
  const deposit = useSimulateDeposit();
  const obs = observations?.find((o) => o.chain === chain);
  const meta = CHAIN_META[chain];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title="Deposit" description="Send native coins to the vault's address from any wallet. Deposits show up on their own.">
        <div className="flex flex-col gap-5">
          {opened ? (
            <Callout tone="warn" icon={<TriangleAlert />}>
              This vault is opened. Coins you send here stay yours to withdraw, but the vault can&apos;t be handed on.
            </Callout>
          ) : null}

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

          {obs ? (
            <div className="flex flex-col items-center gap-4">
              <QrCodeBlock value={obs.address} label={`QR code for ${meta.name} ${meta.network} address ${obs.address}`} size={176} />
              <div className="flex w-full items-center gap-2 rounded-control border border-line bg-bg py-1 pl-3 pr-1">
                <span className="min-w-0 flex-1 break-all font-mono text-[12.5px] leading-relaxed">{chunkAddress(obs.address)}</span>
                <CopyButton value={obs.address} label={`Copy ${meta.name} address`} size="sm" />
              </div>
            </div>
          ) : (
            <Skeleton className="mx-auto size-[204px] rounded-[14px]" />
          )}

          <Callout tone={chain === "evm" ? "info" : "neutral"} icon={<Info />}>
            {chain === "evm" ? (
              <>
                <strong className="font-semibold">Send only ETH on Base Sepolia.</strong> Funds sent on other networks can&apos;t
                be withdrawn by this version.
              </>
            ) : (
              <>Send only {meta.unit} on {meta.name} {meta.network}. Mainnet coins sent here are lost to this vault.</>
            )}{" "}
            <strong className="font-semibold">Native coins only:</strong>{" "}
            {chain === "btc"
              ? "this version can't move tokens, NFTs or inscriptions, and a withdrawal could spend the coin an inscription sits on."
              : "tokens and NFTs sent here can never be withdrawn by this version."}
          </Callout>

          {IS_SIMULATED ? (
            <div className="rounded-[14px] border border-dashed border-line-strong p-4">
              <div className="flex items-center justify-between">
                <p className="text-[13.5px] font-medium">Demo deposit</p>
                <SimulatedTag />
              </div>
              <p className="mt-1 text-[13px] leading-relaxed text-fg-3">
                Faucets aren&apos;t wired up in this demo. Add simulated {meta.unit}; it shows as pending, then confirms.
              </p>
              <Button
                size="sm"
                className="mt-3"
                disabled={deposit.isPending}
                onClick={() =>
                  deposit.mutate(
                    { id: tokenId, chain },
                    { onSuccess: () => toast.success(`Simulated ${meta.unit} deposit seen`, { description: "It confirms in about 15 seconds." }), onError: (e) => toast.error(e.message) },
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
