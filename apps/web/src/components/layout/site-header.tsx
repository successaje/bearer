"use client";

import { Dialog } from "radix-ui";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState } from "react";
import { Logo } from "@/components/brand/logo";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { ThemeMenu } from "@/components/theme/theme-controls";
import { WalletButton } from "@/components/wallet/wallet-button";
import { IS_SIMULATED } from "@/lib/config";
import { cn } from "@/lib/utils";

export const NAV_LINKS = [
  { href: "/vaults", label: "My vaults" },
  { href: "/market", label: "Market" },
  { href: "/verify", label: "Verify" },
  { href: "/how", label: "How it works" },
  { href: "/proof", label: "Proof" },
] as const;

function NetworkPill({ className }: { className?: string }) {
  return (
    <span
      title={IS_SIMULATED ? "Running on simulated chains. Nothing here is real." : "NEAR testnet"}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border border-warn/35 bg-warn/10 px-2.5 text-[12px] font-medium text-warn",
        className,
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-warn" />
      Testnet
      {IS_SIMULATED ? <span className="hidden font-normal opacity-80 lg:inline">· simulated</span> : null}
    </span>
  );
}

function NavLinkItems({ active, onNavigate }: { active: string | null; onNavigate?: () => void }) {
  return NAV_LINKS.map((link) => {
    const isActive = active !== null && (active === link.href || active.startsWith(`${link.href}/`));
    return (
      <Link
        key={link.href}
        href={link.href}
        onClick={onNavigate}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "rounded-[8px] px-3 py-2 text-[14px] text-fg-2 transition-colors hover:text-fg",
          isActive && "bg-raised text-fg",
        )}
      >
        {link.label}
      </Link>
    );
  });
}

function ActiveNavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return <NavLinkItems active={pathname} onNavigate={onNavigate} />;
}

/** usePathname suspends on routes with unknown params (cacheComponents), so it gets its own boundary. */
function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Suspense fallback={<NavLinkItems active={null} />}>
      <ActiveNavLinks onNavigate={onNavigate} />
    </Suspense>
  );
}

function MobileMenu() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        aria-label="Open menu"
        className="inline-flex size-10 items-center justify-center rounded-control text-fg-2 hover:bg-raised hover:text-fg md:hidden"
      >
        <Menu className="size-5" />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay data-[state=open]:animate-fade-in" />
        <Dialog.Content className="fixed inset-x-0 top-0 z-50 border-b border-line-strong bg-surface-2 px-5 pb-6 pt-3 shadow-lifted outline-none data-[state=open]:animate-fade-in">
          <div className="flex h-12 items-center justify-between">
            <Dialog.Title className="sr-only">Menu</Dialog.Title>
            <Dialog.Description className="sr-only">Site navigation</Dialog.Description>
            <Logo />
            <Dialog.Close
              aria-label="Close menu"
              className="inline-flex size-10 items-center justify-center rounded-control text-fg-2 hover:bg-raised hover:text-fg"
            >
              <X className="size-5" />
            </Dialog.Close>
          </div>
          <nav aria-label="Main" className="mt-4 flex flex-col gap-1 [&_a]:py-3 [&_a]:text-[16px]">
            <NavLinks onNavigate={() => setOpen(false)} />
          </nav>
          <div className="mt-5 flex items-center justify-between border-t border-line pt-5">
            <WalletButton />
            <NetworkPill />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/80 backdrop-blur-xl print:hidden">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-6 px-5 md:px-8">
        <Logo />
        <nav aria-label="Main" className="hidden items-center gap-0.5 md:flex">
          <NavLinks />
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <NetworkPill className="hidden sm:inline-flex" />
          <ThemeMenu />
          <NotificationBell />
          <div className="hidden md:block">
            <WalletButton />
          </div>
          <MobileMenu />
        </div>
      </div>
    </header>
  );
}
