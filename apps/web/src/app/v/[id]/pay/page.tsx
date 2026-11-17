import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { PayView } from "@/components/pay/pay-view";
import { Skeleton } from "@/components/ui/primitives";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const number = /^\d{1,9}$/.test(id) ? `No. ${id.padStart(4, "0")}` : "a Bearer vault";
  return {
    title: `Pay vault ${number}`,
    description: `Pay into Bearer vault ${number} on Bitcoin testnet4, Base Sepolia or Solana devnet. What you send belongs to whoever holds the vault.`,
  };
}

/** Marks the page as per-request: its title names the vault in the URL. */
async function PerRequest() {
  await connection();
  return null;
}

export default function PayPage() {
  return (
    <>
      <Suspense fallback={null}>
        <PerRequest />
      </Suspense>
      <Suspense
        fallback={
          <div className="mx-auto max-w-[760px] px-5 pt-12 md:px-8">
            <Skeleton className="h-[520px] w-full rounded-[22px]" />
          </div>
        }
      >
        <PayView />
      </Suspense>
    </>
  );
}
