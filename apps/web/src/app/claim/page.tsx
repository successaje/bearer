import type { Metadata } from "next";
import { ClaimView } from "@/components/claim/claim-view";

export const metadata: Metadata = {
  title: "Claim a card",
  description: "Someone handed you a Bearer card. Claim it with your NEAR wallet or a free account.",
  // Claim links carry a private key in the fragment; keep the page out of search results.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function ClaimPage() {
  return <ClaimView />;
}
