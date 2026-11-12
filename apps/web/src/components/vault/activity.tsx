import type { ChainObservation, VaultView, Withdrawal } from "@bearer/sdk";
import { ArrowDownLeft, PackageOpen, PenLine, Plus, Send, type LucideIcon } from "lucide-react";
import { LEND_CONTRACT, MARKET_CONTRACT, SCHEDULE_CONTRACT, SWITCH_CONTRACT } from "@/lib/config";
import { withdrawalAmount } from "@/lib/vault/report";
import { CHAIN_META, formatAmount, nsToMs, relativeTime, shortAccount } from "@/lib/vault/format";
import { cn } from "@/lib/utils";

interface Item {
  key: string;
  at: number;
  icon: LucideIcon;
  tone: string;
  title: string;
  detail: string;
}

/** One timeline built from the contract's records and observed deposits. */
export function Activity({
  vault,
  withdrawals,
  observations,
  now,
}: {
  vault: VaultView;
  withdrawals: Withdrawal[];
  observations: ChainObservation[] | undefined;
  now: number;
}) {
  const items: Item[] = [];
  const created = nsToMs(vault.created_at_ns);
  vault.custody.forEach((c, i) => {
    const at = nsToMs(c.since_ns);
    if (i === 0 && Math.abs(at - created) < 1000) {
      items.push({ key: "created", at, icon: Plus, tone: "bg-raised text-fg-2", title: "Vault created", detail: `By ${shortAccount(c.account_id)}. Sealed.` });
    } else {
      const prev = vault.custody[i - 1]?.account_id;
      const from = prev ? shortAccount(prev) : undefined;
      const to = shortAccount(c.account_id);
      const market = MARKET_CONTRACT;
      const scheduler = SCHEDULE_CONTRACT;
      const lend = LEND_CONTRACT;
      const switcher = SWITCH_CONTRACT;
      const { title, detail } =
        switcher && c.account_id === switcher
          ? { title: "Put in a switch", detail: `By ${from ?? "its holder"}. Held, sealed, while they keep checking in.` }
          : switcher && from === switcher
            ? c.account_id === vault.custody[i - 2]?.account_id
              ? { title: `Back with ${to}`, detail: "Taken out of the switch. Still sealed." }
              : { title: `Passed on to ${to}`, detail: `${vault.custody[i - 2]?.account_id ?? "Its owner"} went quiet for a whole interval, so the switch handed it on. Still sealed.` }
            : lend && c.account_id === lend
          ? { title: "Pledged for a loan", detail: `By ${from ?? "its holder"}. Held, sealed, until it's repaid or the lender takes it.` }
          : lend && from === lend
            ? c.account_id === vault.custody[i - 2]?.account_id
              ? { title: `Back with ${to}`, detail: "The loan was repaid, or its request taken back. Still sealed." }
              : { title: `Taken by ${to}`, detail: `The lender, after ${vault.custody[i - 2]?.account_id ?? "the borrower"} didn't repay by the due date. Still sealed.` }
            : scheduler && c.account_id === scheduler
          ? { title: "Scheduled for a handover", detail: `By ${from ?? "its holder"}. Held, sealed, until its date.` }
          : scheduler && from === scheduler
            ? c.account_id === vault.custody[i - 2]?.account_id
              ? { title: `Back with ${to}`, detail: "The schedule was cancelled, or refused. Still sealed." }
              : { title: `Handed over to ${to}`, detail: `On schedule, from ${vault.custody[i - 2]?.account_id ?? "its giver"}. Still sealed.` }
            : market && c.account_id === market
          ? { title: "Listed on the market", detail: `By ${from ?? "its holder"}. The market holds it in escrow, sealed.` }
          : market && from === market
            ? c.account_id === vault.custody[i - 2]?.account_id
              ? { title: `Back with ${to}`, detail: "Delisted, or the market refused the listing. Still sealed." }
              : { title: `Bought by ${to}`, detail: "From the market, which paid the seller after the vault moved." }
            : {
                title: `Transferred to ${to}`,
                detail: `From ${from ?? "an earlier holder"}. Nothing moved on Bitcoin, Base or Solana.`,
              };
      items.push({ key: `custody-${i}`, at, icon: Send, tone: "bg-gold/15 text-accent", title, detail });
    }
  });
  if (vault.state.kind === "opened") {
    items.push({
      key: "opened",
      at: nsToMs(vault.state.at_ns),
      icon: PackageOpen,
      tone: "bg-warn/15 text-warn",
      title: "Seal broken",
      detail: `By ${shortAccount(vault.state.by)}. The vault can't change hands from here on.`,
    });
  }
  for (const w of withdrawals) {
    const { chain, amount } = withdrawalAmount(w);
    items.push({
      key: `w-${w.index}`,
      at: nsToMs(w.requested_at_ns),
      icon: PenLine,
      tone: w.status === "failed" ? "bg-danger/10 text-danger" : "bg-gold/15 text-accent",
      title: `Withdrawal of ${formatAmount(chain, amount)} ${CHAIN_META[chain].unit}`,
      detail: w.status === "failed" ? "The signature failed. Nothing was sent." : `Signed by NEAR's MPC network on ${CHAIN_META[chain].name}.`,
    });
  }
  for (const o of observations ?? []) {
    for (const d of o.deposits) {
      items.push({
        key: `d-${d.txHash}`,
        at: d.at,
        icon: ArrowDownLeft,
        tone: "bg-raised text-fg-2",
        title: `Deposit on ${CHAIN_META[o.chain].name}`,
        detail: `+${formatAmount(o.chain, d.amount)} ${CHAIN_META[o.chain].unit}, ${d.confirmed ? "confirmed" : "pending"}. Observed.`,
      });
    }
  }
  items.sort((a, b) => b.at - a.at);

  return (
    <ol className="overflow-hidden rounded-panel border border-line bg-surface">
      {items.slice(0, 10).map((it, i) => {
        const Icon = it.icon;
        return (
          <li key={it.key} className={cn("flex items-start gap-3.5 px-5 py-4", i > 0 && "border-t border-line")}>
            <span aria-hidden className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-full", it.tone)}>
              <Icon className="size-[15px]" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium">{it.title}</p>
              <p className="mt-0.5 text-[13px] leading-relaxed text-fg-3">{it.detail}</p>
            </div>
            <time dateTime={new Date(it.at).toISOString()} className="shrink-0 whitespace-nowrap pt-0.5 text-[12.5px] text-fg-3">
              {now ? relativeTime(it.at, now) : ""}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
