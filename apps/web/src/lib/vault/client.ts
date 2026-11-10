import type { BearerClient } from "@bearer/sdk";
import { BASE_RPC, BEARER_CONTRACT, ESPLORA_API, HOLDINGS, MARKET_CONTRACT, NEAR_RPC, NETWORK, SCHEDULE_CONTRACT, SOLANA_RPC } from "@/lib/config";

let client: BearerClient | null = null;

export async function getVaultClient(): Promise<BearerClient> {
  if (client) return client;
  if (NETWORK === "mock") {
    const { MockBearerClient } = await import("./mock-client");
    client = new MockBearerClient();
  } else {
    // The live adapter: public RPCs for reads, the near-connect wallet for writes.
    const [{ TestnetBearerClient }, { nearConnectWallet }, { RECORDED_ATTACKS }] = await Promise.all([
      import("@bearer/sdk"),
      import("./wallet-bridge"),
      import("./recorded-attacks"),
    ]);
    client = new TestnetBearerClient({
      contractId: BEARER_CONTRACT,
      marketId: MARKET_CONTRACT,
      holdings: HOLDINGS,
      scheduleId: SCHEDULE_CONTRACT,
      recordedAttacks: RECORDED_ATTACKS,
      wallet: nearConnectWallet,
      endpoints: { near: NEAR_RPC, esplora: ESPLORA_API, evm: BASE_RPC, solana: SOLANA_RPC },
    });
  }
  return client;
}
