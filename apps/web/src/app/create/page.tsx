import type { Metadata } from "next";
import { CreateView } from "@/components/card/create-view";

export const metadata: Metadata = {
  title: "Create a card",
  description: "Mint a Bearer card with its own Bitcoin, Base and Solana addresses.",
};

export default function CreatePage() {
  return <CreateView />;
}
