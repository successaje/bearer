"use client";

import type { Holdings, NftHolding, TokenHolding, VaultView } from "@bearer/sdk";
import { ArrowUpRight, Coins, ImageIcon, Loader2, Plus } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FieldMessage, Input, Label, Skeleton } from "@/components/ui/primitives";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { IS_SIMULATED } from "@/lib/config";
import { errorCopy } from "@/lib/vault/errors";
import { formatNear, formatUnits, parseNear, parseUnits, vaultNumber } from "@/lib/vault/format";
import { useHoldings, useHoldingsAction, useNftInfo, useTokenInfo, type HoldingsAction } from "@/lib/vault/hooks";
import { isSealed } from "@/lib/vault/report";
import { validateNearAccount } from "@/lib/validation";
import { cn } from "@/lib/utils";

type Mode =
  | { kind: "deposit_near" }
  | { kind: "load_token" }
  | { kind: "load_nft" }
  | { kind: "withdraw_near" }
  | { kind: "withdraw_token"; holding: TokenHolding }
  | { kind: "withdraw_nft"; holding: NftHolding };

/**
 * v2: what the contract holds for this vault on NEAR (holdings.rs). It moves with the vault while
 * sealed and leaves only after opening, by the owner. Tokens and NFTs are named by their contract,
 * since anyone can deploy one with any symbol (H7).
 */
export function HoldingsPanel({ vault, viewer, onConnect }: { vault: VaultView; viewer: string | null; onConnect: () => void }) {
  const holdings = useHoldings(vault.token_id);
  const [mode, setMode] = useState<Mode | null>(null);
  const isOwner = viewer === vault.owner_id;
  const canWithdraw = isOwner && !isSealed(vault);
  const h = holdings.data;
  const empty = h && h.near === "0" && !h.tokens.length && !h.nfts.length;

  return (
    <section aria-labelledby="held-on-near" className="mt-11">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="held-on-near" className="text-[20px] font-semibold tracking-[-0.02em]">
          Held on NEAR
        </h2>
        <p className="text-[13px] text-fg-3">Moves with the vault; leaves only after opening.</p>
      </div>

      <div className="mt-4 overflow-hidden rounded-panel border border-line bg-surface">
        {!h ? (
          <div className="flex flex-col gap-3 p-4">
            <Skeleton className="h-11" />
            <Skeleton className="h-11" />
          </div>
        ) : empty ? (
          <p className="p-5 text-[14px] text-fg-2">Nothing held on NEAR yet. Anyone can add NEAR; its owner can load tokens and NFTs.</p>
        ) : (
          <ul className="divide-y divide-line">
            {h.near !== "0" ? (
              <Row
                icon={<span className="font-mono text-[12px] font-semibold">N</span>}
                title={formatNear(h.near, 4)}
                sub="NEAR, after the storage its entries use"
                action={canWithdraw ? <WithdrawButton onClick={() => setMode({ kind: "withdraw_near" })} /> : null}
              />
            ) : null}
            {h.tokens.map((t) => (
              <TokenRow key={t.contract} holding={t} onWithdraw={canWithdraw ? () => setMode({ kind: "withdraw_token", holding: t }) : null} />
            ))}
            {h.nfts.map((n) => (
              <NftRow key={`${n.contract}/${n.token_id}`} holding={n} onWithdraw={canWithdraw ? () => setMode({ kind: "withdraw_nft", holding: n }) : null} />
            ))}
          </ul>
        )}
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        {viewer ? (
          <Button size="sm" onClick={() => setMode({ kind: "deposit_near" })}>
            <Plus className="size-3.5" />
            Add NEAR
          </Button>
        ) : (
          <Button size="sm" onClick={onConnect}>
            Connect a wallet to add NEAR
          </Button>
        )}
        {isOwner ? (
          <>
            <Button size="sm" onClick={() => setMode({ kind: "load_token" })}>
              <Coins className="size-3.5" />
              Load a token
            </Button>
            <Button size="sm" onClick={() => setMode({ kind: "load_nft" })}>
              <ImageIcon className="size-3.5" />
              Load an NFT
            </Button>
          </>
        ) : null}
      </div>
      {isOwner && h && BigInt(h.near) < 10n ** 21n ? (
        <p className="mt-2.5 text-[12.5px] text-fg-3">Each token or NFT uses a little of the vault&apos;s NEAR for storage, so add some NEAR first.</p>
      ) : null}

      {viewer && mode ? (
        <HoldingsSheet vault={vault} signer={viewer} holdings={h} mode={mode} onClose={() => setMode(null)} />
      ) : null}
    </section>
  );
}

