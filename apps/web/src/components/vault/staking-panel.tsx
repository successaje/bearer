"use client";

import type { StakingInfo, VaultStake, VaultView } from "@bearer/sdk";
import { ArrowDownToLine, Clock, Loader2, Sprout, Undo2 } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FieldMessage, Input, Label, Skeleton } from "@/components/ui/primitives";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { errorCopy } from "@/lib/vault/errors";
import { formatNear, parseNear, vaultNumber } from "@/lib/vault/format";
import { useHoldings, useStakeOf, useStaking, useStakingAction } from "@/lib/vault/hooks";
import { cn } from "@/lib/utils";

const MIN_STAKE = 10n ** 23n;
const UNLOCK_EPOCHS = 4;

/** "about 28 hours": epochs vary with the block rate, so never more precise than that. */
function about(ms: number) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 2) return "about a minute";
  if (minutes < 90) return `about ${minutes} minutes`;
  const hours = Math.round(ms / 3_600_000);
  return hours < 48 ? `about ${hours} hours` : `about ${Math.round(hours / 24)} days`;
}

function untilEpoch(st: StakingInfo, target: number) {
  if (st.epoch >= target) return null;
  return about(st.msToNextEpoch + (target - st.epoch - 1) * st.msPerEpoch);
}

/**
 * v2: the vault's NEAR staked with the contract's one pool (staking.rs). Its holder stakes and
 * unstakes, sealed or opened; nothing is signed, and unstaked NEAR comes back into the vault.
 */
export function StakingPanel({ vault, viewer, onConnect }: { vault: VaultView; viewer: string | null; onConnect: () => void }) {
  const staking = useStaking();
  const stake = useStakeOf(vault.token_id);
  const act = useStakingAction();
  const [mode, setMode] = useState<"stake" | "unstake" | null>(null);
  const st = staking.data;
  const mine = stake.data;
  if (st && !st.pool) return null;

  const isOwner = viewer === vault.owner_id;
  const unlocked = st?.unlocksAtEpoch != null && st.epoch >= st.unlocksAtEpoch;
  const canMoveAlong = st ? (st.unbonding !== "0" && unlocked) || (st.unbonding === "0" && st.queued !== "0") : false;
  const hasStake = mine && mine.shares !== "0";

  function moveAlong() {
    if (!viewer) return onConnect();
    act.mutate(
      { id: vault.token_id, action: { kind: "process" }, signer: viewer },
      { onSuccess: () => toast.success("Done. Unlocked NEAR is back in its vaults."), onError: (e) => toast.error(errorCopy(e)) },
    );
  }

  return (
    <section aria-labelledby="staked" className="mt-11">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="staked" className="text-[20px] font-semibold tracking-[-0.02em]">
          Staked
        </h2>
        <p className="text-[13px] text-fg-3">NEAR staking rewards vary and aren&apos;t guaranteed.</p>
      </div>

      <div className="mt-4 overflow-hidden rounded-panel border border-line bg-surface">
        {!st || stake.isLoading ? (
          <div className="flex flex-col gap-3 p-4">
            <Skeleton className="h-11" />
          </div>
        ) : (
          <>
            <div className="flex items-start gap-3 p-4">
              <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-raised text-fg-2">
                <Sprout className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="tabular text-[14.5px] font-medium">{hasStake ? `${formatNear(mine.staked, 4)} staked` : "Nothing staked"}</p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-fg-3">
                  With <span className="font-mono">{st.pool}</span>, the contract&apos;s only pool. It moves with the vault, and only its holder can
                  stake or unstake.
                </p>
              </div>
            </div>
            {mine ? <Unstaking stake={mine} staking={st} /> : null}
          </>
        )}
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        {isOwner ? (
          <>
            <Button size="sm" onClick={() => setMode("stake")}>
              <Sprout className="size-3.5" />
              Stake NEAR
            </Button>
            {hasStake ? (
              <Button size="sm" onClick={() => setMode("unstake")}>
                <Undo2 className="size-3.5" />
                Unstake
              </Button>
            ) : null}
          </>
        ) : null}
        {canMoveAlong ? (
          <Button size="sm" onClick={moveAlong} disabled={act.isPending}>
            {act.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowDownToLine className="size-3.5" />}
            {viewer ? "Bring unlocked NEAR back" : "Connect a wallet to bring it back"}
          </Button>
        ) : null}
      </div>
      {st ? (
        <p className="mt-2.5 text-[12.5px] leading-relaxed text-fg-3">
          Unstaking takes {UNLOCK_EPOCHS} epochs at the pool, {about(UNLOCK_EPOCHS * st.msPerEpoch)}. Requests go in batches, so one can wait
          for the batch before it. Once a batch unlocks, anyone can bring it back.
        </p>
      ) : null}

      {viewer && mode && st ? (
        <StakeSheet vault={vault} signer={viewer} staking={st} stake={mine ?? null} mode={mode} onClose={() => setMode(null)} />
      ) : null}
    </section>
  );
}

