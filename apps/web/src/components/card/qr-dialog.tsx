"use client";

import { Dialog } from "radix-ui";
import { QrCode, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { CopyButton } from "@/components/ui/copy-button";
import type { ChainTag } from "@bearer/sdk";
import { CHAIN_META, chunkAddress } from "@/lib/vault/format";

export function QrCodeBlock({ value, label, size = 196 }: { value: string; label: string; size?: number }) {
  return (
    <div className="inline-flex rounded-[14px] bg-white p-3.5">
      <QRCodeSVG value={value} size={size} level="M" marginSize={0} role="img" aria-label={label} />
    </div>
  );
}

export function QrDialog({ chain, address }: { chain: ChainTag; address: string }) {
  const meta = CHAIN_META[chain];
  const label = `QR code for ${meta.name} ${meta.network} address ${address}`;
  return (
    <Dialog.Root>
      <Dialog.Trigger
        aria-label={`Show ${meta.name} address QR code`}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-control border border-line bg-surface-2 text-fg-2 transition-colors hover:bg-raised hover:text-fg"
      >
        <QrCode className="size-4" />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
        <Dialog.Content className="fixed inset-x-4 top-1/2 z-50 mx-auto max-w-[380px] -translate-y-1/2 rounded-[20px] border border-line-strong bg-surface-2 p-6 text-center shadow-lifted outline-none data-[state=open]:animate-panel-in">
          <Dialog.Close
            aria-label="Close"
            className="absolute right-3 top-3 inline-flex size-10 items-center justify-center rounded-control text-fg-2 hover:bg-raised hover:text-fg"
          >
            <X className="size-5" />
          </Dialog.Close>
          <Dialog.Title className="text-[18px] font-semibold tracking-[-0.01em]">
            {meta.name} <span className="font-normal text-fg-3">{meta.network}</span>
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-[13.5px] text-fg-2">
            {chain === "evm" ? "Send only on Base Sepolia." : `Send only ${meta.unit} on ${meta.network}.`}
          </Dialog.Description>
          <div className="mt-5">
            <QrCodeBlock value={address} label={label} />
          </div>
          <div className="mt-5 flex items-center gap-2 rounded-control border border-line bg-bg py-1 pl-3 pr-1 text-left">
            <span className="min-w-0 flex-1 break-all font-mono text-[12.5px] leading-relaxed text-fg">{chunkAddress(address)}</span>
            <CopyButton value={address} label={`Copy ${meta.name} address`} size="sm" />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
