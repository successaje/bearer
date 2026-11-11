"use client";

import type { AccountEvent } from "@bearer/sdk";
import { useSyncExternalStore } from "react";
import { formatWhen } from "@/components/schedule/when";
import { formatNear, vaultNumber } from "./format";

/** What one event says, in the bell, on the account page and in a browser alert. */
export function eventCopy(e: AccountEvent): { title: string; body: string } {
  const no = `Vault ${vaultNumber(e.tokenId)}`;
  const own = `vault ${vaultNumber(e.tokenId)}`;
  switch (e.kind) {
    case "sold":
      return {
        title: `${no} sold`,
        body: [
          `${e.counterparty} bought it${e.priceYocto ? ` for ${formatNear(e.priceYocto, 4)}` : ""}.`,
          e.paidYocto ? `The market paid you ${formatNear(e.paidYocto, 4)}, the price plus your listing deposit back.` : "The payout hasn't shown up in the index yet.",
        ].join(" "),
      };
    case "received":
      return { title: `${no} is yours`, body: `${e.counterparty} handed it to you, still sealed.` };
    case "delivered":
      return { title: `${no} arrived on schedule`, body: `From ${e.counterparty}. It's yours now, still sealed.` };
    case "scheduled_for_you":
      return {
        title: "A vault is coming to you",
        body: `${e.counterparty} scheduled ${own} for you, on or after ${e.releaseAtMs ? formatWhen(e.releaseAtMs) : "its date"}.`,
      };
    case "foreclosed":
      return { title: `${no} went to ${e.counterparty}`, body: "It wasn't repaid by its due date, so the lender took it, still sealed." };
    case "bought":
      return { title: `You bought ${own}`, body: `From ${e.counterparty ?? "its seller"}, on the market.` };
    case "returned":
      return { title: `${no} is back with you`, body: "Delisted, its schedule cancelled, or its loan repaid or taken back. Still sealed." };
    case "listed":
      return { title: `You listed ${own}`, body: "The market holds it, sealed, until it sells or you delist it." };
    case "scheduled":
      return { title: `You scheduled ${own}`, body: "The schedule holds it, sealed, until its date." };
    case "pledged":
      return { title: `You pledged ${own} for a loan`, body: "The lending contract holds it, sealed, until the loan ends." };
    case "collected":
      return { title: `You took ${own}`, body: `${e.counterparty ?? "The borrower"} didn't repay by the due date. It's yours now, still sealed.` };
    case "sent":
      return { title: `You handed ${own} to ${e.counterparty}`, body: "Nothing moved on Bitcoin, Base or Solana." };
  }
}

/* Per-browser conveniences, kept in localStorage: when the bell was last opened, and browser alerts. */

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function subscribe(l: () => void) {
  listeners.add(l);
  window.addEventListener("storage", l);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", l);
  };
}

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: it only lasts this page.
  }
  emit();
}

const seenKey = (account: string) => `bearer:seen:${account}`;
const ALERTS_KEY = "bearer:browser-alerts";

/** When this account last opened the bell, in ms; 0 if never (or on the server). */
export function useSeenAt(account: string | null) {
  return useSyncExternalStore(subscribe, () => (account ? Number(read(seenKey(account)) ?? 0) : 0), () => 0);
}

export function markSeen(account: string) {
  write(seenKey(account), String(Date.now()));
}

/** Whether to alert in this browser, and whether the browser lets us. */
export function useBrowserAlerts() {
  const on = useSyncExternalStore(subscribe, () => read(ALERTS_KEY) === "1", () => false);
  const supported = useSyncExternalStore(subscribe, () => typeof Notification !== "undefined", () => false);
  return { on, supported };
}

export async function setBrowserAlerts(on: boolean) {
  if (on && typeof Notification !== "undefined" && Notification.permission !== "granted") {
    const answer = await Notification.requestPermission();
    if (answer !== "granted") return false;
  }
  write(ALERTS_KEY, on ? "1" : "0");
  return true;
}