function Unstaking({ stake, staking }: { stake: VaultStake; staking: StakingInfo }) {
  const rows: { key: string; icon: ReactNode; title: string; sub: string }[] = [];
  if (stake.queued !== "0") {
    rows.push({
      key: "queued",
      icon: <Clock className="size-4" aria-hidden />,
      title: `${formatNear(stake.queued, 4)} unstaking`,
      sub:
        staking.unlocksAtEpoch != null
          ? `Waits for the batch before it, which unlocks at epoch ${staking.unlocksAtEpoch}${untilEpoch(staking, staking.unlocksAtEpoch) ? `, ${untilEpoch(staking, staking.unlocksAtEpoch)} from now` : ""}`
          : "Goes to the pool with the next batch",
    });
  }
  if (stake.unbonding !== "0" && stake.unlocksAtEpoch != null) {
    const left = untilEpoch(staking, stake.unlocksAtEpoch);
    rows.push({
      key: "unbonding",
      icon: <Clock className="size-4" aria-hidden />,
      title: `${formatNear(stake.unbonding, 4)} unlocking`,
      sub: left ? `At the pool until epoch ${stake.unlocksAtEpoch}, ${left} from now` : `Unlocked at epoch ${stake.unlocksAtEpoch}: anyone can bring it back`,
    });
  }
  if (!rows.length) return null;
  return (
    <ul className="divide-y divide-line border-t border-line">
      {rows.map((r) => (
        <li key={r.key} className="flex items-start gap-3 px-4 py-3">
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-raised text-fg-3">{r.icon}</span>
          <div className="min-w-0">
            <p className="tabular text-[14px] font-medium">{r.title}</p>
            <p className="mt-0.5 text-[12.5px] text-fg-3">{r.sub}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Stake from the vault's NEAR, or unstake back into it: an amount, what happens, one transaction. */
function StakeSheet({
  vault,
  signer,
  staking,
  stake,
  mode,
  onClose,
}: {
  vault: VaultView;
  signer: string;
  staking: StakingInfo;
  stake: VaultStake | null;
  mode: "stake" | "unstake";
  onClose: () => void;
}) {
  const id = useId();
  const act = useStakingAction();
  const holdings = useHoldings(vault.token_id).data;
  const [amount, setAmount] = useState("");
  const [all, setAll] = useState(mode === "unstake");
  const [touched, setTouched] = useState(false);
  const staking_ = mode === "stake";
  const available = staking_ ? holdings?.near : stake?.staked;
  const units = parseNear(amount);
  const unlock = about(UNLOCK_EPOCHS * staking.msPerEpoch);

  const error = (() => {
    if (!staking_ && all) return null;
    if (!amount.trim()) return "Enter an amount.";
    if (!units || BigInt(units) === 0n) return "Use a plain number above zero, like 1 or 0.5.";
    if (staking_ && BigInt(units) < MIN_STAKE) return "Stake at least 0.1 NEAR.";
    if (available && BigInt(units) > BigInt(available)) return staking_ ? "That's more than the vault holds." : "That's more than the vault has staked.";
    return null;
  })();

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (error) return;
    act.mutate(
      { id: vault.token_id, action: staking_ ? { kind: "stake", yocto: units as string } : { kind: "unstake", yocto: all ? null : (units as string) }, signer },
      {
        onSuccess: () => {
          toast.success(staking_ ? "Staked. It stays in the vault's name." : "Unstaking. It comes back into the vault once it unlocks.");
          onClose();
        },
        onError: (err) => toast.error(errorCopy(err)),
      },
    );
  }

  return (
    <Sheet open onOpenChange={(o) => (o ? null : onClose())}>
      <SheetContent
        title={staking_ ? "Stake NEAR" : "Unstake NEAR"}
        description={
          staking_
            ? `From vault ${vaultNumber(vault.token_id)}'s NEAR, with ${staking.pool}. Nothing is signed and the seal isn't touched.`
            : `Back into vault ${vaultNumber(vault.token_id)}'s NEAR, once the pool unlocks it.`
        }
      >
        <form onSubmit={submit} noValidate className="flex flex-col gap-5">
          {!staking_ ? (
            <fieldset className="grid gap-2">
              <legend className="sr-only">How much</legend>
              {[
                [true, "Everything staked", stake ? formatNear(stake.staked, 4) : ""],
                [false, "An amount", "In NEAR"],
              ].map(([value, title, sub]) => (
                <label
                  key={String(value)}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-[12px] border px-3.5 py-3 transition-colors",
                    all === value ? "border-gold/50 bg-gold/[0.06]" : "border-line hover:border-line-strong",
                  )}
                >
                  <input type="radio" name={`${id}-all`} className="sr-only" checked={all === value} onChange={() => setAll(value as boolean)} />
                  <span className={cn("mt-0.5 size-4 shrink-0 rounded-full border", all === value ? "border-[5px] border-gold" : "border-line-strong")} />
                  <span>
                    <span className="block text-[14px] font-medium">{title as string}</span>
                    <span className="tabular block text-[12.5px] text-fg-3">{sub as string}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          ) : null}

          {staking_ || !all ? (
            <div>
              <Label htmlFor={`${id}-amount`}>Amount (NEAR)</Label>
              <Input
                id={`${id}-amount`}
                className="tabular mt-2 bg-bg text-[16px]"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="1"
                autoComplete="off"
              />
              {available ? (
                <FieldMessage tone="muted">
                  {staking_ ? `The vault holds ${formatNear(available, 4)}. The first stake also uses about 0.001 NEAR of it for a record.` : `${formatNear(available, 4)} is staked.`}
                </FieldMessage>
              ) : null}
            </div>
          ) : null}

          <ul className="flex flex-col gap-1.5 text-[13px] leading-relaxed text-fg-2">
            {staking_ ? (
              <>
                <li>It stays the vault&apos;s: hand the vault on and the stake goes with it, rewards included.</li>
                <li>Getting it back takes {UNLOCK_EPOCHS} epochs at the pool, {unlock}.</li>
                <li>Rewards depend on the pool and the network. They vary and aren&apos;t guaranteed.</li>
              </>
            ) : (
              <>
                <li>It goes to the pool now, or with the next batch if one is unlocking. Then it unlocks in {UNLOCK_EPOCHS} epochs, {unlock}.</li>
                <li>Once unlocked, anyone can bring it back into the vault&apos;s NEAR.</li>
                <li>To take it out of the vault, its holder breaks the seal and withdraws.</li>
              </>
            )}
          </ul>

          {touched && error ? <FieldMessage tone="error">{error}</FieldMessage> : null}

          <Button type="submit" variant="primary" size="lg" disabled={act.isPending || (touched && !!error)}>
            {act.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            {act.isPending ? "Confirm in your wallet…" : staking_ ? "Stake" : "Unstake"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
