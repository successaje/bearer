import type { BearerClient } from "@bearer/sdk";
import { BASE_RPC, BEARER_CONTRACT, ESPLORA_API, NEAR_RPC, NETWORK, SOLANA_RPC } from "@/lib/config";

let client: BearerClient | null = null;

export async function getVaultClient(): Promise<BearerClient> {
  if (client) return client;
  if (NETWORK === "mock") {
    const { MockBearerClient } = await import("./mock-client");
    client = new MockBearerClient();
  } else {
    // The live adapter: public RPCs for reads, the near-connect wallet for writes.
    const [{ TestnetBearerClient }, { nearConnectWallet }] = await Promise.all([import("@bearer/sdk"), import("./wallet-bridge")]);
    client = new TestnetBearerClient({
      contractId: BEARER_CONTRACT,
      wallet: nearConnectWallet,
      endpoints: { near: NEAR_RPC, esplora: ESPLORA_API, evm: BASE_RPC, solana: SOLANA_RPC },
    });
  }
  return client;
}
