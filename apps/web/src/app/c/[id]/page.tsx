import type { Metadata } from "next";
import { Suspense } from "react";
import { CardDetailSkeleton, CardDetailView } from "@/components/card/card-detail-view";

export const metadata: Metadata = {
  title: "Card",
  description: "A Bearer card and its live Seal report: what's inside, what's sealed, and the evidence.",
};

export default function CardPage() {
  return (
    <Suspense fallback={<CardDetailSkeleton />}>
      <CardDetailView />
    </Suspense>
  );
}
