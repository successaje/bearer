import type { Metadata } from "next";
import { ClaimView } from "@/components/claim/claim-view";

export const metadata: Metadata = {
  title: "A Bearer link",
  description: "A sealed vault sent as a link. Open it to see what it holds, then keep it, pass it on, or break the seal and withdraw.",
  robots: { index: false },
};

export default function ClaimPage() {
  return <ClaimView />;
}
