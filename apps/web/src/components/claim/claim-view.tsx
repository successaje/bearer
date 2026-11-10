"use client";

import type { VaultView } from "@bearer/sdk";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Copy, Link2, Loader2, PackageOpen, Send, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/layout/page-states";
import { Button, buttonVariants } from "@/components/ui/button";
import { Callout, Skeleton } from "@/components/ui/primitives";
import { TransferSheet } from "@/components/vault/transfer-sheet";
import { VaultCard } from "@/components/vault/vault-card";
import { useWallet } from "@/components/wallet/wallet-provider";
import { BEARER_CONTRACT, IS_SIMULATED } from "@/lib/config";
import {
  clearPendingPass,
  linkBalance,
  linkUrl,
  linkWallet,
  newPendingPass,
  parseLinkKey,
  pendingPasses,
  savePendingPass,
  shortAccount,
  storedLinkKey,
  type LinkKey,
  type PendingPass,
} from "@/lib/vault/bearer-link";
import { getVaultClient } from "@/lib/vault/client";
import { errorCopy } from "@/lib/vault/errors";
import { CHAIN_META, formatAmount, formatNear, formatUsd, vaultNumber } from "@/lib/vault/format";
import { useObservation, useVault, useVaults } from "@/lib/vault/hooks";
import { isSealed, observedUsd } from "@/lib/vault/report";

const NEAR = 10n ** 24n;
/**
 * What the old link keeps to move the vault: NEAR takes a call's gas up front (30 Tgas is about
 * 0.031 NEAR), and charges a transfer to a link's account about 0.0076 NEAR up front as if it
 * created that account, refunding the unused parts. What's left afterwards is swept to the new link.
 */
const KEEP_FOR_TRANSFER = (5n * NEAR) / 100n;
/** Left behind by a sweep, to cover that up-front charge on the sweep itself. */
const SWEEP_MARGIN = NEAR / 100n;
/** The least worth sending a new link: enough for its holder to move the vault on again. */
const MIN_FORWARD = (2n * NEAR) / 100n;

/**
 * `/claim#<key>`: a sealed vault sent as a link (lib/vault/bearer-link.ts). Opening it holds the
 * link in this tab, so every vault page works for it without a wallet. From here the holder keeps
 * it (to a NEAR account), passes it on as a new link (the old one is then empty), or opens its
 * page to break the seal and withdraw.
 */
export function ClaimView() {
  const { ready, link, accountId, openLink } = useWallet();
  const [problem, setProblem] = useState<string | null>(null);
  // A pass-on in progress: started here, or left in this browser by a reload, a closed tab or a crash.
  const [pending, setPending] = useState<PendingPass | null>(null);

  // A key in the address opens the link, then leaves the address bar.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash || IS_SIMULATED) return;
    history.replaceState(null, "", window.location.pathname);
    const key = parseLinkKey(hash);
    if (key) openLink(key);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    else setProblem("This address doesn't hold a Bearer link's key. Check that the whole link was copied.");
  }, [openLink]);

  useEffect(() => {
    if (!ready || IS_SIMULATED) return;
    const all = pendingPasses();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPending((link && accountId ? all.find((p) => p.from === accountId) : all[0]) ?? null);
  }, [ready, link, accountId]);

  if (IS_SIMULATED) {
    return (
      <Frame>
        <EmptyState title="Bearer links are live on testnet">
          A Bearer link is a sealed vault sent as a link, with real testnet coins in it. They work on the hosted site, which runs
          against NEAR testnet; this simulated demo doesn&apos;t have any.
        </EmptyState>
      </Frame>
    );
  }

  if (!ready) {
    return (
      <Frame>
        <Skeleton className="h-72 rounded-panel" />
      </Frame>
    );
  }

  return (
    <Frame>
      {pending ? <PassOnPanel pending={pending} onClose={() => setPending(null)} /> : null}
      {problem ? (
        <Callout tone="danger" className="mb-6">
          {problem}
        </Callout>
      ) : null}
      {link && accountId ? (
        <Holding accountId={accountId} onPassOn={setPending} hide={Boolean(pending)} />
      ) : (
        <OpenLink
          onOpen={(key) => {
            setProblem(null);
            openLink(key);
          }}
        />
      )}
    </Frame>
  );
}

