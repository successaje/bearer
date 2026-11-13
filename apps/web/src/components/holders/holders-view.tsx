"use client";

import { base64 } from "@scure/base";
import { ArrowLeft, KeyRound, Loader2, LockKeyhole, ShieldCheck, ShieldX } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Seal } from "@/components/brand/seal";
import { EmptyState, ErrorState } from "@/components/layout/page-states";
import { Button } from "@/components/ui/button";
import { Callout, Skeleton } from "@/components/ui/primitives";
import { useWallet } from "@/components/wallet/wallet-provider";
import { IS_SIMULATED } from "@/lib/config";
import { holderMessage, newNonce, signWithSeed, type HolderRequest, type HolderResult } from "@/lib/holders/nep413";
import { storedLinkKey } from "@/lib/vault/bearer-link";
import { formatDate, shortAccount, vaultNumber } from "@/lib/vault/format";
import { useVault } from "@/lib/vault/hooks";
import { getConnector } from "@/lib/vault/wallet-bridge";

type Step = { kind: "idle" } | { kind: "signing" } | { kind: "checking" } | { kind: "done"; result: HolderResult } | { kind: "error"; message: string };

/** Signs the vault's NEP-413 message with the open Bearer link's key, or with the connected wallet. */
async function sign(tokenId: string, link: boolean): Promise<HolderRequest> {
  const message = holderMessage(tokenId);
  const recipient = window.location.host;
  const nonce = newNonce();
  const key = link ? storedLinkKey() : null;
  if (key) {
    const signed = signWithSeed(key.seed, key.publicKey, message, nonce, recipient);
    return { tokenId, accountId: key.accountId, ...signed, nonce: base64.encode(nonce) };
  }
  const wallet = await (await getConnector()).wallet();
  const signed = await wallet.signMessage({ message, recipient, nonce });
  return { tokenId, accountId: signed.accountId, publicKey: signed.publicKey, signature: signed.signature, nonce: base64.encode(nonce) };
}

