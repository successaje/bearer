import type { AccountEvent, EscrowEvent, EscrowName, HandoverSchedule, MarketListing, VaultLoan, VaultSwitch, VaultView } from "./types";

const nsToMs = (ns: string) => Number(BigInt(ns) / 1_000_000n);

/**
 * Reads one vault's custody log as the events that concern `me`. The log is on-chain and lists
 * every holder in order (up to its cap), so a sale shows as seller → market → buyer, a
 * scheduled handover as giver → schedule → recipient, a loan as borrower → lend → borrower
 * (repaid) or lender (foreclosed), and a switch as owner → switch → owner (taken back) or
 * beneficiary (released). Prices and payouts aren't in the log.
 */
export function custodyEvents(
  vault: VaultView,
  me: string,
  marketId: string | null,
  scheduleId: string | null,
  lendId: string | null = null,
  switchId: string | null = null,
): AccountEvent[] {
  const c = vault.custody;
  const out: AccountEvent[] = [];
  const push = (kind: AccountEvent["kind"], i: number, counterparty: string | null, byOthers: boolean) =>
    out.push({ id: `${kind}:${vault.token_id}:${c[i].since_ns}`, kind, tokenId: vault.token_id, atMs: nsToMs(c[i].since_ns), counterparty, byOthers });
  for (let i = 1; i < c.length; i++) {
    const from = c[i - 1].account_id;
    const to = c[i].account_id;
    const before = c[i - 2]?.account_id ?? null;
    const escrow = from === marketId || from === scheduleId || (!!lendId && from === lendId) || (!!switchId && from === switchId);
    if (to === me && escrow && before === me) push("returned", i, null, false);
    else if (to === me && from === marketId) push("bought", i, before, false);
    else if (to === me && from === scheduleId) push("delivered", i, before, true);
    else if (to === me && lendId && from === lendId) push("collected", i, before, false);
    else if (to === me && switchId && from === switchId) push("inherited", i, before, true);
    else if (to === me && from !== me) push("received", i, from, true);
    else if (from === marketId && before === me && to !== me) push("sold", i, to, true);
    else if (lendId && from === lendId && before === me && to !== me) push("foreclosed", i, to, true);
    else if (switchId && from === switchId && before === me && to !== me) push("passed_on", i, to, true);
    else if (from === me && to === marketId) push("listed", i, null, false);
    else if (from === me && to === scheduleId) push("scheduled", i, null, false);
    else if (lendId && from === me && to === lendId) push("pledged", i, null, false);
    else if (switchId && from === me && to === switchId) push("armed", i, null, false);
    else if (from === me && to !== me) push("sent", i, to, false);
  }
  return out;
}

/* ---------- one vault's history ---------- */

/** Which escrow logged it, by contract account. */
export type EscrowAccounts = Partial<Record<EscrowName, string | null>>;

/** Only what a receipt outcome needs to have for its logs to be read. */
export interface LoggedOutcome {
  executor_id: string;
  logs: string[];
}

/**
 * The escrow events in one transaction's logs that concern this vault. Only the configured escrow
 * contracts count, so a look-alike contract logging the same event names is ignored. A payout that
 * bounced names an account, not a vault, so it's kept only when the same transaction logged
 * something about this vault.
 */
export function escrowEventsInLogs(
  outcomes: LoggedOutcome[],
  tokenId: string,
  escrows: EscrowAccounts,
  atNs: string,
  tx: string,
): EscrowEvent[] {
  const byAccount = new Map<string, EscrowName>();
  for (const [name, account] of Object.entries(escrows)) if (account) byAccount.set(account, name as EscrowName);
  const found: EscrowEvent[] = [];
  const bounced: EscrowEvent[] = [];
  for (const o of outcomes) {
    const escrow = byAccount.get(o.executor_id);
    if (!escrow) continue;
    for (const log of o.logs) {
      if (!log.startsWith("EVENT_JSON:")) continue;
      let parsed: { event?: unknown; data?: unknown };
      try {
        parsed = JSON.parse(log.slice("EVENT_JSON:".length));
      } catch {
        continue;
      }
      if (typeof parsed.event !== "string" || !Array.isArray(parsed.data)) continue;
      for (const d of parsed.data) {
        if (!d || typeof d !== "object") continue;
        const data = d as Record<string, unknown>;
        const e: EscrowEvent = { escrow, event: parsed.event, data, at_ns: atNs, from: "log", tx };
        if (data.token_id === tokenId) found.push(e);
        else if (parsed.event === "payout_failed") bounced.push(e);
      }
    }
  }
  return found.length ? [...found, ...bounced] : [];
}