function Row({ icon, title, sub, pending, action }: { icon: ReactNode; title: ReactNode; sub: ReactNode; pending?: ReactNode; action?: ReactNode }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-raised text-fg-2">{icon}</span>
      <div className="min-w-0 flex-1">
        {/* A div, since the title may be a loading skeleton. */}
        <div className="tabular truncate text-[14.5px] font-medium">{title}</div>
        <p className="mt-0.5 truncate font-mono text-[11.5px] text-fg-3">{sub}</p>
        {pending ? (
          <p className="mt-0.5 inline-flex items-center gap-1 text-[12px] text-info">
            <Loader2 className="size-3 animate-spin" aria-hidden />
            {pending}
          </p>
        ) : null}
      </div>
      {action}
    </li>
  );
}

function WithdrawButton({ onClick }: { onClick: () => void }) {
  return (
    <Button size="sm" onClick={onClick}>
      <ArrowUpRight className="size-3.5" />
      Withdraw
    </Button>
  );
}

function TokenRow({ holding, onWithdraw }: { holding: TokenHolding; onWithdraw: (() => void) | null }) {
  const info = useTokenInfo(holding.contract).data;
  const symbol = info?.symbol ?? "tokens";
  const decimals = info?.decimals ?? 0;
  return (
    <Row
      icon={<span className="font-mono text-[11px] font-semibold">{(info?.symbol ?? "?").slice(0, 4)}</span>}
      title={info ? `${formatUnits(holding.amount, decimals)} ${symbol}` : <Skeleton className="h-4 w-28" />}
      sub={holding.contract}
      pending={holding.pending !== "0" && info ? `${formatUnits(holding.pending, decimals)} ${symbol} on its way out` : null}
      action={onWithdraw && holding.amount !== "0" ? <WithdrawButton onClick={onWithdraw} /> : null}
    />
  );
}

function NftRow({ holding, onWithdraw }: { holding: NftHolding; onWithdraw: (() => void) | null }) {
  const info = useNftInfo(holding.contract, holding.token_id).data;
  const media = info?.media && /^https?:\/\//.test(info.media) ? info.media : null;
  return (
    <Row
      // eslint-disable-next-line @next/next/no-img-element -- arbitrary NFT media, not a site asset
      icon={media ? <img src={media} alt="" className="size-full object-cover" /> : <ImageIcon className="size-4" aria-hidden />}
      title={info?.title ?? `NFT ${holding.token_id}`}
      sub={`${holding.contract} · ${holding.token_id}`}
      pending={holding.pending ? "On its way out" : null}
      action={onWithdraw && !holding.pending ? <WithdrawButton onClick={onWithdraw} /> : null}
    />
  );
}

const TITLES: Record<Mode["kind"], string> = {
  deposit_near: "Add NEAR",
  load_token: "Load a token",
  load_nft: "Load an NFT",
  withdraw_near: "Withdraw NEAR",
  withdraw_token: "Withdraw tokens",
  withdraw_nft: "Withdraw an NFT",
};

