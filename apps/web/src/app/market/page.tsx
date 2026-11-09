import type { Metadata } from "next";
import { MarketView } from "@/components/market/market-view";

export const metadata: Metadata = {
  title: "Market",
  description: "Sealed Bearer vaults for sale on NEAR testnet, held in escrow until they sell.",
};

export default function MarketPage() {
  return <MarketView />;
}
