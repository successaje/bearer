import type { Metadata } from "next";
import { AccountView } from "@/components/account/account-view";

export const metadata: Metadata = {
  title: "Your account",
  description: "What you've listed and sold on Bearer, what you've been paid, and the vaults handed or scheduled to you.",
  robots: { index: false },
};

export default function AccountPage() {
  return <AccountView />;
}
