import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { VaultDetailSkeleton, VaultDetailView } from "@/components/vault/vault-detail-view";

export const metadata: Metadata = {
  title: "Vault",
  description: "A Bearer vault: what's inside, who can withdraw, its seal and its history.",
};

/** Marks the page as per-request: its link preview depends on the vault's live state. */
async function PerRequest() {
  await connection();
  return null;
}

export default function VaultPage() {
  return (
    <>
      <Suspense fallback={null}>
        <PerRequest />
      </Suspense>
      <Suspense fallback={<VaultDetailSkeleton />}>
        <VaultDetailView />
      </Suspense>
    </>
  );
}
