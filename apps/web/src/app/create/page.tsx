import type { Metadata } from "next";
import { CreateView } from "@/components/vault/create-view";

export const metadata: Metadata = {
  title: "Create a vault",
  description: "Create a sealed Bearer vault with its own Bitcoin, Base and Solana addresses.",
};

export default function CreatePage() {
  return <CreateView />;
}
