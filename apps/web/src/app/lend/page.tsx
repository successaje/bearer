import type { Metadata } from "next";
import { LendView } from "@/components/lend/lend-view";

export const metadata: Metadata = {
  title: "Lend",
  description: "Borrow NEAR against a sealed Bearer vault on testnet. The vault is held in escrow until the loan is repaid or the lender takes it.",
};

export default function LendPage() {
  return <LendView />;
}
