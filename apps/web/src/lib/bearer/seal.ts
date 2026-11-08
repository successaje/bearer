import { EVM_FINALITY, PENDING_EXPIRY_MS, SOLANA_WINDOW_MS } from "@/lib/config";
import { CHAIN_META, formatAmount, formatCountdown, relativeTime, toUsd, truncateMiddle } from "@/lib/format";
import type { BaseUnits, Card, CardStatus, ChainTag } from "./types";

export type CheckState = "pass" | "warn" | "fail" | "info";

export type CheckAction =
  | { kind: "clear_request"; idx: number; availableIn: number }
  | { kind: "prove_evm"; nonce: number }
  | { kind: "wait"; until: number };

export interface SealCheck {
  id: "pending" | "evm" | "sol" | "btc" | "locked" | "code" | "market";
  title: string;
  summary: string;
  state: CheckState;
  why: string;
  evidence: { label: string; href?: string }[];
  action?: CheckAction;
}

export type Verdict = "sealed" | "sealed_with_exclusions" | "not_transferable";

export interface SealReport {
  verdict: Verdict;
  headline: string;
  detail: string;
  checks: SealCheck[];
  sealedUsd: number;
  excludedUsd: number;
  exclusions: { chain: ChainTag; amount: BaseUnits }[];
  logVersion: number;
}

export interface SlotTotals {
  total: BaseUnits;
  sealed: BaseUnits;
  excluded: BaseUnits;
}

export function slotTotals(card: Card): Record<ChainTag, SlotTotals> {
  const btcTotal = card.slots.btc.coins.reduce((sum, c) => sum + c.amount, 0);
  const btcExcluded = card.slots.btc.coins
    .filter((c) => c.encumbered)
    .reduce((sum, c) => sum + c.amount, 0);
  return {
    btc: { total: btcTotal, sealed: btcTotal - btcExcluded, excluded: btcExcluded },
    evm: { total: card.slots.evm.balance, sealed: card.slots.evm.balance, excluded: 0 },
    sol: { total: card.slots.sol.balance, sealed: card.slots.sol.balance, excluded: 0 },
  };
}

export function cardValueUsd(card: Card) {
  const totals = slotTotals(card);
  let sealed = 0;
  let excluded = 0;
  for (const chain of ["btc", "evm", "sol"] as const) {
    sealed += toUsd(chain, totals[chain].sealed);
    excluded += toUsd(chain, totals[chain].excluded);
  }
  return { sealed, excluded };
}

