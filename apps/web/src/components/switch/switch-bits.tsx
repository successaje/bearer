"use client";

import type { VaultSwitch } from "@bearer/sdk";
import { switchDueMs } from "@bearer/sdk";
import { nsToMsNumber } from "@/components/schedule/when";
import { EscrowLock } from "@/components/vault/escrow-lock";
import { SWITCH_CONTRACT } from "@/lib/config";
import { useSwitchFacts } from "@/lib/vault/hooks";

export { termText as intervalText } from "@/components/lend/lend-bits";

/** The switch account's lock state, read from the chain. */
export function SwitchLock({ compact = false }: { compact?: boolean }) {
  const facts = useSwitchFacts();
  if (!SWITCH_CONTRACT) return null;
  return <EscrowLock name="Switch" account={SWITCH_CONTRACT} holds="a vault in it" facts={facts.data} compact={compact} />;
}

export const intervalMs = (s: VaultSwitch) => nsToMsNumber(s.interval_ns);
export const lastCheckInMs = (s: VaultSwitch) => nsToMsNumber(s.last_check_in_ns);
export const dueMs = (s: VaultSwitch) => switchDueMs(s);

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
/** The first is short so the whole thing can be tried in one sitting. */
export const INTERVALS = [10 * MIN, 30 * DAY, 182 * DAY, 365 * DAY, 730 * DAY];
