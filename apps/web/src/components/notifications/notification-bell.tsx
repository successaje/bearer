"use client";

import type { AccountEvent } from "@bearer/sdk";
import { Popover } from "radix-ui";
import { Bell, ChevronRight, Wallet } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useWallet } from "@/components/wallet/wallet-provider";
import { formatNear, relativeTime } from "@/lib/vault/format";
import { useAccountActivity, useMarketBalances, useNow } from "@/lib/vault/hooks";
import { eventCopy, markSeen, setBrowserAlerts, useBrowserAlerts, useSeenAt } from "@/lib/vault/notifications";
import { cn } from "@/lib/utils";

/**
 * What other people did that concerns the connected account: a vault of theirs sold, or one handed
 * or scheduled to them. Read from the chain and NearBlocks' index once a minute, so nothing is sent
 * anywhere; browser alerts, if turned on, show only while a Bearer tab is open.
 */
export function NotificationBell() {
  const { accountId } = useWallet();
  const activity = useAccountActivity(accountId);
  const balances = useMarketBalances(accountId);
  const seenAt = useSeenAt(accountId);
  const alerts = useBrowserAlerts();
  const now = useNow(30_000);
  // Unread is judged against when the bell was last opened, frozen while it's open.
  const [openedSeenAt, setOpenedSeenAt] = useState<number | null>(null);

  const events = (activity.data?.events ?? []).filter((e) => e.byOthers);
  const claimable = BigInt(balances.data?.claimable ?? "0");
  const unread = events.filter((e) => e.atMs > seenAt).length + (claimable > 0n ? 1 : 0);
  useAlerts(activity.data ? events : null, alerts.on);

  if (!accountId) return null;
  const highlightAfter = openedSeenAt ?? seenAt;

  return (
    <Popover.Root
      onOpenChange={(open) => {
        if (open) {
          setOpenedSeenAt(seenAt);
          markSeen(accountId);
        } else setOpenedSeenAt(null);
      }}
    >
      <Popover.Trigger
        aria-label={unread ? `Notifications, ${unread} new` : "Notifications"}
        className="relative inline-flex size-9 items-center justify-center rounded-full border border-line-strong bg-surface-2 text-fg-2 transition-colors hover:bg-raised hover:text-fg data-[state=open]:bg-raised"
      >
        <Bell className="size-[17px]" />
        {unread ? (
          <span className="tabular absolute -right-1 -top-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-gold px-1 text-[10.5px] font-semibold text-ink ring-2 ring-bg">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="z-50 w-[min(380px,calc(100vw-24px))] overflow-hidden rounded-[14px] border border-line-strong bg-surface-2 shadow-lifted outline-none data-[state=open]:animate-panel-in"
        >
          <div className="flex items-center justify-between px-4 pb-2 pt-3.5">
            <p className="text-[14.5px] font-semibold">Notifications</p>
            <Popover.Close asChild>
              <Link href="/account" className="inline-flex items-center gap-0.5 text-[13px] text-accent hover:underline">
                Your account
                <ChevronRight className="size-3.5" />
              </Link>
            </Popover.Close>
          </div>

          {claimable > 0n ? (
            <Popover.Close asChild>
              <Link href="/account" className="mx-2 mb-1 flex items-start gap-3 rounded-[10px] bg-gold/10 px-3 py-2.5 hover:bg-gold/15">
                <Wallet className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                <span className="text-[13px] leading-snug">
                  <span className="font-medium">{formatNear(claimable, 4)} is waiting for you.</span>{" "}
                  <span className="text-fg-2">A payout couldn&apos;t be sent at the time. Claim it from your account.</span>
                </span>
              </Link>
            </Popover.Close>
          ) : null}

          <div className="max-h-[min(420px,60vh)] overflow-y-auto px-2 pb-2">
            {activity.isPending ? (
              <p className="px-2 py-4 text-[13px] text-fg-3">Reading NEAR testnet…</p>
            ) : activity.isError && !activity.data ? (
              <p className="px-2 py-4 text-[13px] text-fg-3">NearBlocks&apos; index is busy. This tries again in a minute.</p>
            ) : events.length ? (
              <ul>
                {events.slice(0, 8).map((e) => {
                  const { title, body } = eventCopy(e);
                  const fresh = e.atMs > highlightAfter;
                  return (
                    <li key={e.id}>
                      <Popover.Close asChild>
                        <Link href={`/v/${e.tokenId}`} className="flex gap-3 rounded-[10px] px-2.5 py-2.5 hover:bg-raised">
                          <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", fresh ? "bg-gold" : "bg-transparent")} />
                          <span className="min-w-0">
                            <span className="flex items-baseline justify-between gap-3">
                              <span className={cn("truncate text-[13.5px]", fresh ? "font-semibold" : "font-medium")}>{title}</span>
                              <span className="shrink-0 text-[11.5px] text-fg-3">{now ? relativeTime(e.atMs, now) : ""}</span>
                            </span>
                            <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-snug text-fg-2">{body}</span>
                          </span>
                        </Link>
                      </Popover.Close>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-2.5 py-4 text-[13px] leading-relaxed text-fg-3">
                Nothing yet. When someone buys a vault you listed, or hands or schedules one for you, it shows here.
              </p>
            )}
          </div>

          <div className="border-t border-line px-4 py-3">
            {alerts.supported ? (
              <label className="flex cursor-pointer items-center justify-between gap-3">
                <span className="text-[13px]">
                  Alert me in this browser
                  <span className="block text-[11.5px] text-fg-3">While a Bearer tab is open. Nothing is sent anywhere.</span>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={alerts.on}
                  onChange={(ev) => {
                    void setBrowserAlerts(ev.target.checked).then((ok) => {
                      if (!ok) toast.error("The browser didn't allow notifications. You can change that in its site settings.");
                    });
                  }}
                  className="peer sr-only"
                />
                <span
                  aria-hidden
                  className="relative h-5 w-9 shrink-0 rounded-full bg-raised ring-1 ring-line-strong transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-fg-3 after:transition-transform peer-checked:bg-gold peer-checked:ring-gold peer-checked:after:translate-x-4 peer-checked:after:bg-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
                />
              </label>
            ) : null}
            <p className={cn("text-[11.5px] text-fg-3", alerts.supported && "mt-2")}>
              Read from NEAR testnet and NearBlocks&apos; index, once a minute.
            </p>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Browser alerts for events that arrive while the page is open; never for what was there on load. */
function useAlerts(events: AccountEvent[] | null, on: boolean) {
  const known = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!events) return;
    if (known.current === null) {
      known.current = new Set(events.map((e) => e.id));
      return;
    }
    for (const e of events) {
      if (known.current.has(e.id)) continue;
      known.current.add(e.id);
      if (on && typeof Notification !== "undefined" && Notification.permission === "granted") {
        const { title, body } = eventCopy(e);
        new Notification(title, { body, tag: e.id });
      }
    }
  }, [events, on]);
}