/**
 * What the escrows' current records say about the vault one of them holds, as events. Funding a
 * loan and checking in to a switch don't move the vault, so they're in no transfer of it; the
 * record is where they're kept. A loan is funded exactly one term before it's due. A switch keeps
 * only its owner's latest sign of life (a check-in or a change), so that's the one check-in here.
 */
export function recordEvents(r: {
  listing?: MarketListing | null;
  schedule?: HandoverSchedule | null;
  loan?: VaultLoan | null;
  switch?: VaultSwitch | null;
}): EscrowEvent[] {
  const out: EscrowEvent[] = [];
  const add = (escrow: EscrowName, event: string, at_ns: string, data: Record<string, unknown>) => out.push({ escrow, event, data, at_ns, from: "record", tx: null });
  const { listing: l, schedule: s, loan, switch: w } = r;
  if (l) add("market", "listed", l.listed_at_ns, { token_id: l.token_id, seller: l.seller, price: l.price });
  if (s) {
    add("schedule", "scheduled", s.scheduled_at_ns, {
      token_id: s.token_id,
      giver: s.giver,
      recipient: s.recipient,
      release_at_ns: s.release_at_ns,
      cancellable: s.cancellable,
    });
  }
  if (loan) {
    add("lend", "requested", loan.requested_at_ns, {
      token_id: loan.token_id,
      borrower: loan.borrower,
      principal: loan.principal,
      repayment: loan.repayment,
      term_ns: loan.term_ns,
    });
    if ("lender" in loan.state) {
      const funded = BigInt(loan.state.due_at_ns) - BigInt(loan.term_ns);
      add("lend", "funded", funded.toString(), {
        token_id: loan.token_id,
        borrower: loan.borrower,
        lender: loan.state.lender,
        principal: loan.principal,
        repayment: loan.repayment,
        due_at_ns: loan.state.due_at_ns,
      });
    }
  }
  if (w) {
    const due = (BigInt(w.armed_at_ns) + BigInt(w.interval_ns)).toString();
    add("switch", "armed", w.armed_at_ns, { token_id: w.token_id, owner: w.owner, beneficiary: w.beneficiary, interval_ns: w.interval_ns, due_at_ns: due });
    if (BigInt(w.last_check_in_ns) > BigInt(w.armed_at_ns)) {
      const next = (BigInt(w.last_check_in_ns) + BigInt(w.interval_ns)).toString();
      add("switch", "checked_in", w.last_check_in_ns, { token_id: w.token_id, owner: w.owner, due_at_ns: next });
    }
  }
  return out;
}

/** Within this of each other, a record's event and a logged one are the same event. */
const SAME_EVENT_NS = 60n * 1_000_000_000n;

/**
 * The logged events plus whatever the records add, oldest first. A record's event that a log
 * already has (the same escrow and event, within a minute) is dropped: the log is what happened at
 * the time, while the record may have changed since (a switch's beneficiary, say).
 */
export function mergeHistory(logged: EscrowEvent[], record: EscrowEvent[]): EscrowEvent[] {
  const near = (a: string, b: string) => {
    const d = BigInt(a) - BigInt(b);
    return (d < 0n ? -d : d) <= SAME_EVENT_NS;
  };
  const extra = record.filter((r) => !logged.some((l) => l.escrow === r.escrow && l.event === r.event && near(l.at_ns, r.at_ns)));
  return [...logged, ...extra]
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const d = BigInt(a.e.at_ns) - BigInt(b.e.at_ns);
      return d < 0n ? -1 : d > 0n ? 1 : a.i - b.i;
    })
    .map((x) => x.e);
}
