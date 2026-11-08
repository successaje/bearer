import type { Metadata } from "next";
import { MyVaultsView } from "@/components/vault/my-vaults-view";

export const metadata: Metadata = {
  title: "My vaults",
  description: "The Bearer vaults you hold on NEAR testnet.",
};

export default function MyVaultsPage() {
  return <MyVaultsView />;
}