function OpenLink({ onOpen }: { onOpen: (key: LinkKey) => void }) {
  const [text, setText] = useState("");
  const [bad, setBad] = useState(false);
  return (
    <div className="mx-auto max-w-[560px]">
      <h1 className="text-[34px] font-semibold leading-tight tracking-[-0.035em]">Open a Bearer link</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-fg-2">
        A Bearer link is a sealed vault sent as a link. Whoever opens it holds the vault, and whatever is at its Bitcoin, Base and
        Solana addresses. No wallet needed. Opening the link from the message it came in does this for you; or paste it here.
      </p>
      <form
        className="mt-6 flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          const key = parseLinkKey(text.includes("#") ? text.slice(text.indexOf("#") + 1) : text);
          setBad(!key);
          if (key) onOpen(key);
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="https://bearer-near.vercel.app/claim#…"
          autoComplete="off"
          spellCheck={false}
          aria-label="Bearer link"
          className="h-11 min-w-0 flex-1 rounded-control border border-line-strong bg-surface px-3.5 font-mono text-[13px] outline-none focus:border-gold"
        />
        <Button type="submit" variant="primary" size="lg" disabled={!text.trim()}>
          Open
        </Button>
      </form>
      {bad ? <p className="mt-2 text-[13px] text-danger">That doesn&apos;t read as a Bearer link.</p> : null}
      <p className="mt-6 text-[13px] leading-relaxed text-fg-3">
        The key is the part after <span className="font-mono">#</span>. Browsers never send that part to a server, and this page keeps
        it only in this tab, until you close it.
      </p>
    </div>
  );
}

