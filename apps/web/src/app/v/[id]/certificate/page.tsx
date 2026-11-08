import type { Metadata } from "next";
import { Suspense } from "react";
import { CertificateView } from "@/components/certificate/certificate-view";
import { Skeleton } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "Bearer certificate",
  description: "A printable certificate for a Bearer vault: its serial, seal, addresses and endorsements, with a QR code to check it live.",
};

export default function CertificatePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-[1200px] px-5 pt-10 md:px-8">
          <Skeleton className="aspect-[297/210] w-full rounded-[6px]" />
        </div>
      }
    >
      <CertificateView />
    </Suspense>
  );
}
