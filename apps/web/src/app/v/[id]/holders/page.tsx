import type { Metadata } from "next";
import { Suspense } from "react";
import { HoldersView } from "@/components/holders/holders-view";
import { Skeleton } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "Holders only",
  description: "A page only a vault's current holder can open: sign a message with your wallet, and the server checks on NEAR testnet that your account holds the vault right now.",
};

export default function HoldersPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-[760px] px-5 pt-12 md:px-8">
          <Skeleton className="h-64 w-full rounded-[20px]" />
        </div>
      }
    >
      <HoldersView />
    </Suspense>
  );
}
