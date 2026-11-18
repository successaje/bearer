"use client";

import type { VaultView } from "@bearer/sdk";
import { ArrowUpRight, AtSign, ExternalLink, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { formatWhen, nsToMsNumber } from "@/components/schedule/when";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { FieldMessage, Input, Label, SimulatedTag } from "@/components/ui/primitives";
import { EscrowLock } from "@/components/vault/escrow-lock";
import { IS_SIMULATED, NAMES_CONTRACT, TLA_ROOT, explorer } from "@/lib/config";
import { errorCopy } from "@/lib/vault/errors";
import { formatNear, parseNear, vaultNumber } from "@/lib/vault/format";
import {
  useNamePrice,
  useNamesFacts,
  useNameVault,
  useRenewName,
  useVaultName,
  useWithdrawFromName,
} from "@/lib/vault/hooks";

const LABEL = /^[a-z0-9](?:[a-z0-9-]{1,30})[a-z0-9]$/;
/** The names contract keeps `vault-0042` for vault No. 0042 (N6). */
const reservedFor = (label: string, tokenId: string) =>
  label.startsWith("vault-") && label !== `vault-${tokenId.padStart(4, "0")}`;
/** Warn this long before a lease ends. */
const SOON_MS = 60 * 24 * 3600 * 1000;

function useDebounced(value: string, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * The vault's own NEAR account: a name rented under a TLA through House of Stake's contracts,
 * leased to Bearer's names contract. Anyone can pay NEAR into it; only the holder of the opened
 * vault can take it out, so it passes on with a sealed vault like everything else inside. Unlike
 * the vault's other addresses it also depends on the TLA's contracts: its lease has to be renewed,
 * and their council can move it (N8, N10).
 */
export function VaultNamePanel({ vault, viewer }: { vault: VaultView; viewer: string | null }) {
  const name = useVaultName(vault.token_id);
  const facts = useNamesFacts();
  const isHolder = !!viewer && viewer === vault.owner_id;
  const opened = vault.state.kind === "opened";
  if (!NAMES_CONTRACT || !TLA_ROOT || name.isPending) return null;
  const n = name.data;
  if (!n && !isHolder) return null;

  return (
    <div className="rounded-panel border-line bg-surface mt-7 border p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-fg-3 inline-flex items-center gap-2 font-mono text-[11.5px] font-medium tracking-[0.16em] uppercase">
          <AtSign aria-hidden className="size-3.5" />
          Its NEAR account
        </p>
        {IS_SIMULATED ? (
          <SimulatedTag />
        ) : (
          <span className="text-fg-3 text-[12.5px]">
            A name under {TLA_ROOT}, through House of Stake&apos;s TLA contracts
          </span>
        )}
      </div>
      {n ? (
        <Named vault={vault} viewer={viewer} isHolder={isHolder} opened={opened} name={n} />
      ) : (
        <NameIt vault={vault} viewer={viewer as string} />
      )}
      <div className="border-line mt-4 border-t pt-3.5">
        <EscrowLock name="Names" account={NAMES_CONTRACT} holds="a vault's name" facts={facts.data} compact />
      </div>
    </div>
  );
}

function Named({
  vault,
  viewer,
  isHolder,
  opened,
  name,
}: {
  vault: VaultView;
  viewer: string | null;
  isHolder: boolean;
  opened: boolean;
  name: NonNullable<ReturnType<typeof useVaultName>["data"]>;
}) {
  const renew = useRenewName();
  const [withdrawing, setWithdrawing] = useState(false);
  const [now] = useState(() => Date.now());
  const expires = name.expires_at_ns ? nsToMsNumber(name.expires_at_ns) : null;
  const ending = expires !== null && (expires - now < SOON_MS || name.lifecycle !== "Active");
  if (!name.held) {
    return (
      <div className="border-warn/40 bg-warn/5 text-fg-2 mt-3 rounded-[10px] border p-3.5 text-[13.5px] leading-relaxed">
        <p className="text-fg inline-flex items-center gap-2 font-medium">
          <TriangleAlert aria-hidden className="text-warn size-4" />
          <span className="font-mono [overflow-wrap:anywhere]">{name.account_id}</span> isn&apos;t this vault&apos;s any
          more
        </p>
        <p className="mt-1.5">
          Its lease ran out and the name was taken back, so Bearer&apos;s names contract no longer controls it.
          Don&apos;t send NEAR to it: it wouldn&apos;t go with vault {vaultNumber(vault.token_id)}.
        </p>
      </div>
    );
  }
  return (
    <>
      <p className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[18px] font-semibold tracking-[-0.01em] [overflow-wrap:anywhere]">
        {name.account_id}
        <CopyButton value={name.account_id} label="Copy the vault's NEAR account" size="sm" />
      </p>
      <p className="tabular text-fg-2 mt-1.5 text-[14px]">
        Holds <span className="text-fg font-medium">{formatNear(name.balance)}</span>
        {expires ? (
          <>
            {" "}
            · leased until <span className="text-fg">{formatWhen(expires)}</span>
          </>
        ) : null}
        {name.lifecycle && name.lifecycle !== "Active" ? <span className="text-warn"> · {name.lifecycle}</span> : null}
      </p>
      {ending ? (
        <p className="border-warn/40 bg-warn/5 text-fg-2 mt-3 flex gap-2 rounded-[10px] border p-3 text-[13.5px] leading-relaxed">
          <TriangleAlert aria-hidden className="text-warn mt-0.5 size-4 shrink-0" />
          <span>
            Renew the lease before it ends. Once it has, anyone can sweep this name&apos;s NEAR into the names contract,
            where it no longer belongs to the vault, and a week later anyone can take the name.
          </span>
        </p>
      ) : null}
      <p className="text-fg-2 mt-3 text-[13.5px] leading-relaxed">
        A real NEAR account with no access keys. Anyone can send NEAR to it. Bearer&apos;s names contract (
        <span className="font-mono">{NAMES_CONTRACT}</span>) holds its lease and sends from it only for whoever holds
        vault {vaultNumber(vault.token_id)}, once it&apos;s opened.{" "}
        {opened
          ? "This vault is opened, so its holder can take the NEAR out."
          : "This vault is sealed, so the NEAR stays inside and goes with the vault when it changes hands."}
      </p>
      <p className="text-fg-3 mt-2 text-[12.5px] leading-relaxed">
        Unlike the vault&apos;s other addresses, this one also depends on House of Stake&apos;s TLA contracts: the lease
        lasts a year at a time and anyone can renew it, but the TLA&apos;s council can move a name, and the shared
        wallet it runs can be changed by its deployer. Keep small amounts here.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        {isHolder && opened ? (
          <Button size="sm" variant="primary" onClick={() => setWithdrawing((w) => !w)}>
            <ArrowUpRight className="size-3.5" />
            Take NEAR out
          </Button>
        ) : null}
        {viewer ? (
          <Button
            size="sm"
            disabled={renew.isPending}
            onClick={() =>
              renew.mutate(
                { id: vault.token_id, signer: viewer },
                {
                  onSuccess: (n) =>
                    toast.success(
                      `Renewed${n.expires_at_ns ? ` until ${formatWhen(nsToMsNumber(n.expires_at_ns))}` : ""}.`,
                    ),
                  onError: (e) => toast.error(errorCopy(e)),
                },
              )
            }
          >
            {renew.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            {renew.isPending ? "Confirm in your wallet…" : "Renew a year"}
          </Button>
        ) : null}
        {!IS_SIMULATED ? (
          <a
            href={explorer.nearAccount(name.account_id)}
            target="_blank"
            rel="noreferrer"
            className="text-accent inline-flex items-center gap-1 text-[13px] hover:underline"
          >
            On the explorer
            <ExternalLink aria-hidden className="size-3" />
          </a>
        ) : null}
      </div>
      {isHolder && opened && withdrawing && viewer ? (
        <Withdraw vault={vault} viewer={viewer} onDone={() => setWithdrawing(false)} />
      ) : null}
    </>
  );
}

function Withdraw({ vault, viewer, onDone }: { vault: VaultView; viewer: string; onDone: () => void }) {
  const id = useId();
  const withdraw = useWithdrawFromName();
  const [to, setTo] = useState(viewer);
  const [amount, setAmount] = useState("");
  const yocto = parseNear(amount);
  return (
    <form
      className="mt-4 grid gap-3 sm:grid-cols-[1fr_160px_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        if (!yocto || yocto === "0") return;
        withdraw.mutate(
          { id: vault.token_id, receiver: to.trim(), amountYocto: yocto, signer: viewer },
          {
            onSuccess: () => {
              toast.success(`Sent ${formatNear(yocto)} to ${to.trim()}.`);
              onDone();
            },
            onError: (err) => toast.error(errorCopy(err)),
          },
        );
      }}
    >
      <div>
        <Label htmlFor={`${id}-to`}>To</Label>
        <Input
          id={`${id}-to`}
          className="bg-bg mt-1.5 font-mono"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div>
        <Label htmlFor={`${id}-amount`}>NEAR</Label>
        <Input
          id={`${id}-amount`}
          className="tabular bg-bg mt-1.5"
          inputMode="decimal"
          placeholder="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
      <Button type="submit" variant="primary" disabled={withdraw.isPending || !yocto || yocto === "0"}>
        {withdraw.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
        {withdraw.isPending ? "Confirm in your wallet…" : "Send"}
      </Button>
      <FieldMessage tone="muted" className="sm:col-span-3">
        The account keeps a little for its own storage, so it can&apos;t be emptied completely.
      </FieldMessage>
    </form>
  );
}

function NameIt({ vault, viewer }: { vault: VaultView; viewer: string }) {
  const id = useId();
  const [label, setLabel] = useState(`vault-${vault.token_id.padStart(4, "0")}`);
  const l = label.trim().toLowerCase();
  const reserved = reservedFor(l, vault.token_id);
  const valid = LABEL.test(l) && !reserved;
  const debounced = useDebounced(l, 400);
  const price = useNamePrice(valid && debounced === l ? l : null);
  const name = useNameVault();
  const free = price.data?.available === true;
  return (
    <>
      <p className="text-fg-2 mt-2 text-[14.5px] leading-relaxed">
        Rent this vault a name of its own: a real NEAR account under <span className="font-mono">{TLA_ROOT}</span>.
        Anyone can send NEAR to it, and it goes with the vault; once the vault is opened, its holder can take the NEAR
        out. A vault is named once. The lease lasts a year, and anyone can renew it.
      </p>
      <form
        className="mt-4 flex flex-wrap items-end gap-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid || !free) return;
          name.mutate(
            { id: vault.token_id, label: l, signer: viewer },
            {
              onSuccess: (n) => toast.success(`Named ${n.account_id}.`),
              onError: (err) => toast.error(errorCopy(err)),
            },
          );
        }}
      >
        <div className="min-w-0 flex-1">
          <Label htmlFor={`${id}-label`}>Name</Label>
          <div className="rounded-control border-line bg-bg focus-within:ring-accent mt-1.5 flex items-center border pr-3 focus-within:ring-2">
            <input
              id={`${id}-label`}
              className="min-w-0 flex-1 bg-transparent px-3 py-2.5 font-mono text-[14px] outline-none"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-describedby={`${id}-msg`}
            />
            <span className="text-fg-3 shrink-0 font-mono text-[13px]">.{TLA_ROOT}</span>
          </div>
        </div>
        <Button type="submit" variant="primary" disabled={!valid || !free || name.isPending}>
          {name.isPending ? <Loader2 className="size-4 animate-spin" /> : <AtSign className="size-4" />}
          {name.isPending ? "Confirm, then renting…" : "Rent the name"}
        </Button>
      </form>
      <FieldMessage
        id={`${id}-msg`}
        tone={!valid || price.data?.available === false ? "error" : "muted"}
        aria-live="polite"
      >
        {reserved
          ? `Names that start with vault- belong to the vault with that number; this one's is vault-${vault.token_id.padStart(4, "0")}.`
          : !valid
            ? "3 to 32 lower-case letters, digits or inner hyphens."
            : price.isFetching || debounced !== l
              ? "Checking…"
              : price.data?.available === false
                ? `${l}.${TLA_ROOT} is taken.`
                : price.data
                  ? `Free. ${formatNear(price.data.total)} for a year: the rent, and a deposit that stays in the account for its storage.`
                  : ""}
      </FieldMessage>
    </>
  );
}
