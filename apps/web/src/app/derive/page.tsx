import type { Metadata } from "next";
import { Suspense } from "react";
import { DeriveView } from "@/components/derive/derive-view";
import { Eyebrow, Skeleton } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "Derive it yourself",
  description: "Recompute any vault's Bitcoin, Base and Solana addresses in your browser from NEAR's MPC root keys, then compare with the contract and the signer.",
};

export default function DerivePage() {
  return (
    <div className="mx-auto max-w-[1200px] px-5 pt-14 md:px-8 md:pt-20">
      <div className="max-w-[780px]">
        <Eyebrow>Derive it yourself</Eyebrow>
        <h1 className="text-balance mt-3 text-[clamp(36px,5vw,58px)] font-semibold leading-[1.02] tracking-[-0.045em]">
          Don&apos;t take the addresses on trust. <span className="text-fg-3">Compute them.</span>
        </h1>
        <p className="text-pretty mt-5 text-[17px] leading-relaxed text-fg-2">
          A vault&apos;s addresses come from NEAR&apos;s MPC root keys, the Bearer contract&apos;s account and a path. Run the
          same math in your browser and check that nobody swapped in an address of their own.
        </p>
      </div>
      <div className="mt-14">
        <Suspense fallback={<Skeleton className="h-[480px] rounded-panel" />}>
          <DeriveView />
        </Suspense>
      </div>
    </div>
  );
}
