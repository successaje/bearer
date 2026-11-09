import type { Metadata } from "next";
import { Suspense } from "react";
import { HandoverView } from "@/components/handover/handover-view";

export const metadata: Metadata = {
  title: "Hand-over mode",
  description: "Give a Bearer vault in person: the recipient checks the seal on their own phone, then it changes hands in one NEAR transaction.",
};

export default function HandoverPage() {
  return (
    <Suspense fallback={<div className="min-h-[calc(100dvh-64px)] bg-ink" />}>
      <HandoverView />
    </Suspense>
  );
}
