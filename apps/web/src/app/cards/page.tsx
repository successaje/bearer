import type { Metadata } from "next";
import { MyCardsView } from "@/components/card/my-cards-view";

export const metadata: Metadata = {
  title: "My cards",
  description: "The Bearer cards you hold on NEAR testnet.",
};

export default function MyCardsPage() {
  return <MyCardsView />;
}
