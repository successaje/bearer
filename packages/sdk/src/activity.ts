import type { AccountEvent, VaultView } from "./types";

const nsToMs = (ns: string) => Number(BigInt(ns) / 1_000_000n);

/**
 * Reads one vault's custody log as the events that concern `me`. The log is on-chain and lists
 * every holder in order (up to its cap), so a sale shows as seller → market → buyer and a
 * scheduled handover as giver → schedule → recipient. Prices and payouts aren't in the log.
 */
export function custodyEvents(vault: VaultView, me: string, marketId: string | null, scheduleId: string | null): AccountEvent[] {
  const c = vault.custody;
  const out: AccountEvent[] = [];
  const push = (kind: AccountEvent["kind"], i: number, counterparty: string | null, byOthers: boolean) =>
    out.push({ id: `${kind}:${vault.token_id}:${c[i].since_ns}`, kind, tokenId: vault.token_id, atMs: nsToMs(c[i].since_ns), counterparty, byOthers });
  for (let i = 1; i < c.length; i++) {
    const from = c[i - 1].account_id;
    const to = c[i].account_id;
    const before = c[i - 2]?.account_id ?? null;
    const escrow = from === marketId || from === scheduleId;
    if (to === me && escrow && before === me) push("returned", i, null, false);
    else if (to === me && from === marketId) push("bought", i, before, false);
    else if (to === me && from === scheduleId) push("delivered", i, before, true);
    else if (to === me && from !== me) push("received", i, from, true);
    else if (from === marketId && before === me && to !== me) push("sold", i, to, true);
    else if (from === me && to === marketId) push("listed", i, null, false);
    else if (from === me && to === scheduleId) push("scheduled", i, null, false);
    else if (from === me && to !== me) push("sent", i, to, false);
  }
  return out;
}
