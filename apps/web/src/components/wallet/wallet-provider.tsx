"use client";

import { Dialog } from "radix-ui";
import { ArrowRight, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { SimulatedTag } from "@/components/ui/primitives";
import { DEMO_ACCOUNTS } from "@/lib/vault/mock-data";
import { IS_SIMULATED } from "@/lib/config";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "bearer:wallet";

/** Wallets offered through @hot-labs/near-connect once testnet mode is wired up (brief 3.3, Flow A). */
const WALLETS = ["Meteor", "HOT", "MyNearWallet", "Intear"] as const;

interface WalletContextValue {
  accountId: string | null;
  /** False until we've read the stored session on the client. */
  ready: boolean;
  connect: (accountId: string) => void;
  disconnect: () => void;
  openConnect: (reason?: string) => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [dialog, setDialog] = useState<{ open: boolean; reason?: string }>({ open: false });

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAccountId(localStorage.getItem(STORAGE_KEY));
    } catch {}
    setReady(true);
  }, []);

  const connect = useCallback((id: string) => {
    setAccountId(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {}
    setDialog({ open: false });
    toast.success(`Signed in as ${id}`);
  }, []);

  const disconnect = useCallback(() => {
    setAccountId(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, []);

  const openConnect = useCallback((reason?: string) => setDialog({ open: true, reason }), []);

  const value = useMemo(
    () => ({ accountId, ready, connect, disconnect, openConnect }),
    [accountId, ready, connect, disconnect, openConnect],
  );

  return (
    <WalletContext.Provider value={value}>
      {children}
      <ConnectDialog
        open={dialog.open}
        reason={dialog.reason}
        current={accountId}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        onConnect={connect}
      />
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}

function ConnectDialog({
  open,
  reason,
  current,
  onOpenChange,
  onConnect,
}: {
  open: boolean;
  reason?: string;
  current: string | null;
  onOpenChange: (open: boolean) => void;
  onConnect: (id: string) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
        <Dialog.Content className="fixed inset-x-4 top-1/2 z-50 mx-auto max-w-[440px] -translate-y-1/2 rounded-[20px] border border-line-strong bg-surface-2 p-6 shadow-lifted outline-none data-[state=open]:animate-panel-in">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-[21px] font-semibold tracking-[-0.02em]">Connect a wallet</Dialog.Title>
              <Dialog.Description className="mt-1 text-[14px] leading-relaxed text-fg-2">
                {reason ?? "Bearer runs on NEAR testnet. Your wallet signs every change to your vaults."}
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Close"
              className="-mr-2 -mt-1 inline-flex size-11 shrink-0 items-center justify-center rounded-control text-fg-2 hover:bg-raised hover:text-fg"
            >
              <X className="size-5" />
            </Dialog.Close>
          </div>

          {IS_SIMULATED ? (
            <div className="mt-6">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium text-fg-2">Demo accounts</span>
                <SimulatedTag />
              </div>
              <ul className="mt-2.5 flex flex-col gap-2">
                {DEMO_ACCOUNTS.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => onConnect(a.id)}
                      className={cn(
                        "group flex w-full items-center gap-3 rounded-[12px] border border-line bg-surface px-3.5 py-3 text-left transition-colors hover:border-gold/50 hover:bg-raised",
                        current === a.id && "border-gold/50",
                      )}
                    >
                      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-raised text-[13px] font-semibold text-fg-2">
                        {a.id[0].toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-mono text-[14px] text-fg">{a.id}</span>
                        <span className="block text-[12.5px] text-fg-3">
                          {a.role} · {a.note}
                        </span>
                      </span>
                      <ArrowRight className="size-4 text-fg-3 transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-6">
            <span className="text-[13px] font-medium text-fg-2">Wallets</span>
            <ul className="mt-2.5 grid grid-cols-2 gap-2">
              {WALLETS.map((w) => (
                <li key={w}>
                  <button
                    type="button"
                    disabled={IS_SIMULATED}
                    className="flex h-12 w-full items-center gap-2.5 rounded-[12px] border border-line bg-surface px-3 text-[14px] font-medium text-fg transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span
                      aria-hidden
                      className="inline-flex size-6 items-center justify-center rounded-md bg-raised text-[11px] font-semibold text-fg-2"
                    >
                      {w[0]}
                    </span>
                    {w}
                  </button>
                </li>
              ))}
            </ul>
            {IS_SIMULATED ? (
              <p className="mt-2.5 text-[12.5px] leading-relaxed text-fg-3">
                Real wallets connect through near-connect when the app runs against NEAR testnet.
              </p>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
