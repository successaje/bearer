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
import { linkBalance, linkUrl, linkWallet, newLinkKey, parseLinkKey, shortAccount, storedLinkKey, type LinkKey } from "@/lib/vault/bearer-link";
import { getVaultClient } from "@/lib/vault/client";
import { errorCopy } from "@/lib/vault/errors";
import { CHAIN_META, formatAmount, formatNear, formatUsd, vaultNumber } from "@/lib/vault/format";
import { useObservation, useVaults } from "@/lib/vault/hooks";
import { isSealed, observedUsd } from "@/lib/vault/report";

const NEAR = 10n ** 24n;
/**
 * What the old link keeps to move the vault: NEAR takes a call's gas up front (30 Tgas is about
 * 0.031 NEAR) and refunds the unused part. Whatever is left afterwards is swept to the new link.
 */
const KEEP_FOR_TRANSFER = (4n * NEAR) / 100n;
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
  const [passed, setPassed] = useState<{ url: string; vault: VaultView } | null>(null);

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
      {passed ? <PassedOn url={passed.url} vault={passed.vault} onDone={() => setPassed(null)} /> : null}
      {problem ? (
        <Callout tone="danger" className="mb-6">
          {problem}
        </Callout>
      ) : null}
      {link && accountId ? (
        <Holding accountId={accountId} onPassed={setPassed} hide={Boolean(passed)} />
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

function Holding({ accountId, onPassed, hide }: { accountId: string; onPassed: (p: { url: string; vault: VaultView }) => void; hide: boolean }) {
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
        <VaultInLink key={v.token_id} vault={v} accountId={accountId} nearLeft={balance.data?.spendable ?? 0n} onPassed={onPassed} />
      ))}
    </div>
  );
}

function VaultInLink({
  vault,
  accountId,
  nearLeft,
  onPassed,
}: {
  vault: VaultView;
  accountId: string;
  nearLeft: bigint;
  onPassed: (p: { url: string; vault: VaultView }) => void;
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
          {vault.name ? `, "${vault.name}",` : ""} {giver ? <>handed to this link by <span className="font-mono">{giver}</span>.</> : "is in this link."}{" "}
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
              <span>Observed from public data</span>
              <span className="tabular">{formatUsd(observedUsd(observations))} est.</span>
            </li>
          ) : null}
        </ul>

        {sealed ? (
          <>
            <Callout tone="warn" className="mt-5">
              Anyone with this link can take the vault, like cash. To make it yours alone, move it out: to a NEAR account, or into a
              new link that only you have.
            </Callout>
            <div className="mt-5 flex flex-wrap gap-2.5">
              <PassOn vault={vault} accountId={accountId} nearLeft={nearLeft} onPassed={onPassed} />
              <Button onClick={() => setSending(true)} disabled={!vault.keys}>
                <Send className="size-4" />
                Send it to a NEAR account
              </Button>
              <Link href={`/v/${vault.token_id}`} className={buttonVariants({ variant: "ghost" })}>
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
 * Moves the vault into a new link: funds the new link's account from this one, then transfers
 * the vault to it. This link is then empty, so passing it on leaves the giver nothing.
 */
function PassOn({
  vault,
  accountId,
  nearLeft,
  onPassed,
}: {
  vault: VaultView;
  accountId: string;
  nearLeft: bigint;
  onPassed: (p: { url: string; vault: VaultView }) => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  // Made once and kept, so a retry after a failed step reuses the new link it already funded.
  const [next, setNext] = useState<LinkKey | null>(null);
  const affordable = next ? nearLeft >= KEEP_FOR_TRANSFER : nearLeft - KEEP_FOR_TRANSFER >= MIN_FORWARD;

  async function pass() {
    const current = storedLinkKey();
    if (!current || current.accountId !== accountId) return toast.error("Open the link again: this tab no longer holds it.");
    const key = next ?? newLinkKey();
    setNext(key);
    setBusy(true);
    try {
      // Fund the new link first, so it never holds the vault without NEAR for fees.
      if (!(await linkBalance(key.accountId))) await linkWallet(current).transfer(key.accountId, nearLeft - KEEP_FOR_TRANSFER);
      await (await getVaultClient()).transfer(vault.token_id, key.accountId, accountId);
      // Sweep what the transfer didn't use, once its gas refund has landed (a block or two);
      // the old link keeps only its storage.
      let left = -1n;
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 800));
        const now = (await linkBalance(current.accountId, "optimistic"))?.spendable ?? 0n;
        if (now === left) break;
        left = now;
      }
      if (left > NEAR / 500n) await linkWallet(current).transfer(key.accountId, left - NEAR / 500n).catch(() => undefined);
      void qc.invalidateQueries({ queryKey: ["vaults"] });
      void qc.invalidateQueries({ queryKey: ["link-balance"] });
      onPassed({ url: linkUrl(key), vault });
    } catch (e) {
      toast.error("It didn't pass on", { description: errorCopy(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="primary" onClick={() => void pass()} disabled={busy || !vault.keys || !affordable}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
      {busy ? "Passing it on…" : "Pass it on as a new link"}
    </Button>
  );
}

function PassedOn({ url, vault, onDone }: { url: string; vault: VaultView; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <section className="mb-12 overflow-hidden rounded-panel border border-gold/40 bg-gold/[0.06]">
      <div className="grid gap-6 p-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:p-8">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent">
            <ShieldCheck className="size-4" />
            Passed on, still sealed
          </p>
          <h2 className="mt-2 text-[26px] font-semibold leading-tight tracking-[-0.03em]">Vault {vaultNumber(vault.token_id)} is in a new link</h2>
          <p className="mt-2 text-[14.5px] leading-relaxed text-fg-2">
            Send this link to whoever should have it. The one you opened is empty now: anyone holding a copy of it gets nothing. Nothing
            moved on Bitcoin, Base or Solana.
          </p>
          <div className="mt-4 flex min-w-0 items-center gap-2 rounded-control border border-line-strong bg-surface px-3 py-2">
            <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-fg-2">{url}</span>
            <Button
              size="sm"
              onClick={() =>
                void navigator.clipboard.writeText(url).then(() => {
                  setCopied(true);
                  toast.success("Link copied. Anyone who has it can take the vault.");
                })
              }
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="mt-3 text-[12.5px] text-fg-3">
            This page won&apos;t show the link again once you leave it. The vault&apos;s{" "}
            <Link href={`/v/${vault.token_id}`} className="text-accent hover:underline">
              public page
            </Link>{" "}
            shows it changing hands on {BEARER_CONTRACT}.
          </p>
          <Button variant="ghost" size="sm" className="mt-3 -ml-2" onClick={onDone}>
            Done
          </Button>
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