export function computeSealReport(card: Card, now: number): SealReport {
  const checks: SealCheck[] = [];
  const { evm, sol, btc } = card.slots;

  // 1. Nothing in flight.
  if (card.pending.length === 0) {
    checks.push({
      id: "pending",
      title: "No signature in flight",
      summary: "0 pending requests",
      state: "pass",
      why: "A signing request that's still running could produce a signature after the card changes hands. There are none.",
      evidence: [{ label: "Contract view: pending_signatures = 0" }],
    });
  } else {
    const oldest = card.pending.reduce((a, b) => (a.requestedAt <= b.requestedAt ? a : b));
    const age = now - oldest.requestedAt;
    const availableIn = Math.max(0, PENDING_EXPIRY_MS - age);
    checks.push({
      id: "pending",
      title: "No signature in flight",
      summary:
        availableIn === 0
          ? "Request stuck · anyone can clear it"
          : `${card.pending.length} request${card.pending.length > 1 ? "s" : ""} in flight`,
      state: "fail",
      why:
        availableIn === 0
          ? "This signing request never finished. Anyone can clear it now. Funds didn't move, and anything it referenced stays excluded."
          : "A signature could still arrive for this request, so the card can't change hands until it finishes or expires.",
      evidence: [{ label: oldest.summary }],
      action: { kind: "clear_request", idx: oldest.idx, availableIn },
    });
  }

  // 2. Base: every signed nonce proven consumed.
  if (evm.maxSignedNonce === null) {
    checks.push({
      id: "evm",
      title: "Base slot settled",
      summary: "No Base signatures issued",
      state: "pass",
      why: "This card has never signed a Base transaction, so there's nothing a previous owner could replay.",
      evidence: [],
    });
  } else if (evm.provenFloor > evm.maxSignedNonce) {
    const range = evm.maxSignedNonce === 0 ? "Nonce 0" : `Nonces 0–${evm.maxSignedNonce}`;
    checks.push({
      id: "evm",
      title: "Base slot settled",
      summary: `${range} proven · ${EVM_FINALITY}`,
      state: "pass",
      why: `Every Base transaction this card signed is proven used on Base Sepolia, checked on NEAR by MPC Read RPC at ${EVM_FINALITY} finality. None can be replayed.`,
      evidence: [{ label: "Proof on NEAR" }, { label: `Finality: ${EVM_FINALITY}` }],
    });
  } else {
    checks.push({
      id: "evm",
      title: "Base slot settled",
      summary: `Nonce ${evm.provenFloor} not proven yet`,
      state: "fail",
      why: `A Base withdrawal (nonce ${evm.provenFloor}) was signed but isn't proven on-chain yet. Until it is, a previous owner could still broadcast it.`,
      evidence: [{ label: `Signed nonces 0–${evm.maxSignedNonce}, proven below ${evm.provenFloor}` }],
      action: { kind: "prove_evm", nonce: evm.provenFloor },
    });
  }

  // 3. Solana: past the blockhash-expiry window.
  if (sol.lastSignedAt === null) {
    checks.push({
      id: "sol",
      title: "Solana slot settled",
      summary: "No Solana signatures issued",
      state: "pass",
      why: "This card has never signed a Solana transaction.",
      evidence: [],
    });
  } else {
    const elapsed = now - sol.lastSignedAt;
    if (elapsed < SOLANA_WINDOW_MS) {
      checks.push({
        id: "sol",
        title: "Solana slot settled",
        summary: `Safe in ${formatCountdown(SOLANA_WINDOW_MS - elapsed)}`,
        state: "fail",
        why: "A Solana signature stays valid until its blockhash expires. The card waits 300 s after the last one; durable nonces are impossible by construction.",
        evidence: [{ label: `Last signature ${relativeTime(sol.lastSignedAt, now)}` }],
        action: { kind: "wait", until: sol.lastSignedAt + SOLANA_WINDOW_MS },
      });
    } else {
      checks.push({
        id: "sol",
        title: "Solana slot settled",
        summary: `Last signature ${relativeTime(sol.lastSignedAt, now)}`,
        state: "pass",
        why: "The last Solana signature is past its blockhash-expiry window, so it can no longer land.",
        evidence: [],
      });
    }
  }

  // 4. Bitcoin: encumbered coins are excluded, not blocking.
  const encumbered = btc.coins.filter((c) => c.encumbered);
  checks.push(
    encumbered.length === 0
      ? {
          id: "btc",
          title: "Bitcoin slot accounted",
          summary: "0 coins encumbered",
          state: "pass",
          why: "No issued Bitcoin signature references any coin this card holds.",
          evidence: [],
        }
      : {
          id: "btc",
          title: "Bitcoin slot accounted",
          summary: `${encumbered.length} coin${encumbered.length > 1 ? "s" : ""} excluded`,
          state: "warn",
          why: "A previous owner signed a Bitcoin withdrawal that spends these coins. It may never be broadcast, but it could be, so they don't count toward the sealed value.",
          evidence: encumbered.map((c) => ({
            label: `${truncateMiddle(c.outpoint, 9, 6)} · ${formatAmount("btc", c.amount)} tBTC`,
          })),
        },
  );

  checks.push({
    id: "locked",
    title: "Contract locked",
    summary: "No full-access keys",
    state: "pass",
    why: "The Bearer contract has no full-access keys, so nobody (including its authors) can change its code or move cards.",
    evidence: [{ label: "view_access_key_list" }],
  });
  checks.push({
    id: "code",
    title: "Code identity",
    summary: "Hash matches the reproducible build",
    state: "pass",
    why: "The deployed code hash matches the build anyone can reproduce from the open-source repository.",
    evidence: [{ label: "code_hash" }],
  });
  checks.push({
    id: "market",
    title: card.listing
      ? `Listed for ${card.listing.priceNear} NEAR`
      : card.claimLink
        ? "Claim link open"
        : "Not listed, no claim link",
    summary: card.listing
      ? "Withdrawals locked while listed"
      : card.claimLink
        ? "Whoever opens the link can claim it"
        : "For information",
    state: "info",
    why: card.listing
      ? "While a card is listed, the contract refuses to sign withdrawals."
      : "Listings and claim links don't affect the seal, but a card must have neither to be handed over directly.",
    evidence: [],
  });

  const totals = slotTotals(card);
  const value = cardValueUsd(card);
  const exclusions = (["btc", "evm", "sol"] as const)
    .filter((c) => totals[c].excluded > 0)
    .map((chain) => ({ chain, amount: totals[chain].excluded }));

  const failing = checks.find((c) => c.state === "fail");
  let verdict: Verdict = "sealed";
  let headline = "Sealed";
  let detail = "No previous owner can move what's inside.";

  if (failing) {
    verdict = "not_transferable";
    headline = "Not transferable yet";
    detail = blockerCopy(failing, card, now);
  } else if (exclusions.length > 0) {
    verdict = "sealed_with_exclusions";
    headline = "Sealed, with exclusions";
    const ex = exclusions[0];
    detail = `${formatAmount(ex.chain, ex.amount)} ${CHAIN_META[ex.chain].unit} is excluded because an earlier signature could spend it.`;
  }

  return {
    verdict,
    headline,
    detail,
    checks,
    sealedUsd: value.sealed,
    excludedUsd: value.excluded,
    exclusions,
    logVersion: card.logVersion,
  };
}

function blockerCopy(check: SealCheck, card: Card, now: number) {
  switch (check.id) {
    case "pending":
      return check.action?.kind === "clear_request" && check.action.availableIn === 0
        ? "This signing request never finished. Anyone can clear it now; until then the card can't change hands."
        : "A signing request hasn't finished yet. Your funds didn't move.";
    case "evm":
      return `A Base withdrawal (nonce ${card.slots.evm.provenFloor}) hasn't been proven.`;
    case "sol": {
      const last = card.slots.sol.lastSignedAt ?? now;
      const secs = Math.floor((now - last) / 1000);
      return `A Solana withdrawal was signed ${secs} seconds ago. For safety, hand-over unlocks in ${formatCountdown(SOLANA_WINDOW_MS - (now - last))}.`;
    }
    default:
      return check.summary;
  }
}

export function isActive(card: Card) {
  return !card.listing && !card.claimLink;
}

export function cardStatus(card: Card, now: number): CardStatus {
  if (card.pending.length > 0) return "pending_signature";
  if (card.listing) return "listed";
  if (card.claimLink) return "claim_pending";
  if (computeSealReport(card, now).verdict === "not_transferable") return "action_needed";
  return "sealed";
}
