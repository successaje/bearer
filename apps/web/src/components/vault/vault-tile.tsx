import type { ChainObservation, VaultView, Withdrawal } from "@bearer/sdk";
import Link from "next/link";
import { ChainStack } from "@/components/brand/chain-icon";
import { BearerCard } from "@/components/card/bearer-card";
import { Skeleton } from "@/components/ui/primitives";
import { CHAIN_META, formatUsd, relativeTime } from "@/lib/vault/format";
import { observedUsd, openedAt, vaultStatus, withdrawalAmount, type VaultStatus } from "@/lib/vault/report";
import { VaultStatusBadge } from "./vault-status-badge";

function secondaryLine(
  status: VaultStatus,
  vault: VaultView,
  obs: ChainObservation[] | undefined,
  withdrawals: Withdrawal[] | undefined,
  now: number,
) {
  const pending = obs?.find((o) => o.pending !== "0");
  switch (status) {
    case "sealed":
      return pending
        ? `Deposit pending on ${CHAIN_META[pending.chain].name}. Still sealed.`
        : "Unopened · 0 signatures · can change hands";
    case "withdrawing": {
      const w = withdrawals?.find((x) => x.status === "pending");
      return w ? `Withdrawal signing on ${CHAIN_META[withdrawalAmount(w).chain].name}…` : "Withdrawal signing…";
    }
    case "empty":
      return "Opened and emptied. It can't change hands.";
    default: {
      const at = openedAt(vault);
      return `Opened ${at ? relativeTime(at, now) : ""} · can't change hands`;
    }
  }
}

export function VaultTile({
  vault,
  observations,
  withdrawals,
  now,
}: {
  vault: VaultView;
  observations: ChainObservation[] | undefined;
  withdrawals: Withdrawal[] | undefined;
  now: number;
}) {
  const status = vaultStatus(vault, withdrawals, observations);
  const value = observations ? observedUsd(observations) : null;
  const chains = (observations ?? []).filter((o) => o.confirmed !== "0" || o.pending !== "0").map((o) => o.chain);
  const name = vault.name ?? `Vault ${vault.token_id}`;

  return (
    <Link
      href={`/v/${vault.token_id}`}
      className="group block rounded-[20px] border border-line bg-surface p-3.5 transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lifted focus-visible:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <BearerCard
        name={name}
        id={vault.token_id}
        finish={vault.finish}
        seal={status === "sealed" ? "monogram" : "opened"}
        chains={[]}
        shadow={false}
      />
      <div className="px-1.5 pb-1 pt-4">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="truncate text-[16px] font-semibold tracking-[-0.01em]">{name}</h3>
          {value === null ? (
            <Skeleton className="h-5 w-20" />
          ) : (
            <p className="tabular shrink-0 text-[17px] font-semibold">
              {formatUsd(value)} <span className="text-[12px] font-medium text-fg-3">est.</span>
            </p>
          )}
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <VaultStatusBadge status={status} />
          {chains.length ? <ChainStack chains={chains} ring="var(--surface)" iconClassName="size-[18px]" /> : null}
        </div>
        <p className="mt-2.5 line-clamp-2 text-[13px] leading-snug text-fg-3">
          {now ? secondaryLine(status, vault, observations, withdrawals, now) : " "}
        </p>
      </div>
    </Link>
  );
}
