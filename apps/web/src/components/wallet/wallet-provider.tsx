"use client";

import { Dialog } from "radix-ui";
import { ArrowRight, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { SimulatedTag } from "@/components/ui/primitives";
import { DEMO_ACCOUNTS } from "@/lib/vault/mock-data";
import { linkWallet, storeLinkKey, storedLinkKey, type LinkKey } from "@/lib/vault/bearer-link";
import { getConnector, setConnectedAccount, setLinkWallet } from "@/lib/vault/wallet-bridge";
import { IS_SIMULATED } from "@/lib/config";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "bearer:wallet";

/** Wallets offered through @hot-labs/near-connect once testnet mode is wired up (brief 3.3, Flow A). */
const WALLETS = ["Meteor", "HOT", "MyNearWallet", "Intear"] as const;

interface WalletContextValue {
  accountId: string | null;
  /** False until we've read the stored session on the client. */
  ready: boolean;
  /** The account is a Bearer link open in this tab (lib/vault/bearer-link.ts), not a wallet. */
  link: boolean;
  connect: (accountId: string) => void;
  /** Disconnects the wallet, or forgets the open link. */
  disconnect: () => void;
  openConnect: (reason?: string) => void;
  /** Holds a Bearer link in this tab: its key signs until the tab closes or a wallet connects. */
  openLink: (key: LinkKey) => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [link, setLink] = useState<LinkKey | null>(null);
  const [ready, setReady] = useState(false);
  const [dialog, setDialog] = useState<{ open: boolean; reason?: string }>({ open: false });

  useEffect(() => {
    if (IS_SIMULATED) {
      try {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setAccountId(localStorage.getItem(STORAGE_KEY));
      } catch {}
      setReady(true);
      return;
    }
    // Testnet: a Bearer link open in this tab comes first; otherwise near-connect owns the
    // session, and signing in with a wallet replaces the link.
    let live = true;
    const stored = storedLinkKey();
    if (stored) {
      setLinkWallet(linkWallet(stored));
      setLink(stored);
      setAccountId(stored.accountId);
    }
    void getConnector().then((c) => {
      c.on("wallet:signIn", (e) => {
        if (!live) return;
        storeLinkKey(null);
        setLinkWallet(null);
        setLink(null);
        setAccountId(e.accounts[0]?.accountId ?? null);
      });
      c.on("wallet:signOut", () => live && !storedLinkKey() && setAccountId(null));
      c.getConnectedWallet()
        .then(({ accounts }) => live && !storedLinkKey() && setAccountId(accounts[0]?.accountId ?? null))
        .catch(() => undefined)
        .finally(() => live && setReady(true));
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => setConnectedAccount(accountId), [accountId]);

  const connect = useCallback((id: string) => {
    setAccountId(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {}
    setDialog({ open: false });
    toast.success(`Signed in as ${id}`);
  }, []);

  const openLink = useCallback((key: LinkKey) => {
    storeLinkKey(key);
    setLinkWallet(linkWallet(key));
    setLink(key);
    setAccountId(key.accountId);
  }, []);

  const disconnect = useCallback(() => {
    if (link) {
      // Forget the link; a wallet signed in underneath it comes back.
      storeLinkKey(null);
      setLinkWallet(null);
      setLink(null);
      setAccountId(null);
      void getConnector()
        .then((c) => c.getConnectedWallet())
        .then(({ accounts }) => setAccountId(accounts[0]?.accountId ?? null))
        .catch(() => undefined);
      return;
    }
    setAccountId(null);
    if (!IS_SIMULATED) {
      void getConnector().then((c) => c.disconnect());
      return;
    }
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, [link]);

  const openConnect = useCallback((reason?: string) => {
    if (IS_SIMULATED) return setDialog({ open: true, reason });
    // near-connect shows its own wallet picker (HOT, Meteor, Intear, MyNearWallet, …).
    void getConnector()
      .then((c) => c.connect())
      .catch((e: unknown) => toast.error("Couldn't connect a wallet", { description: String(e).slice(0, 140) }));
  }, []);

  const value = useMemo(
    () => ({ accountId, ready, link: Boolean(link), connect, disconnect, openConnect, openLink }),
    [accountId, ready, link, connect, disconnect, openConnect, openLink],
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
