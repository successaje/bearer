"use client";

import type { VaultView } from "@bearer/sdk";
import { CHAIN_TAGS, vaultPath } from "@bearer/sdk";
import { useRouter } from "next/navigation";
import { SealPanel } from "@/components/vault/seal-panel";
import { useNow } from "@/lib/vault/hooks";
import { vaultReport } from "@/lib/vault/report";

const DEMO: VaultView = {
  token_id: "42",
  owner_id: "bob.testnet",
  state: { kind: "sealed" },
  signatures_requested: 0,
  withdrawal_count: 0,
  keys: { btc: "secp256k1:demo", evm: "secp256k1:demo", sol: "ed25519:demo" },
  btc_address: null,
  evm_address: null,
  sol_address: null,
  paths: Object.fromEntries(CHAIN_TAGS.map((c) => [c, vaultPath("42", c)])) as VaultView["paths"],
  custody: [
    { account_id: "alice.testnet", since_ns: "0" },
    { account_id: "bob.testnet", since_ns: "0" },
  ],
  created_at_ns: "0",
  name: "Theo's birthday",
  finish: "obsidian",
};

/** The vault page's real seal panel, fed a sealed demo vault. Re-check opens vault 42. */
export function DemoSealPanel() {
  const router = useRouter();
  const now = useNow(10_000);
  return (
    <SealPanel
      tokenId="42"
      owner={DEMO.owner_id}
      report={vaultReport(DEMO, [])}
      now={now}
      checkedAt={now}
      onRecheck={() => router.push("/v/42")}
    />
  );
}
