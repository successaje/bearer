import type { BearerClient } from "@bearer/sdk";
import { BASE_RPC, BEARER_CONTRACT, ESPLORA_API, LEND_CONTRACT, MARKET_CONTRACT, NEAR_RPC, NETWORK, SCHEDULE_CONTRACT, SOLANA_RPC } from "@/lib/config";

let client: BearerClient | null = null;

export async function getVaultClient(): Promise<BearerClient> {
  if (client) return client;
  if (NETWORK === "mock") {
    const { MockBearerClient } = await import("./mock-client");
    client = new MockBearerClient();
  } else {
    // The live adapter: public RPCs for reads, the near-connect wallet for writes.
    const [{ TestnetBearerClient }, { appWallet }, { RECORDED_ATTACKS }] = await Promise.all([
      import("@bearer/sdk"),
      import("./wallet-bridge"),
      import("./recorded-attacks"),
    ]);
    client = new TestnetBearerClient({
      contractId: BEARER_CONTRACT,
      marketId: MARKET_CONTRACT,
      scheduleId: SCHEDULE_CONTRACT,
      lendId: LEND_CONTRACT,
      recordedAttacks: RECORDED_ATTACKS,
      wallet: appWallet,
      endpoints: { near: NEAR_RPC, esplora: ESPLORA_API, evm: BASE_RPC, solana: SOLANA_RPC },
    });
  }
  return client;
}