function Holding({ accountId, onPassOn, hide }: { accountId: string; onPassOn: (p: PendingPass) => void; hide: boolean }) {
  const vaults = useVaults(accountId);
  const balance = useQuery({ queryKey: ["link-balance", accountId], queryFn: () => linkBalance(accountId), refetchInterval: 15_000 });
  const { disconnect } = useWallet();

  if (vaults.isPending || balance.isPending) return <Skeleton className="h-72 rounded-panel" />;
  if (hide) return null;

  if (balance.data === null) {
    return (
      <EmptyState title="This link isn't funded yet" action={<Button onClick={disconnect}>Forget this link</Button>}>
        Its account, <span className="font-mono">{shortAccount(accountId)}</span>, doesn&apos;t exist on NEAR testnet yet. Whoever made
        the link funds it when they put a vault in it.
      </EmptyState>
    );
  }

  const list = vaults.data ?? [];
  if (!list.length) {
    return (
      <EmptyState
        seal="cracked"
        title="This link is empty"
        action={<Button onClick={disconnect}>Forget this link</Button>}
      >
        Whatever it held has been moved on: to a NEAR account, or into a new link. That&apos;s the point of a Bearer vault. Handing it
        on leaves nothing behind for an old copy of the link.
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-14">
      {list.map((v) => (
        <VaultInLink key={v.token_id} vault={v} accountId={accountId} nearLeft={balance.data?.spendable ?? 0n} onPassOn={onPassOn} />
      ))}
    </div>
  );
}

function VaultInLink({
  vault,
  accountId,
  nearLeft,
  onPassOn,
}: {
  vault: VaultView;
  accountId: string;
  nearLeft: bigint;
  onPassOn: (p: PendingPass) => void;
}) {
  const observations = useObservation(vault).data;
  const sealed = isSealed(vault);
  const held = (observations ?? []).filter((o) => o.confirmed !== "0" || o.pending !== "0");
  const giver = vault.custody.length > 1 ? vault.custody[vault.custody.length - 2].account_id : null;
  const [sending, setSending] = useState(false);

  return (
    <section className="grid items-start gap-8 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:gap-12">
      <div className="mx-auto w-full max-w-[420px]">
        <VaultCard vault={vault} valueUsd={observations ? observedUsd(observations) : null} />
      </div>
      <div className="min-w-0">
        <p className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent">
          <Link2 className="size-3.5" />
          A Bearer link
        </p>
        <h1 className="mt-2 text-[32px] font-semibold leading-tight tracking-[-0.035em]">
          {sealed ? "You're holding a sealed vault" : "You're holding an opened vault"}
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-fg-2">
          Vault {vaultNumber(vault.token_id)}
          {vault.name ? `, "${vault.name}",` : ""} {giver ? <>handed to this link by <span className="font-mono">{shortAccount(giver)}</span>.</> : "is in this link."}{" "}
          {sealed
            ? "Its seal is intact: nobody has ever asked for a withdrawal signature, so everything at its addresses is still there for whoever holds it."
            : "Its seal is broken, so it can't change hands any more. Withdraw what's left from its page."}
        </p>

        <ul className="mt-5 divide-y divide-line overflow-hidden rounded-panel border border-line bg-surface">
          {!observations ? (
            <li className="px-4 py-3.5">
              <Skeleton className="h-5 w-48" />
            </li>
          ) : held.length ? (
            held.map((o) => (
              <li key={o.chain} className="flex items-baseline justify-between gap-4 px-4 py-3.5">
                <span className="text-[14px] text-fg-2">{CHAIN_META[o.chain].name}</span>
                <span className="tabular text-right text-[15px] font-medium">
                  {formatAmount(o.chain, o.confirmed)} {CHAIN_META[o.chain].unit}
                  {o.pending !== "0" ? <span className="ml-2 text-[12.5px] font-normal text-fg-3">+{formatAmount(o.chain, o.pending)} pending</span> : null}
                </span>
              </li>
            ))
          ) : (
            <li className="px-4 py-3.5 text-[14px] text-fg-3">Nothing at its addresses yet.</li>
          )}
          {observations && held.length ? (
            <li className="flex items-baseline justify-between gap-4 px-4 py-3 text-[13px] text-fg-3">
              <span>Testnet coins have no value; at mainnet prices</span>
              <span className="tabular">{formatUsd(observedUsd(observations))} est.</span>
            </li>
          ) : null}
        </ul>

        {sealed ? (
          <>
            <div className="mt-6 rounded-panel border border-warn/40 bg-warn/[0.07] p-5">
              <p className="text-[12.5px] font-semibold uppercase tracking-[0.12em] text-warn">First, secure it</p>
              <p className="mt-2 text-[14.5px] leading-relaxed text-fg">
                {giver ? <span className="font-mono">{shortAccount(giver)}</span> : "Whoever sent this link"} still has a copy of it.
                Opening the link doesn&apos;t change that: until you move the vault, anyone holding a copy can take it.
              </p>
              <div className="mt-4 flex flex-wrap gap-2.5">
                <PassOn vault={vault} accountId={accountId} nearLeft={nearLeft} onPassOn={onPassOn} />
                <Button onClick={() => setSending(true)} disabled={!vault.keys}>
                  <Send className="size-4" />
                  Move it to my NEAR account
                </Button>
              </div>
              <p className="mt-3 text-[12.5px] leading-relaxed text-fg-3">
                Either way, every copy of this link is left empty, and nothing moves on Bitcoin, Base or Solana: same addresses, same
                coins, a new holder.
              </p>
            </div>
            <div className="mt-6">
              <p className="text-[14px] font-medium">Then, when you&apos;re ready, open it</p>
              <p className="mt-1 text-[13.5px] leading-relaxed text-fg-2">
                Breaking the seal lets you withdraw to any address. It&apos;s permanent: an opened vault can never change hands again.
              </p>
              <Link href={`/v/${vault.token_id}`} className={buttonVariants({ variant: "ghost", className: "mt-2 -ml-3" })}>
                <PackageOpen className="size-4" />
                Break the seal and withdraw
              </Link>
            </div>
          </>
        ) : (
          <Link href={`/v/${vault.token_id}`} className={buttonVariants({ variant: "primary", className: "mt-5" })}>
            Withdraw from its page
            <ArrowRight className="size-4" />
          </Link>
        )}

        <p className="mt-5 text-[12.5px] leading-relaxed text-fg-3">
          This link&apos;s account, <span className="font-mono">{shortAccount(accountId)}</span>, has {formatNear(nearLeft, 3)} for
          fees. Its <Link href={`/v/${vault.token_id}`} className="text-accent hover:underline">public page</Link> shows the seal
          check, the addresses and its history.
        </p>
      </div>
      {sealed ? (
        <TransferSheet open={sending} onOpenChange={setSending} vault={vault} observations={observations} signer={accountId} />
      ) : null}
    </section>
  );
}

/**
 * Starts passing the vault into a new link. The new key is made and kept in this browser before
 * anything moves; PassOnPanel shows it to be saved, then moves the vault.
 */
function PassOn({
  vault,
  accountId,
  nearLeft,
  onPassOn,
}: {
  vault: VaultView;
  accountId: string;
  nearLeft: bigint;
  onPassOn: (p: PendingPass) => void;
}) {
  return (
    <Button
      variant="primary"
      disabled={!vault.keys || nearLeft - KEEP_FOR_TRANSFER < MIN_FORWARD}
      onClick={() => {
        const p = newPendingPass(accountId, vault.token_id);
        if (!savePendingPass(p)) {
          return toast.error("This browser won't store the new link, so passing it on here could lose the vault.", {
            description: "Send it to a NEAR account instead.",
          });
        }
        onPassOn(p);
      }}
    >
      <Link2 className="size-4" />
      Move it to a new private link
    </Button>
  );
}

/**
 * A pass-on, from saving the new link to Done. Every step checks what's already happened, so
 * "Move the vault into it" also finishes one that an interruption stopped halfway. The new link
 * stays in this browser until Done.
 */
function PassOnPanel({ pending, onClose }: { pending: PendingPass; onClose: () => void }) {
  const qc = useQueryClient();
  const { accountId } = useWallet();
  const key = parseLinkKey(pending.seed) as LinkKey;
  const url = linkUrl(key);
  const vault = useVault(pending.tokenId).data;
  const moved = vault?.owner_id === key.accountId;
  const stillInOld = vault?.owner_id === pending.from;
  const signing = accountId === pending.from;
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState<"move" | "cancel" | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["vaults"] });
    void qc.invalidateQueries({ queryKey: ["vault"] });
    void qc.invalidateQueries({ queryKey: ["link-balance"] });
  };

  async function move() {
    const from = storedLinkKey();
    if (!from || from.accountId !== pending.from) return toast.error("Open the old link in this tab to finish moving the vault.");
    setBusy("move");
    try {
      const client = await getVaultClient();
      const now = await client.getVault(pending.tokenId);
      if (now?.owner_id !== key.accountId) {
        if (now?.owner_id !== pending.from) throw new Error("The vault isn't in the old link any more.");
        // Fund the new link first, so it never holds the vault without NEAR for fees.
        if (!(await linkBalance(key.accountId))) {
          const spendable = (await linkBalance(pending.from))?.spendable ?? 0n;
          if (spendable - KEEP_FOR_TRANSFER < MIN_FORWARD) throw new Error("The old link doesn't have enough NEAR left to fund a new one.");
          await linkWallet(from).transfer(key.accountId, spendable - KEEP_FOR_TRANSFER);
        }
        await client.transfer(pending.tokenId, key.accountId, pending.from);
      }
      // Sweep what the transfer didn't use, once its gas refund has landed (a block or two);
      // the old link keeps only its storage.
      let left = -1n;
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 800));
        const n = (await linkBalance(from.accountId, "optimistic"))?.spendable ?? 0n;
        if (n === left) break;
        left = n;
      }
      if (left > SWEEP_MARGIN) await linkWallet(from).transfer(key.accountId, left - SWEEP_MARGIN).catch(() => undefined);
    } catch (e) {
      toast.error("It didn't pass on", { description: errorCopy(e) });
    } finally {
      refresh();
      setBusy(null);
    }
  }

  /** Before the vault moves: forget the new link, and bring back any NEAR already sent to it. */
  async function cancel() {
    setBusy("cancel");
    try {
      const funded = await linkBalance(key.accountId);
      if (funded && funded.spendable > SWEEP_MARGIN) await linkWallet(key).transfer(pending.from, funded.spendable - SWEEP_MARGIN);
      clearPendingPass(pending.from);
      refresh();
      onClose();
    } catch (e) {
      toast.error("Couldn't cancel", { description: errorCopy(e) });
    } finally {
      setBusy(null);
    }
  }

  const copy = () =>
    void navigator.clipboard.writeText(url).then(() => {
      setSaved(true);
      toast.success("New link copied. Anyone who has it can take the vault.");
    });

  return (
    <section className="mb-12 overflow-hidden rounded-panel border border-gold/40 bg-gold/[0.06]">
      <div className="grid gap-6 p-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:p-8">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent">
            {moved ? <ShieldCheck className="size-4" /> : <Link2 className="size-4" />}
            {moved ? "Moved, still sealed" : "Moving it: save the new link first"}
          </p>
          <h2 className="mt-2 text-[26px] font-semibold leading-tight tracking-[-0.03em]">
            {moved ? `Vault ${vaultNumber(pending.tokenId)} is in the new link` : `The new link for vault ${vaultNumber(pending.tokenId)}`}
          </h2>
          <p className="mt-2 text-[14.5px] leading-relaxed text-fg-2">
            {moved
              ? "Keep this link to hold the vault yourself, or send it to give the vault to someone. The link you opened is empty now: anyone holding a copy of it gets nothing."
              : "Copy it, or scan the QR code, and keep it somewhere only you can open. Nothing has moved yet. Once it's saved, move the vault into it."}
          </p>
          {moved && vault?.btc_address ? (
            <p className="mt-3 text-[13.5px] leading-relaxed text-fg-2">
              Same Bitcoin address, same coins:{" "}
              <a
                href={`https://mempool.space/testnet4/address/${vault.btc_address}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-accent hover:underline"
              >
                {vault.btc_address.slice(0, 8)}…{vault.btc_address.slice(-6)}
              </a>
              . Only who holds it changed.
            </p>
          ) : null}
          <div className="mt-4 flex min-w-0 items-center gap-2 rounded-control border border-line-strong bg-surface px-3 py-2">
            <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-fg-2">{url}</span>
            <Button size="sm" onClick={copy}>
              {saved ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {saved ? "Copied" : "Copy"}
            </Button>
          </div>

          {moved ? (
            <Button variant="primary" className="mt-5" onClick={() => (clearPendingPass(pending.from), onClose())}>
              Done
            </Button>
          ) : !vault ? (
            <Skeleton className="mt-5 h-10 w-56" />
          ) : stillInOld ? (
            <>
              <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-[14px]">
                <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-1 size-4 accent-[var(--color-gold)]" />
                I&apos;ve saved the new link. If I lose it, nobody can get the vault back.
              </label>
              <div className="mt-4 flex flex-wrap gap-2.5">
                <Button variant="primary" onClick={() => void move()} disabled={!saved || !signing || busy !== null}>
                  {busy === "move" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                  {busy === "move" ? "Moving it…" : "Move the vault into it"}
                </Button>
                <Button variant="ghost" onClick={() => void cancel()} disabled={busy !== null}>
                  {busy === "cancel" ? <Loader2 className="size-4 animate-spin" /> : null}
                  Cancel
                </Button>
              </div>
              {!signing ? (
                <p className="mt-3 text-[13px] text-fg-3">Open the old link in this tab to move the vault.</p>
              ) : null}
            </>
          ) : (
            <>
              <Callout tone="warn" className="mt-5">
                The vault isn&apos;t in the old link any more, and it didn&apos;t go to this one.
              </Callout>
              <Button variant="ghost" className="mt-3 -ml-2" onClick={() => void cancel()} disabled={busy !== null}>
                Forget this link
              </Button>
            </>
          )}

          <p className="mt-4 text-[12.5px] leading-relaxed text-fg-3">
            This browser keeps the new link until you press {moved ? "Done" : "Done or Cancel"}, so a reload or a closed tab can&apos;t lose
            it. The vault&apos;s{" "}
            <Link href={`/v/${pending.tokenId}`} className="text-accent hover:underline">
              public page
            </Link>{" "}
            shows it changing hands on {BEARER_CONTRACT}.
          </p>
        </div>
        <div className="mx-auto rounded-[14px] bg-white p-3 sm:mx-0">
          <QRCodeSVG value={url} size={168} level="M" marginSize={0} role="img" aria-label="QR code of the new link" />
        </div>
      </div>
    </section>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-[1200px] px-5 pb-16 pt-10 md:px-8 md:pt-14">{children}</div>;
}