/** One sheet for every holdings action: the fields it needs, what happens, then one transaction. */
function HoldingsSheet({
  vault,
  signer,
  holdings,
  mode,
  onClose,
}: {
  vault: VaultView;
  signer: string;
  holdings: Holdings | undefined;
  mode: Mode;
  onClose: () => void;
}) {
  const id = useId();
  const act = useHoldingsAction();
  const [contract, setContract] = useState(mode.kind === "withdraw_token" || mode.kind === "withdraw_nft" ? mode.holding.contract : "");
  const [nftTokenId, setNftTokenId] = useState(mode.kind === "withdraw_nft" ? mode.holding.token_id : "");
  const [amount, setAmount] = useState("");
  const [receiver, setReceiver] = useState(signer);
  const [touched, setTouched] = useState(false);

  const needsContract = mode.kind === "load_token" || mode.kind === "load_nft";
  const isToken = mode.kind === "load_token" || mode.kind === "withdraw_token";
  const isNft = mode.kind === "load_nft" || mode.kind === "withdraw_nft";
  const isNear = mode.kind === "deposit_near" || mode.kind === "withdraw_near";
  const withdrawing = mode.kind.startsWith("withdraw");
  const contractId = contract.trim().toLowerCase();
  const tokenInfo = useTokenInfo(isToken && !validateNearAccount(contractId) ? contractId : null);
  const nftInfo = useNftInfo(isNft && !validateNearAccount(contractId) ? contractId : null, isNft && nftTokenId.trim() ? nftTokenId.trim() : null);

  const decimals = isNear ? 24 : (tokenInfo.data?.decimals ?? null);
  const units = isNft || decimals === null ? null : isNear ? parseNear(amount) : parseUnits(amount, decimals);
  const available =
    mode.kind === "withdraw_near" ? holdings?.near : mode.kind === "withdraw_token" ? mode.holding.amount : null;

  const error = (() => {
    if (needsContract && validateNearAccount(contractId)) return `Enter the ${isToken ? "token" : "NFT"} contract's NEAR account.`;
    if (isToken && tokenInfo.isError) return `${contractId} doesn't answer as a token contract.`;
    if (isNft && !nftTokenId.trim()) return "Enter the NFT's token id.";
    if (isNft && nftInfo.isError) return `${contractId} has no NFT ${nftTokenId.trim()}.`;
    if (!isNft) {
      if (!amount.trim()) return "Enter an amount.";
      if (!units || BigInt(units) === 0n) return "Use a plain number above zero, like 2 or 0.5.";
      if (mode.kind === "deposit_near" && BigInt(units) < 10n ** 22n) return "Add at least 0.01 NEAR.";
      if (available && BigInt(units) > BigInt(available)) return "That's more than the vault holds.";
    }
    if (withdrawing && validateNearAccount(receiver.trim().toLowerCase())) return "Enter the NEAR account to send it to.";
    return null;
  })();
  const ready = !error && (!isToken || tokenInfo.data) && (!isNft || nftInfo.data);

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!ready) return;
    const to = receiver.trim().toLowerCase();
    const action: HoldingsAction =
      mode.kind === "deposit_near"
        ? { kind: "deposit_near", yocto: units as string }
        : mode.kind === "load_token"
          ? { kind: "load_token", contract: contractId, amount: units as string }
          : mode.kind === "load_nft"
            ? { kind: "load_nft", contract: contractId, nftTokenId: nftTokenId.trim() }
            : mode.kind === "withdraw_near"
              ? { kind: "withdraw_near", receiver: to, yocto: units as string }
              : mode.kind === "withdraw_token"
                ? { kind: "withdraw_token", contract: contractId, receiver: to, amount: units as string }
                : { kind: "withdraw_nft", contract: contractId, nftTokenId: nftTokenId.trim(), receiver: to };
    act.mutate(
      { id: vault.token_id, action, signer },
      {
        onSuccess: () => {
          toast.success(withdrawing ? "Sent. It's left the vault." : "Done. It's in the vault.");
          onClose();
        },
        onError: (err) => toast.error(errorCopy(err)),
      },
    );
  }

  const field = "bg-bg font-mono";
  return (
    <Sheet open onOpenChange={(o) => (o ? null : onClose())}>
      <SheetContent
        title={TITLES[mode.kind]}
        description={
          withdrawing
            ? `From vault ${vaultNumber(vault.token_id)}, which you've opened.`
            : mode.kind === "deposit_near"
              ? `Into vault ${vaultNumber(vault.token_id)}. Anyone may add NEAR; only the holder can take it out, after opening.`
              : `Into vault ${vaultNumber(vault.token_id)}. It moves with the vault, and only its holder can take it out, after opening.`
        }
      >
        <form onSubmit={submit} noValidate className="flex flex-col gap-5">
          {needsContract ? (
            <div>
              <Label htmlFor={`${id}-contract`}>{isToken ? "Token contract" : "NFT contract"}</Label>
              <Input
                id={`${id}-contract`}
                className={cn("mt-2", field)}
                value={contract}
                onChange={(e) => setContract(e.target.value)}
                placeholder={IS_SIMULATED ? (isToken ? "usdt.mock.testnet" : "tickets.mock.testnet") : isToken ? "token.testnet" : "nft.testnet"}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
              />
              {isToken && tokenInfo.data ? (
                <FieldMessage tone="ok">
                  {tokenInfo.data.symbol ?? "No symbol"}
                  {tokenInfo.data.name ? `, ${tokenInfo.data.name}` : ""} · {tokenInfo.data.decimals} decimals. Check the contract account, not just the symbol.
                </FieldMessage>
              ) : null}
            </div>
          ) : null}

          {isNft && mode.kind === "load_nft" ? (
            <div>
              <Label htmlFor={`${id}-nft`}>Token id</Label>
              <Input id={`${id}-nft`} className={cn("mt-2", field)} value={nftTokenId} onChange={(e) => setNftTokenId(e.target.value)} autoComplete="off" />
              {nftInfo.data ? <FieldMessage tone="ok">{nftInfo.data.title ?? `NFT ${nftInfo.data.token_id}`}</FieldMessage> : null}
            </div>
          ) : null}

          {isNft && mode.kind === "withdraw_nft" ? (
            <p className="text-[14px]">
              {nftInfo.data?.title ?? `NFT ${mode.holding.token_id}`} <span className="font-mono text-[12px] text-fg-3">· {mode.holding.contract}</span>
            </p>
          ) : null}

          {!isNft ? (
            <div>
              <Label htmlFor={`${id}-amount`}>
                Amount{isNear ? " (NEAR)" : tokenInfo.data?.symbol ? ` (${tokenInfo.data.symbol})` : ""}
              </Label>
              <Input
                id={`${id}-amount`}
                className="tabular mt-2 bg-bg text-[16px]"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0.5"
                autoComplete="off"
              />
              {available && decimals !== null ? (
                <FieldMessage tone="muted">
                  The vault holds {isNear ? formatNear(available, 4) : `${formatUnits(available, decimals)} ${tokenInfo.data?.symbol ?? ""}`}.
                </FieldMessage>
              ) : null}
            </div>
          ) : null}

          {withdrawing ? (
            <div>
              <Label htmlFor={`${id}-to`}>Send to</Label>
              <Input id={`${id}-to`} className={cn("mt-2", field)} value={receiver} onChange={(e) => setReceiver(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} />
              {isToken ? <FieldMessage tone="muted">The receiver must be registered with the token contract, or the tokens stay in the vault.</FieldMessage> : null}
            </div>
          ) : null}

          {!withdrawing && !isNear ? (
            <p className="text-[12.5px] leading-relaxed text-fg-3">
              Uses about 0.001 NEAR of the vault&apos;s NEAR for storage, paid back when it leaves. If the vault can&apos;t pay,
              {isToken ? " the tokens come" : " the NFT comes"} straight back to you.
            </p>
          ) : null}

          {touched && error ? <FieldMessage tone="error">{error}</FieldMessage> : null}

          <Button type="submit" variant="primary" size="lg" disabled={act.isPending || (touched && !ready)}>
            {act.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            {act.isPending ? "Confirm in your wallet…" : TITLES[mode.kind]}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
