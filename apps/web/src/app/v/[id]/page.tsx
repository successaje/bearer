import type { Metadata } from "next";
import { Suspense } from "react";
import { VaultDetailSkeleton, VaultDetailView } from "@/components/vault/vault-detail-view";

export const metadata: Metadata = {
  title: "Vault",
  description: "A Bearer vault: what's inside, who can withdraw, its seal and its history.",
};

export default function VaultPage() {
  return (
    <Suspense fallback={<VaultDetailSkeleton />}>
      <VaultDetailView />
    </Suspense>
  );
}
