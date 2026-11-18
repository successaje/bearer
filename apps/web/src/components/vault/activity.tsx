"use client";

import type { ChainObservation, ChainTag, EscrowEvent, EscrowName, VaultView, Withdrawal } from "@bearer/sdk";
import {
  ArrowDownLeft,
  CalendarClock,
  Coins,
  ExternalLink,
  HandCoins,
  HeartPulse,
  Hourglass,
  PackageOpen,
  Pause,
  PenLine,
  Plus,
  Repeat,
  Send,
  Store,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { termText } from "@/components/lend/lend-bits";
import { formatWhen, nsToMsNumber } from "@/components/schedule/when";
import {
  IS_SIMULATED,
  LEND_CONTRACT,
  MARKET_CONTRACT,
  SCHEDULE_CONTRACT,
  STANDING_CONTRACT,
  SWITCH_CONTRACT,
  explorer,
} from "@/lib/config";
import { withdrawalAmount } from "@/lib/vault/report";
import { CHAIN_META, formatAmount, formatNear, nsToMs, relativeTime, shortAccount, truncateMiddle } from "@/lib/vault/format";
import { cn } from "@/lib/utils";

interface Item {
  key: string;
  at: number;
  icon: LucideIcon;
  tone: string;
  title: string;
  detail: string;
  /** Where to check it: the NEAR transaction, or the deposit on its chain's explorer. */
  href?: string | null;
}

/** How the escrow contracts' history read went. */
export type HistoryState = "loading" | "complete" | "partial" | "error";

const SHOWN = 10;
const MOVE = "bg-gold/15 text-accent";
const QUIET = "bg-raised text-fg-2";

const ESCROWS: { name: EscrowName; account: string | null; label: string; icon: LucideIcon }[] = [
  { name: "market", account: MARKET_CONTRACT, label: "market", icon: Store },
  { name: "schedule", account: SCHEDULE_CONTRACT, label: "schedule contract", icon: CalendarClock },
  { name: "lend", account: LEND_CONTRACT, label: "lending contract", icon: HandCoins },
  { name: "switch", account: SWITCH_CONTRACT, label: "switch", icon: Hourglass },
  { name: "standing", account: STANDING_CONTRACT, label: "standing-payments contract", icon: Repeat },
];
const escrowOf = (account: string | undefined) => ESCROWS.find((e) => e.account && e.account === account);

/** Events that move the vault into its escrow; the rest that move it, move it out. */
const INTO = new Set(["listed", "scheduled", "requested", "armed", "planned"]);
/** These don't move the vault, so they tell no step in the custody log. */
const STILL = new Set(["funded", "checked_in", "updated", "payout_failed", "stopped"]);
/** A record's time is the escrow's own, a block or so after the move it records. */
const RECORD_SLACK_NS = 60n * 1_000_000_000n;

/**
 * One timeline from the custody log, what the escrow contracts logged (prices, terms, dates),
 * withdrawals and observed deposits. A move into or out of an escrow is told by the escrow's own
 * event where there is one, and by the custody log alone where there isn't.
 */
export function Activity({
  vault,
  withdrawals,
  observations,
  history,
  now,
}: {
  vault: VaultView;
  withdrawals: Withdrawal[];
  observations: ChainObservation[] | undefined;
  history: { events: EscrowEvent[]; state: HistoryState };
  now: number;
}) {
  const [all, setAll] = useState(false);
  const items: Item[] = [];

  const moves = history.events.filter((e) => !STILL.has(e.event) && escrowItem(e));
  // A logged event carries its transfer's exact time; a record's is a moment later.
  const told = (escrow: EscrowName, into: boolean, ns: string) =>
    moves.some((e) => {
      if (e.escrow !== escrow || INTO.has(e.event) !== into) return false;
      if (e.from === "log") return e.at_ns === ns;
      const d = BigInt(e.at_ns) - BigInt(ns);
      return (d < 0n ? -d : d) <= RECORD_SLACK_NS;
    });

  const created = nsToMs(vault.created_at_ns);
  vault.custody.forEach((c, i) => {
    const at = nsToMs(c.since_ns);
    if (i === 0 && Math.abs(at - created) < 1000) {
      items.push({
        key: "created",
        at,
        icon: Plus,
        tone: QUIET,
        title: "Vault created",
        detail: `By ${shortAccount(c.account_id)}. Sealed.`,
      });
      return;
    }
    const into = escrowOf(c.account_id);
    const out = escrowOf(vault.custody[i - 1]?.account_id);
    if (into ? told(into.name, true, c.since_ns) : out && told(out.name, false, c.since_ns)) return;
    const { title, detail } = custodyStep(vault, i);
    items.push({ key: `custody-${i}`, at, icon: Send, tone: MOVE, title, detail });
  });

  history.events.forEach((e, i) => {
    const said = escrowItem(e);
    if (!said) return;
    items.push({
      key: `escrow-${e.escrow}-${e.event}-${e.at_ns}-${i}`,
      at: nsToMs(e.at_ns),
      ...said,
      href: e.tx && !IS_SIMULATED ? explorer.nearTx(e.tx) : null,
    });
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
  // A standing payment is a withdrawal of exactly the plan's amount to exactly its address.
  const plan = history.events.findLast((e) => e.escrow === "standing" && e.event === "planned")?.data;
  const isPayment = (to: string, amount: string) =>
    !!plan && typeof plan.to === "string" && plan.to.toLowerCase() === to.toLowerCase() && plan.amount === amount;
  for (const w of withdrawals) {
    const { chain, amount, to } = withdrawalAmount(w);
    const payment = isPayment(to, amount);
    items.push({
      key: `w-${w.index}`,
      at: nsToMs(w.requested_at_ns),
      icon: payment ? Repeat : PenLine,
      tone: w.status === "failed" ? "bg-danger/10 text-danger" : MOVE,
      title: `${payment ? "Standing payment" : "Withdrawal"} of ${formatAmount(chain, amount)} ${CHAIN_META[chain].unit}`,
      detail:
        w.status === "failed"
          ? "The signature failed. Nothing was sent."
          : payment
            ? `To ${truncateMiddle(to, 8, 6)}, collected by ${shortAccount(String(plan?.payee ?? "the payee"))}. Signed by NEAR's MPC network on ${CHAIN_META[chain].name}.`
            : `Signed by NEAR's MPC network on ${CHAIN_META[chain].name}.`,
    });
  }
  for (const o of observations ?? []) {
    for (const d of o.deposits) {
      items.push({
        key: `d-${d.txHash}`,
        at: d.at,
        icon: ArrowDownLeft,
        tone: QUIET,
        title: `Deposit on ${CHAIN_META[o.chain].name}`,
        detail: `+${formatAmount(o.chain, d.amount)} ${CHAIN_META[o.chain].unit}, ${d.confirmed ? "confirmed" : "pending"}. Observed.`,
        href: d.explorerUrl,
      });
    }
  }
  // Newest first; things logged in the same transaction keep their order, read bottom up.
  const ordered = items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => b.it.at - a.it.at || b.i - a.i)
    .map((x) => x.it);
  const shown = all ? ordered : ordered.slice(0, SHOWN);

  return (
    <div>
      <ol className="rounded-panel border-line bg-surface overflow-hidden border">
        {shown.map((it, i) => {
          const Icon = it.icon;
          return (
            <li key={it.key} className={cn("flex items-start gap-3.5 px-5 py-4", i > 0 && "border-line border-t")}>
              <span
                aria-hidden
                className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-full", it.tone)}
              >
                <Icon className="size-[15px]" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium [overflow-wrap:anywhere]">{it.title}</p>
                <p className="text-fg-3 mt-0.5 text-[13px] leading-relaxed [overflow-wrap:anywhere]">{it.detail}</p>
                {it.href ? (
                  <a
                    href={it.href}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent mt-1 inline-flex items-center gap-1 text-[12.5px] hover:underline"
                  >
                    {it.href.includes("nearblocks.io") ? "The transaction" : "On the explorer"}
                    <ExternalLink aria-hidden className="size-3" />
                  </a>
                ) : null}
              </div>
              <time
                dateTime={new Date(it.at).toISOString()}
                title={formatWhen(it.at)}
                className="text-fg-3 shrink-0 pt-0.5 text-[12.5px] whitespace-nowrap"
              >
                {now ? relativeTime(it.at, now) : ""}
              </time>
            </li>
          );
        })}
      </ol>
      {ordered.length > SHOWN ? (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="text-accent mt-3 text-[13.5px] font-medium hover:underline"
        >
          {all ? "Show the latest 10" : `Show all ${ordered.length}`}
        </button>
      ) : null}
      <p className="text-fg-3 mt-4 text-[12.5px] leading-relaxed">{sourceNote(history.state)}</p>
    </div>
  );
}

function sourceNote(state: HistoryState) {
  if (IS_SIMULATED) return "Simulated, like the rest of this demo.";
  switch (state) {
    case "loading":
      return "Reading prices and terms from the escrow contracts' logs…";
    case "complete":
      return "Moves come from the vault's custody log on NEAR testnet. Prices, terms and dates come from what the escrow contracts logged in the same transactions, found through NearBlocks' index and read from an archival node.";
    case "partial":
      return "NearBlocks' index didn't answer, so earlier sales, loans and schedules show without their prices and terms. Whatever escrow holds the vault now is read straight from its contract. This tries again in a minute.";
    case "error":
      return "The escrow contracts couldn't be read just now, so this shows the custody log alone.";
  }
}

/** A move told by the custody log alone: who held it before and after. */
function custodyStep(vault: VaultView, i: number): { title: string; detail: string } {
  const c = vault.custody[i];
  const prevId = vault.custody[i - 1]?.account_id;
  const before = vault.custody[i - 2]?.account_id;
  const from = prevId ? shortAccount(prevId) : undefined;
  const to = shortAccount(c.account_id);
  const into = escrowOf(c.account_id);
  const out = escrowOf(prevId);
  if (into) {
    const title = {
      market: "Listed on the market",
      schedule: "Scheduled for a handover",
      lend: "Pledged for a loan",
      switch: "Put in a switch",
      standing: "Set to pay regularly",
    }[into.name];
    return { title, detail: `By ${from ?? "its holder"}. The ${into.label} holds it, sealed.` };
  }
  if (out) {
    if (c.account_id === before) {
      const why = {
        market: "Delisted, or the market refused the listing.",
        schedule: "The schedule was cancelled, or refused.",
        lend: "The loan was repaid, or its request taken back.",
        switch: "Taken out of the switch.",
        standing: "Taken back before its first payment.",
      }[out.name];
      return { title: `Back with ${to}`, detail: `${why} Still sealed.` };
    }
    const giver = before ? shortAccount(before) : undefined;
    switch (out.name) {
      case "market":
        return {
          title: `Bought by ${to}`,
          detail: "From the market, which paid the seller after the vault moved. Still sealed.",
        };
      case "schedule":
        return { title: `Handed over to ${to}`, detail: `On schedule, from ${giver ?? "its giver"}. Still sealed.` };
      case "lend":
        return {
          title: `Taken by ${to}`,
          detail: `The lender, after ${giver ?? "the borrower"} didn't repay by the due date. Still sealed.`,
        };
      case "switch":
        return {
          title: `Passed on to ${to}`,
          detail: `${giver ?? "Its owner"} went quiet for a whole interval, so the switch handed it on. Still sealed.`,
        };
    }
  }
  return {
    title: `Transferred to ${to}`,
    detail: `From ${from ?? "an earlier holder"}. Nothing moved on Bitcoin, Base or Solana.`,
  };
}

/** What an escrow logged, in words. Null for an event this page doesn't know how to tell. */
function escrowItem(e: EscrowEvent): Pick<Item, "icon" | "tone" | "title" | "detail"> | null {
  const s = (k: string) => {
    const v = e.data[k];
    return typeof v === "string" ? v : null;
  };
  const who = (k: string) => shortAccount(s(k) ?? "someone");
  const near = (k: string) => (s(k) && /^\d+$/.test(s(k) as string) ? formatNear(s(k) as string) : "an amount");
  const when = (k: string) =>
    s(k) && /^\d+$/.test(s(k) as string) ? formatWhen(nsToMsNumber(s(k) as string)) : "its date";
  const span = (k: string) =>
    s(k) && /^\d+$/.test(s(k) as string) ? termText(nsToMsNumber(s(k) as string)) : "a set time";
  const meta = ESCROWS.find((x) => x.name === e.escrow);
  const icon = meta?.icon ?? Send;

  if (e.event === "returned") {
    return {
      icon,
      tone: MOVE,
      title: `Sent back to ${who("to")}`,
      detail: `It reached the ${meta?.label ?? "contract"} without terms, so it was sent straight back. Still sealed.`,
    };
  }
  if (e.event === "payout_failed") {
    return {
      icon: TriangleAlert,
      tone: "bg-warn/15 text-warn",
      title: `A payment to ${who("account_id")} bounced`,
      detail: `${near("amount")} waits in the ${meta?.label ?? "contract"} for them to claim.`,
    };
  }

  switch (`${e.escrow}:${e.event}`) {
    case "market:listed":
      return {
        icon,
        tone: MOVE,
        title: `Listed for ${near("price")}`,
        detail: `By ${who("seller")}. The market holds it, sealed, until someone pays exactly that or ${who("seller")} takes it back.`,
      };
    case "market:sold":
      return {
        icon,
        tone: MOVE,
        title: `Bought by ${who("buyer")} for ${near("price")}`,
        detail: `From ${who("seller")}. The market paid ${who("seller")} once the vault had moved, with their listing deposit back. Still sealed.`,
      };
    case "market:delisted":
      return { icon, tone: MOVE, title: `Back with ${who("seller")}`, detail: "Taken off the market. Still sealed." };

    case "schedule:scheduled":
      return {
        icon,
        tone: MOVE,
        title: `Scheduled for ${who("recipient")}`,
        detail: `By ${who("giver")}, to hand over on ${when("release_at_ns")}. ${e.data.cancellable === true ? `${who("giver")} could cancel before then.` : "Set so nobody can cancel it."} Held, sealed, until then.`,
      };
    case "schedule:released":
      return {
        icon,
        tone: MOVE,
        title: `Handed over to ${who("recipient")}`,
        detail: `On schedule, from ${who("giver")}. Still sealed.`,
      };
    case "schedule:cancelled":
      return {
        icon,
        tone: MOVE,
        title: `Back with ${who("giver")}`,
        detail: "The handover was cancelled before its date. Still sealed.",
      };

    case "lend:requested":
      return {
        icon,
        tone: MOVE,
        title: `Pledged for a ${near("principal")} loan`,
        detail: `By ${who("borrower")}, to repay ${near("repayment")} within ${span("term_ns")} of being lent. Held, sealed, until then.`,
      };
    case "lend:funded":
      return {
        icon: Coins,
        tone: QUIET,
        title: `Lent ${near("principal")} by ${who("lender")}`,
        detail: `Paid straight to ${who("borrower")}. Repaying ${near("repayment")} before ${when("due_at_ns")} gets the vault back; from then on, ${who("lender")} can take it.`,
      };
    case "lend:repaid":
      return {
        icon,
        tone: MOVE,
        title: `Repaid. Back with ${who("borrower")}`,
        detail: `${who("borrower")} paid back ${near("repayment")}, which went to ${who("lender")}. Still sealed.`,
      };
    case "lend:foreclosed":
      return {
        icon,
        tone: MOVE,
        title: `Taken by ${who("lender")}`,
        detail: `The lender, after ${who("borrower")} didn't repay by the due date. Still sealed.`,
      };
    case "lend:cancelled":
      return {
        icon,
        tone: MOVE,
        title: `Back with ${who("borrower")}`,
        detail: "The loan request was taken back before anyone lent. Still sealed.",
      };

    case "switch:armed":
      return {
        icon,
        tone: MOVE,
        title: `Put in a switch for ${who("beneficiary")}`,
        detail: `By ${who("owner")}. If ${who("owner")} goes ${span("interval_ns")} without checking in, it goes to ${who("beneficiary")}. Held, sealed, meanwhile.`,
      };
    case "switch:checked_in":
      return {
        icon: HeartPulse,
        tone: QUIET,
        title: `${who("owner")} checked in`,
        detail: `${e.from === "record" ? "Their latest sign of life: the switch keeps only the latest. " : ""}Without another, it can be handed to the beneficiary from ${when("due_at_ns")}.`,
      };
    case "switch:updated":
      return {
        icon: HeartPulse,
        tone: QUIET,
        title: "Switch changed",
        detail: `${who("owner")} named ${who("beneficiary")}, with ${span("interval_ns")} of silence before it goes to them. A change counts as a check-in.`,
      };
    case "switch:released":
      return {
        icon,
        tone: MOVE,
        title: `Passed on to ${who("beneficiary")}`,
        detail: `${who("owner")} went quiet for a whole interval, so the switch handed it on. Still sealed.`,
      };
    case "switch:taken_back":
      return { icon, tone: MOVE, title: `Back with ${who("owner")}`, detail: "Taken out of the switch. Still sealed." };

    case "standing:planned": {
      const chain = (["btc", "evm", "sol"] as const).find((c) => c === s("chain")) as ChainTag | undefined;
      const each = chain && s("amount") && /^\d+$/.test(s("amount") as string) ? `${formatAmount(chain, s("amount") as string)} ${CHAIN_META[chain].unit}` : "an amount";
      const count = typeof e.data.max_payments === "number" ? `, ${e.data.max_payments} payments in all` : ", until stopped";
      return {
        icon,
        tone: MOVE,
        title: `Set to pay ${who("payee")}`,
        detail: `By ${who("giver")}: ${each} to ${truncateMiddle(s("to") ?? "an address", 8, 6)} every ${span("interval_ns")}, from ${when("first_due_ns")}${count}. ${e.data.cancellable === true ? `${who("giver")} can stop it.` : "Set so nobody can stop it."} The first payment breaks the seal, and the vault stays with the contract from then on.`,
      };
    }
    case "standing:stopped":
      return {
        icon: Pause,
        tone: QUIET,
        title: `${who("giver")} stopped the payments`,
        detail: `Nothing more falls due. The vault stays with the contract, and ${who("giver")} can withdraw through it.`,
      };
    case "standing:taken_back":
      return { icon, tone: MOVE, title: `Back with ${who("giver")}`, detail: "Taken back before its first payment. Still sealed." };
  }
  return null;
}
