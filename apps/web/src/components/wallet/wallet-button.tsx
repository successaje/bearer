"use client";

import { DropdownMenu } from "radix-ui";
import { ChevronDown, Copy, Layers, Link2, LogOut, Repeat, UserRound } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { IS_SIMULATED } from "@/lib/config";
import { shortAccount } from "@/lib/vault/bearer-link";
import { useWallet } from "./wallet-provider";

const itemClass =
  "flex h-9 cursor-pointer select-none items-center gap-2.5 rounded-[8px] px-2.5 text-[14px] text-fg-2 outline-none data-[highlighted]:bg-raised data-[highlighted]:text-fg";

export function WalletButton() {
  const { accountId, ready, link, openConnect, disconnect } = useWallet();

  if (!ready) return <Skeleton className="h-9 w-32 rounded-full" />;

  if (!accountId) {
    return (
      <Button variant="inverse" size="sm" onClick={() => openConnect()}>
        Connect wallet
      </Button>
    );
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="inline-flex h-9 items-center gap-2 rounded-full border border-line-strong bg-surface-2 pl-1 pr-2.5 text-[13.5px] transition-colors hover:bg-raised data-[state=open]:bg-raised">
        <span
          aria-hidden
          className="inline-flex size-7 items-center justify-center rounded-full bg-gold/15 text-[12px] font-semibold text-accent"
        >
          {link ? <Link2 className="size-3.5" /> : accountId[0].toUpperCase()}
        </span>
        <span className="max-w-[9.5rem] truncate font-mono text-[13px]">{link ? `Link · ${shortAccount(accountId)}` : accountId}</span>
        <ChevronDown className="size-3.5 text-fg-3" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 min-w-56 rounded-[12px] border border-line-strong bg-surface-2 p-1 shadow-lifted data-[state=open]:animate-panel-in"
        >
          <DropdownMenu.Label className="px-2.5 pb-1.5 pt-2 text-[12px] text-fg-3">
            {link ? "Holding a Bearer link in this tab" : "Signed in to NEAR testnet"}
          </DropdownMenu.Label>
          {link ? (
            <DropdownMenu.Item asChild className={itemClass}>
              <Link href="/claim">
                <Link2 className="size-4" />
                This link
              </Link>
            </DropdownMenu.Item>
          ) : null}
          <DropdownMenu.Item asChild className={itemClass}>
            <Link href="/vaults">
              <Layers className="size-4" />
              My vaults
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild className={itemClass}>
            <Link href="/account">
              <UserRound className="size-4" />
              Your account
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className={itemClass}
            onSelect={() => {
              void navigator.clipboard.writeText(accountId).then(() => toast.success("Account copied"));
            }}
          >
            <Copy className="size-4" />
            Copy account
          </DropdownMenu.Item>
          {IS_SIMULATED ? (
            <DropdownMenu.Item className={itemClass} onSelect={() => openConnect("Switch to another demo account.")}>
              <Repeat className="size-4" />
              Switch demo account
            </DropdownMenu.Item>
          ) : null}
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item className={itemClass} onSelect={disconnect}>
            <LogOut className="size-4" />
            {link ? "Forget this link" : "Disconnect"}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