export function HoldersView() {
  const { id } = useParams<{ id: string }>();
  const query = useVault(id);
  const vault = query.data;
  const { accountId, ready, link, openConnect } = useWallet();
  const [step, setStep] = useState<Step>({ kind: "idle" });

  if (IS_SIMULATED) {
    return (
      <Frame id={id}>
        <EmptyState title="The holders' page runs on testnet">
          It checks a real signature and asks NEAR testnet who holds the vault, so it needs the hosted site, which runs
          against NEAR testnet; this simulated demo has nothing to check.
        </EmptyState>
      </Frame>
    );
  }
  if (query.isPending || !ready) return <Frame id={id}><Skeleton className="h-72 w-full rounded-[20px]" /></Frame>;
  if (query.isError) return <Frame id={id}><ErrorState error={query.error} onRetry={() => void query.refetch()} /></Frame>;
  if (!vault) {
    return (
      <Frame id={id}>
        <EmptyState seal="opened" title={`There's no vault ${vaultNumber(id)}`}>Check the number and try again.</EmptyState>
      </Frame>
    );
  }

  async function open() {
    setStep({ kind: "signing" });
    let request: HolderRequest;
    try {
      request = await sign(id, link);
    } catch (e) {
      setStep({ kind: "error", message: /reject|cancel|denied|closed/i.test(String(e)) ? "You didn't sign, so nothing was checked." : `Your wallet couldn't sign: ${String(e).slice(0, 160)}` });
      return;
    }
    setStep({ kind: "checking" });
    try {
      const res = await fetch("/api/holders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
      setStep({ kind: "done", result: (await res.json()) as HolderResult });
    } catch (e) {
      setStep({ kind: "error", message: `The check didn't come back: ${String(e).slice(0, 160)}` });
    }
  }

  const result = step.kind === "done" ? step.result : null;
  if (result?.ok) return <Frame id={id}><Room vaultName={vault.name} result={result} /></Frame>;

  return (
    <Frame id={id}>
      <div className="rounded-[22px] border border-line bg-surface p-6 md:p-8">
        <div className="flex items-start gap-4">
          <Seal variant="monogram" className="size-14 shrink-0" />
          <div className="min-w-0">
            <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-gold">Holders only · {vaultNumber(id)}</p>
            <h1 className="mt-1.5 text-[28px] font-semibold leading-tight tracking-[-0.02em]">{vault.name ?? "A Bearer vault"}</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-fg-2">
              This page opens only for whoever holds the vault right now. Sign a short message with your wallet; the server
              checks the signature, that the key is yours, and that NEAR testnet says your account holds the vault.
            </p>
          </div>
        </div>

        <dl className="mt-6 grid gap-3 rounded-[14px] border border-line bg-surface-2 p-4 text-[14px] sm:grid-cols-2">
          <Fact label="Held now by" value={shortAccount(vault.owner_id)} mono />
          <Fact label="You are" value={accountId ? `${shortAccount(accountId)}${link ? " (a Bearer link)" : ""}` : "not signed in"} mono={Boolean(accountId)} />
        </dl>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {!accountId ? (
            <Button variant="primary" size="lg" onClick={() => openConnect("Connect the wallet that holds this vault. You'll sign a message; nothing is sent on chain.")}>
              <KeyRound className="size-4" />
              Connect a wallet
            </Button>
          ) : (
            <Button variant="primary" size="lg" disabled={step.kind === "signing" || step.kind === "checking"} onClick={() => void open()}>
              {step.kind === "signing" || step.kind === "checking" ? <Loader2 className="size-4 animate-spin" /> : <LockKeyhole className="size-4" />}
              {step.kind === "signing" ? "Waiting for your signature…" : step.kind === "checking" ? "Checking on NEAR testnet…" : "Sign to open"}
            </Button>
          )}
          <span className="text-[13px] text-fg-3">Signing is free: it proves the account is yours and sends nothing on chain.</span>
        </div>

        {result && !result.ok ? <Refusal result={result} tokenId={id} /> : null}
        {step.kind === "error" ? (
          <Callout tone="warn" className="mt-5">
            {step.message}
          </Callout>
        ) : null}
      </div>

      <p className="mx-auto mt-5 max-w-[640px] text-center text-[13px] leading-relaxed text-fg-3">
        The message names this vault ({holderMessage(id)}) and expires after five minutes, so a signature for one vault opens no
        other and can&apos;t be reused later. How it works:{" "}
        <a className="text-fg-2 underline underline-offset-4 hover:text-fg" href="https://github.com/successaje/bearer/blob/main/docs/features/holders.md">
          docs/features/holders.md
        </a>
        .
      </p>
    </Frame>
  );
}

function Room({ vaultName, result }: { vaultName: string | null; result: Extract<HolderResult, { ok: true }> }) {
  return (
    <div className="rounded-[22px] border border-gold/40 bg-surface p-6 shadow-lifted md:p-8">
      <div className="flex items-start gap-4">
        <Seal variant="check" className="size-14 shrink-0" />
        <div className="min-w-0">
          <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-ok">
            <ShieldCheck className="mr-1.5 inline size-3.5 -translate-y-px" />
            Verified holder · {vaultNumber(result.tokenId)}
          </p>
          <h1 className="mt-1.5 text-[28px] font-semibold leading-tight tracking-[-0.02em]">{result.room.title}</h1>
          {vaultName ? <p className="mt-1 text-[15px] text-fg-2">{vaultName}</p> : null}
        </div>
      </div>
      <div className="mt-5 space-y-3 text-[15.5px] leading-relaxed text-fg-2">
        {result.room.body.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </div>
      <dl className="mt-6 grid gap-3 rounded-[14px] border border-line bg-surface-2 p-4 text-[14px] sm:grid-cols-3">
        <Fact label="Holder" value={shortAccount(result.accountId)} mono />
        <Fact label="Checked at block" value={result.blockHeight.toLocaleString("en-US")} mono />
        <Fact label="Holding since" value={result.holderSince ? formatDate(Date.parse(result.holderSince)) : "—"} />
      </dl>
    </div>
  );
}

function Refusal({ result, tokenId }: { result: Exclude<HolderResult, { ok: true }>; tokenId: string }) {
  if (result.reason === "not_holder") {
    return (
      <Callout tone="danger" icon={<ShieldX className="size-4" />} className="mt-5">
        <strong className="font-semibold text-fg">Refused.</strong> {shortAccount(result.accountId)} doesn&apos;t hold vault {vaultNumber(tokenId)}:{" "}
        {shortAccount(result.holder)} does, at block {result.blockHeight.toLocaleString("en-US")}.
        {result.heldUntil ? ` You held it until ${formatDate(Date.parse(result.heldUntil))}; a former holder can't get back in.` : null}
      </Callout>
    );
  }
  return (
    <Callout tone="warn" className="mt-5">
      {result.message}
    </Callout>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12.5px] text-fg-3">{label}</dt>
      <dd className={mono ? "mt-0.5 truncate font-mono text-[13.5px] text-fg" : "mt-0.5 text-fg"}>{value}</dd>
    </div>
  );
}

function Frame({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-[760px] px-5 pb-16 pt-8 md:px-8 md:pt-12">
      <Link href={`/v/${id}`} className="mb-6 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-fg-2 transition-colors hover:text-fg">
        <ArrowLeft className="size-4" />
        Back to vault {vaultNumber(id)}
      </Link>
      {children}
    </div>
  );
}
