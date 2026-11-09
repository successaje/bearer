import type { Metadata } from "next";
import { MarketHow } from "@/components/market/market-how";

export const metadata: Metadata = {
  title: "How the market works",
  description: "How Bearer's market sells sealed vaults from escrow: the order money moves in, what protects each side, and the risks.",
};

export default function MarketHowPage() {
  return <MarketHow />;
}
